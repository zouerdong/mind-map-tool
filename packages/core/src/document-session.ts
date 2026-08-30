// DocumentSession（ADR 0003）：当前状态、保存点身份、展示路径、opaque
// handle/token、串行化保存队列。
//
// 语义要点（AC-04/AC-06 的判定基础）：
// - 保存开始时冻结 {stateIdentity, canonicalBytes, 目标能力}；
// - 完成只把冻结时的 identity 标为保存点；保存期间的新编辑保持 dirty；
// - 失败不改变 saved identity / handle / token / displayPath，并清空
//   剩余队列（失败策略：排队请求一并终止，重试由用户发起全新请求）；
// - 同一 session 同时只允许一个 in-flight commit；后续请求排队（保留
//   ordinary/save-as 各自语义，Save As 不降级），由驱动方经
//   takeNextSaveIntent 原子消费，取出时基于"当时"的当前状态重新捕获快照；
// - 文档替换（load）fail-closed：存在 pending save（in-flight 或排队）时
//   拒绝替换且一切字段不变（MRT-001A）——host commit 没有可证明的取消
//   能力，静默清队会让调用方等待者永久悬挂并造成跨代际串扰；文档切换
//   必须等待保存链自然终态后重试；
// - handle/token 对 core 完全 opaque（只存放/回传，不解析不伪造不序列化）；
// - viewport 是 session-only UI 状态，不属于本类（不持久化/不 undo/不 dirty）。

import { History } from "./history.js";
import { encodeDocument } from "./canonical.js";
import type { Command, StateNode } from "./commands.js";
import { sameIdentity, type StateIdentity } from "./identity.js";
import type { MindMapDocumentV1 } from "./schema.js";

/** 冻结的保存快照：开始提交时捕获，完成前不受后续编辑影响。 */
export interface SaveSnapshot {
  readonly kind: "ordinary" | "save-as";
  readonly stateIdentity: StateIdentity;
  readonly canonicalBytes: Uint8Array;
  /** ordinary：当前 handle；save-as：null（授权由 host ledger 持有） */
  readonly documentTargetHandle: string | null;
  /** ordinary：期望 token（外部修改冲突由 host 复核）；save-as：null */
  readonly expectedVersionToken: string | null;
  /** save-as：一次性授权引用；ordinary：null */
  readonly authorizationRef: string | null;
}

/** host 提交成功后的回执。 */
export interface SaveReceipt {
  documentTargetHandle: string;
  versionToken: string;
  displayPath: string;
}

/**
 * 保存请求的可判别结果（CR-001）：禁止再用同一个 null 表达不同状态。
 * - snapshot：已捕获并占位 in-flight，调用方必须把它驱动到终态
 *   （saveCompleted / saveFailed）；
 * - queued：已入队（ordinary/save-as 语义保留），由队列驱动方消费并
 *   为该请求送达终态；
 * - no-target：ordinary 无 handle（从未打开/另存过），调用方转 Save As。
 */
export type SaveRequestResult =
  { kind: "snapshot"; snapshot: SaveSnapshot } | { kind: "queued" } | { kind: "no-target" };

/** Save As 的请求结果：自带一次性授权即目标，永不 no-target。 */
export type SaveAsRequestResult = { kind: "snapshot"; snapshot: SaveSnapshot } | { kind: "queued" };

/** 队列驱动方 takeNextSaveIntent 的结果：取出即出队。 */
export type NextSaveIntent =
  | { kind: "snapshot"; snapshot: SaveSnapshot }
  /**
   * 出队了一个 ordinary intent，但此刻无 handle：该请求以"无目标"终态
   * 结束（防御性终态——当前策略下不可达：无 handle 时普通请求只在
   * in-flight/队列已占用时入队，而 in-flight 的终态要么置入 handle
   * （保存成功）要么清空队列（失败），队列中不可能残留无 handle 的
   * ordinary；保留它使 takeNextSaveIntent 永不搁浅 intent、永不返回
   * 无效快照）。
   */
  | { kind: "dropped-no-target" }
  /** 无可执行 intent（in-flight 占位或队列为空）。 */
  | { kind: "empty" };

/**
 * 文档替换（load）的可判别结果（MRT-001A）：pending save 存在时
 * fail-closed —— 不修改 history、identity、target、inFlight、queue
 * 的任何字段，调用方返回 busy 并等待保存链自然终态后重试。
 */
export type DocumentLoadResult = { kind: "replaced" } | { kind: "save-pending" };

type SaveIntent = { kind: "ordinary" } | { kind: "save-as"; authorizationRef: string };

export class DocumentSession {
  private history: History;
  private _savedStateIdentity: StateIdentity;
  private _displayPath: string | null = null;
  private _documentTargetHandle: string | null = null;
  private _versionToken: string | null = null;
  private inFlight: SaveSnapshot | null = null;
  private queue: SaveIntent[] = [];

  constructor(initialDocument: MindMapDocumentV1) {
    this.history = new History(initialDocument);
    this._savedStateIdentity = this.history.current.identity; // 新文档视为 clean
  }

  // ---- 状态与历史 ----

  get current(): StateNode {
    return this.history.current;
  }

  get document(): MindMapDocumentV1 {
    return this.current.document;
  }

  commit(command: Command): ReturnType<History["commit"]> {
    return this.history.commit(command);
  }

  undo(): StateNode | null {
    return this.history.undo();
  }

