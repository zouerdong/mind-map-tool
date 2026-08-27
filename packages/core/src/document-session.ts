// DocumentSession（ADR 0003）：当前状态、保存点身份、展示路径、opaque
// handle/token、串行化保存队列。
//
// 语义要点（AC-04/AC-06 的判定基础）：
// - 保存开始时冻结 {stateIdentity, canonicalBytes, 目标能力}；
// - 完成只把冻结时的 identity 标为保存点；保存期间的新编辑保持 dirty；
// - 失败不改变 saved identity / handle / token / displayPath；
// - 同一 session 同时只允许一个 in-flight commit；后续请求排队，
//   开始时基于"当时"的当前状态重新捕获快照；
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

  /** load：整体替换并清空历史与目标身份；返回新（clean）会话状态。
   * 打开既有文档后由调用方 adoptOpenedTarget 重新置入目标身份；
   * 新建文档不 adopt → ordinary save 正确转入 Save As。 */
  load(document: MindMapDocumentV1): StateNode {
    const node = this.history.load(document);
    this._savedStateIdentity = node.identity;
    this._documentTargetHandle = null;
    this._versionToken = null;
    this._displayPath = null;
    this.inFlight = null;
    this.queue = [];
    return node;
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

  /** 请求普通保存；无 handle（从未打开/另存过）时返回 null，调用方转 Save As。 */
  requestOrdinarySave(): SaveSnapshot | null {
    if (this.inFlight) {
      this.queue.push({ kind: "ordinary" });
      return null;
    }
    if (this._documentTargetHandle === null || this._versionToken === null) return null;
    return this.capture({ kind: "ordinary" });
  }

  /** 请求 Save As；authorizationRef 是 host ledger 的一次性选址授权引用。 */
  requestSaveAs(authorizationRef: string): SaveSnapshot | null {
    if (this.inFlight) {
      this.queue.push({ kind: "save-as", authorizationRef });
      return null;
    }
    return this.capture({ kind: "save-as", authorizationRef });
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
   */
  saveCompleted(snapshot: SaveSnapshot, receipt: SaveReceipt): void {
    if (this.inFlight !== snapshot) return; // 过期快照（已被清理）：忽略
    this.inFlight = null;
    this._savedStateIdentity = snapshot.stateIdentity;
    this._documentTargetHandle = receipt.documentTargetHandle;
    this._versionToken = receipt.versionToken;
    this._displayPath = receipt.displayPath;
    this.drainQueue();
  }

  /** host 提交失败：保存点、handle、token、displayPath 完全不变。 */
  saveFailed(snapshot: SaveSnapshot): void {
    if (this.inFlight !== snapshot) return;
    this.inFlight = null;
    this.drainQueue();
  }

  /** 排队请求由驱动方（platform adapter）拉取：开始时基于当前状态重新捕获。 */
  private drainQueue(): void {
    void this.queue; // 驱动方在完成回调后调用 requestOrdinarySave/requestSaveAs 拉取下一条
  }

  get queuedSaveCount(): number {
    return this.queue.length;
  }
}