  redo(): StateNode | null {
    return this.history.redo();
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  /**
   * load：整体替换并清空历史与目标身份，返回 clean 会话状态。
   * 打开既有文档后由调用方 adoptOpenedTarget 重新置入目标身份；
   * 新建文档不 adopt → ordinary save 正确转入 Save As。
   *
   * fail-closed（MRT-001A）：存在 pending save（in-flight 或排队）时返回
   * save-pending 且不修改任何字段——替换与清队不再同时发生，调用方
   * （App 层保存队列的等待者）的终态只由保存链自身送达。
   */
  load(document: MindMapDocumentV1): DocumentLoadResult {
    if (this.inFlight !== null || this.queue.length > 0) return { kind: "save-pending" };
    const node = this.history.load(document);
    this._savedStateIdentity = node.identity;
    this._documentTargetHandle = null;
    this._versionToken = null;
    this._displayPath = null;
    this.inFlight = null;
    this.queue = [];
    return { kind: "replaced" };
  }

  /**
   * openDocument 成功后置入 host 签发的目标身份（ADR 0003 §4/§5：
   * session 管理 handle/token/displayPath；opaque 只存放）。
   * 不改变历史与保存点（load 已置 clean）。失败时由调用方保持旧身份。
   */
  adoptOpenedTarget(documentTargetHandle: string, versionToken: string, displayPath: string): void {
    this._documentTargetHandle = documentTargetHandle;
    this._versionToken = versionToken;
    this._displayPath = displayPath;
  }

  // ---- 保存语义 ----

  get isDirty(): boolean {
    return !sameIdentity(this.current.identity, this._savedStateIdentity);
  }

  get displayPath(): string | null {
    return this._displayPath;
  }

  /** opaque：core 只回传，不解析。 */
  get documentTargetHandle(): string | null {
    return this._documentTargetHandle;
  }

  get versionToken(): string | null {
    return this._versionToken;
  }

  get hasInFlightSave(): boolean {
    return this.inFlight !== null;
  }

  /** 文档替换（load）的 pending-save gate（MRT-001A）：in-flight 或排队任一存在即为 true。 */
  get hasPendingSaves(): boolean {
    return this.inFlight !== null || this.queue.length > 0;
  }

  /**
   * 请求普通保存。in-flight（或队列未清）时排队，保留请求语义；
   * 无 handle（从未打开/另存过）时返回 no-target，调用方转 Save As。
   */
  requestOrdinarySave(): SaveRequestResult {
    if (this.inFlight !== null || this.queue.length > 0) {
      this.queue.push({ kind: "ordinary" });
      return { kind: "queued" };
    }
    if (this._documentTargetHandle === null || this._versionToken === null) {
      return { kind: "no-target" };
    }
    return { kind: "snapshot", snapshot: this.capture({ kind: "ordinary" }) };
  }

  /** 请求 Save As；authorizationRef 是 host ledger 的一次性选址授权引用。 */
  requestSaveAs(authorizationRef: string): SaveAsRequestResult {
    if (this.inFlight !== null || this.queue.length > 0) {
      this.queue.push({ kind: "save-as", authorizationRef });
      return { kind: "queued" };
    }
    return { kind: "snapshot", snapshot: this.capture({ kind: "save-as", authorizationRef }) };
  }

  /**
   * 保存队列的唯一消费入口（取出即出队）：
   * - in-flight 占位或队列空 → empty（驱动方在该次保存终态后再取）；
   * - 队首 ordinary 此刻无 handle → dropped-no-target（见 NextSaveIntent）；
   * - 其余 → 基于当前状态重新捕获快照并占位 in-flight（排队请求在
   *   开始执行时拿到最新文档，满足 ADR 0003 §4"重新捕获快照"）。
   */
  takeNextSaveIntent(): NextSaveIntent {
    if (this.inFlight !== null) return { kind: "empty" };
    const intent = this.queue.shift();
    if (intent === undefined) return { kind: "empty" };
    if (
      intent.kind === "ordinary" &&
      (this._documentTargetHandle === null || this._versionToken === null)
    ) {
      return { kind: "dropped-no-target" };
    }
    return { kind: "snapshot", snapshot: this.capture(intent) };
  }

  private capture(intent: SaveIntent): SaveSnapshot {
    const state = this.current; // 开始时重新捕获（排队请求基于当前状态）
    const snapshot: SaveSnapshot = {
      kind: intent.kind,
      stateIdentity: state.identity,
      canonicalBytes: encodeDocument(state.document),
      documentTargetHandle: intent.kind === "ordinary" ? this._documentTargetHandle : null,
      expectedVersionToken: intent.kind === "ordinary" ? this._versionToken : null,
      authorizationRef: intent.kind === "save-as" ? intent.authorizationRef : null,
    };
    this.inFlight = snapshot;
    return snapshot;
  }

  /**
   * host 提交成功：只把该快照冻结的 identity 标为保存点；
   * 接收 host 回执（可安全轮换）的当前 handle/token。
   * 不自动开启下一个保存：排队请求由驱动方 takeNextSaveIntent 消费。
   */
  saveCompleted(snapshot: SaveSnapshot, receipt: SaveReceipt): void {
    if (this.inFlight !== snapshot) return; // 非当前 in-flight（重复终态等）：防御性忽略
    this.inFlight = null;
    this._savedStateIdentity = snapshot.stateIdentity;
    this._documentTargetHandle = receipt.documentTargetHandle;
    this._versionToken = receipt.versionToken;
    this._displayPath = receipt.displayPath;
  }

  /**
   * host 提交失败：保存点、handle、token、displayPath 完全不变；
   * 剩余排队请求一并终止——失败（冲突/IO）需要用户决策，自动续跑排队项
   * 可能造成意外覆盖或消耗过期的一次性授权；排队项本质是重复的保存
   * 请求，dirty 保持即无数据损失，重试由用户发起（全新请求）。
   */
  saveFailed(snapshot: SaveSnapshot): void {
    if (this.inFlight !== snapshot) return;
    this.inFlight = null;
    this.queue.length = 0;
  }

  get queuedSaveCount(): number {
    return this.queue.length;
  }
}
