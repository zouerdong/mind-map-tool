// 文件命令流（MM-080 ③ / MRT-001 CR-001 / MRT-001A pending gate）：
// App 层把 FilePort 与 DocumentSession 的保存队列协议接起来。语义（ADR 0003 §4）：
// - requestXxx 返回可判别结果：no-target → 转 Save As；queued → 等待该
//   排队请求的终态；snapshot → 本调用直接驱动到终态（saveCompleted/saveFailed）；
// - 保存队列单一驱动：takeNextSaveIntent 原子出队并按当时状态重捕获；
//   同一 session 同时最多一个驱动循环（WeakMap 防重入，重入请求只入队）；
// - 失败/冲突终止驱动：core saveFailed 清空队列后，仍在等待的排队请求
//   由本层以同一失败终态收尾——每个请求都有终态，不悬挂、不自旋、
//   不 fire-and-forget；
// - 文档替换 fail-closed（MRT-001A）：new/open/launch-open 在 pending save
//   （in-flight 或排队）时返回 SAVE_IN_PROGRESS，session 完全不变——
//   前置 gate 在调用 FilePort/确认对话框之前（不开对话框、不执行 discard），
//   await 之后的二次检查由 core load() 的原子 fail-closed 承担（无 TOCTOU
//   窗口）；此时已取得的 opened handle 不进入 session（capability 游离，
//   收口记录于 MRT-003/004）。不得用 timeout、清 waiter 或伪造取消掩盖；
// - 排队的 save-as 保留语义（不会降级成 ordinary）；
// - 成功 → saveCompleted（保存点=冻结 identity）；失败/冲突 → 保存身份
//   完全不变（调用方保持 dirty 与提示）。

import {
  decodeDocument,
  emptyDocument,
  type Command,
  type DocumentSession,
  type MindMapDocumentV1,
  type SaveSnapshot,
} from "@mindmap/core";
import {
  PlatformError,
  type CommitReceipt,
  type FilePort,
  type OpenedDocument,
} from "@mindmap/platform";
import { exportWithGrant, type ExportRendererLike } from "./export-commands.js";

export type FlowResult<T = undefined> =
  | ({ kind: "ok" } & (T extends undefined ? Record<string, never> : { value: T }))
  | { kind: "cancelled" }
  | { kind: "conflict"; message: string }
  | { kind: "error"; code: string; message: string };

export interface FileFlowDeps {
  filePort: FilePort;
}

type SaveFlowResult = FlowResult<{ receipt: CommitReceipt }>;

/** 每 session 至多一个保存队列驱动循环在跑（true=运行中）。 */
const activeQueueDrivers = new WeakMap<DocumentSession, boolean>();
/** 排队请求的终态等待者（FIFO，与 core 队列同序：每次排队恰好压入一个）。 */
const queuedSaveWaiters = new WeakMap<DocumentSession, Array<(r: SaveFlowResult) => void>>();
/**
 * 每 session 在飞的 saveFlow/saveAsFlow 调用（MRT-003）：close 控制器在
 * pending save 时的受控等待数据源——等待真实终态，不轮询、不 timeout。
 */
const inFlightSaveCalls = new WeakMap<DocumentSession, Set<Promise<unknown>>>();

function trackSave(
  session: DocumentSession,
  call: Promise<SaveFlowResult>,
): Promise<SaveFlowResult> {
  const set = inFlightSaveCalls.get(session) ?? new Set();
  inFlightSaveCalls.set(session, set);
  set.add(call);
  return call.finally(() => {
    set.delete(call);
  });
}

/**
 * 等待该 session 全部在飞保存请求终态（MRT-003 D2：pending save 时的
 * close 受控等待）。App 层所有保存均经 saveFlow/saveAsFlow 入口，因此
 * in-flight/排队/驱动中的请求都在被追踪集合内。
 */
export async function whenSavesSettled(session: DocumentSession): Promise<void> {
  // 不能只截取调用瞬间的 Promise：等待期间仍可能有新的保存请求入队。
  // 每轮等待当前集合后重新检查 core pending 状态，直到整个保存链自然归零。
  while (session.hasPendingSaves) {
    const set = inFlightSaveCalls.get(session);
    if (!set || set.size === 0) return; // 防御性 fail closed：调用方仍会复查 hasPendingSaves
    await Promise.allSettled([...set]);
  }
}

function platformError(
  e: unknown,
): { kind: "conflict"; message: string } | { kind: "error"; code: string; message: string } {
  if (e instanceof PlatformError) {
    if (e.code === "TARGET_MODIFIED_EXTERNALLY" || e.code === "TARGET_APPEARED")
      return {
        kind: "conflict",
        message:
          e.code === "TARGET_APPEARED"
            ? "选择目标时它还不存在，现在已被创建；为避免覆盖未写任何内容。请重新选择目标。"
            : "文件在应用外被修改或删除；为避免覆盖未写任何内容。请重新打开或另存到新位置。",
      };
    return { kind: "error", code: e.code, message: e.message };
  }
  return { kind: "error", code: "UNKNOWN", message: String(e) };
}

/** 文档替换的 pending-save gate 统一 busy 终态（MRT-001A；UI 映射为非致命提示）。 */
function saveInProgressBusy(): { kind: "error"; code: string; message: string } {
  return {
    kind: "error",
    code: "SAVE_IN_PROGRESS",
    message: "保存尚未完成；请在保存完成后再新建或打开文件。",
  };
}

/** open 对话框 → decode → load + adoptOpenedTarget；pending save 时不弹对话框、不替换。 */
export async function openDocumentFlow(
  session: DocumentSession,
  deps: FileFlowDeps,
): Promise<FlowResult<{ displayPath: string }>> {
  if (session.hasPendingSaves) return saveInProgressBusy(); // 前置 gate：不打开对话框
  let opened: OpenedDocument | null;
  try {
    opened = await deps.filePort.openDocument();
  } catch (e) {
    return platformError(e);
  }
  if (opened === null) return { kind: "cancelled" };
  return adoptOpened(session, opened);
}

/** 按路径打开（launch intent 加载，无对话框）；pending save 时 fail closed。 */
export async function openPathFlow(
  session: DocumentSession,
  deps: FileFlowDeps,
  path: string,
): Promise<FlowResult<{ displayPath: string }>> {
  if (session.hasPendingSaves) return saveInProgressBusy(); // 前置 gate：不发起读取
  try {
    const opened = await deps.filePort.openPath(path);
    return adoptOpened(session, opened);
  } catch (e) {
    return platformError(e);
  }
}

function adoptOpened(
  session: DocumentSession,
  opened: OpenedDocument,
): FlowResult<{ displayPath: string }> {
  const decoded = decodeDocument(opened.contentBytes);
  if (!decoded.ok) {
    return {
      kind: "error",
      code: decoded.error.code,
      message:
        decoded.error.code === "FUTURE_VERSION"
          ? "文档来自更新版本，无法打开（不会覆盖原文件）。"
          : "文件不是有效的脑图文档。",
    };
  }
  // 读取 await 之后的二次 gate：core load() 同步原子地 fail-closed（检查与
  // 替换之间无窗口）。save-pending 时 opened handle 不进入 session（游离）。
  const loaded = session.load(decoded.doc);
  if (loaded.kind !== "replaced") return saveInProgressBusy();
  session.adoptOpenedTarget(opened.documentTargetHandle, opened.versionToken, opened.displayPath);
  return { kind: "ok", value: { displayPath: opened.displayPath } };
}

/** 保存：ordinary（handle+token，无对话框）→ 无 handle 时转 Save As；提交进行中则排队等终态。 */
export async function saveFlow(
  session: DocumentSession,
  deps: FileFlowDeps,
): Promise<SaveFlowResult> {
  return trackSave(session, executeSaveFlow(session, deps));
}

async function executeSaveFlow(
  session: DocumentSession,
  deps: FileFlowDeps,
): Promise<SaveFlowResult> {
  const request = session.requestOrdinarySave();
  if (request.kind === "no-target") return executeSaveAsFlow(session, deps, suggestedName(session));
  if (request.kind === "queued") return awaitQueuedSave(session, deps);
  return executeSaveSnapshot(session, deps, request.snapshot);
}

/** Save As：一次性选址授权 → 提交（成功签发新 handle）；授权后若已有保存进行中则排队（保留 save-as 语义）。 */
export async function saveAsFlow(
  session: DocumentSession,
  deps: FileFlowDeps,
  suggested: string,
): Promise<SaveFlowResult> {
  return trackSave(session, executeSaveAsFlow(session, deps, suggested));
}

async function executeSaveAsFlow(
  session: DocumentSession,
  deps: FileFlowDeps,
  suggested: string,
): Promise<SaveFlowResult> {
  let grant;
  try {
    grant = await deps.filePort.requestTargetAuthorization("document", suggested);
  } catch (e) {
    return platformError(e);
  }
  if (grant === null) return { kind: "cancelled" };
  return executeSaveAsWithGrant(session, deps, grant.authorizationRef);
}

/** 已持有选址授权的 Save As 执行段（保存队列语义不变）。 */
function executeSaveAsWithGrant(
  session: DocumentSession,
  deps: FileFlowDeps,
  authorizationRef: string,
): Promise<SaveFlowResult> {
  const request = session.requestSaveAs(authorizationRef as never);
  if (request.kind === "queued") return awaitQueuedSave(session, deps);
  return executeSaveSnapshot(session, deps, request.snapshot);
}

/** 「存储为…」统一流程（OFR-2026-09-15 出口合并，PRD §8.2）的结果。 */
export type UnifiedSaveResult =
  | { kind: "ok"; format: "mindmap"; receipt: CommitReceipt }
  | {
      kind: "ok";
      format: "svg" | "png" | "pdf" | "graph-json";
      exportPath: string;
      /** 面板预告的兜底：文档首次落盘的可编辑源文件路径（有备份授权时）。 */
      backupPath?: string;
    }
  | { kind: "cancelled" }
  | { kind: "conflict"; message: string }
  | { kind: "error"; code: string; message: string };

/**
 * 存储为…（另存为与导出合并）：一个原生面板按所选格式路由——
 * - `.mindmap`：文档另存（保存队列语义与 saveAsFlow 一致，签发新 handle）；
 * - 导出四格式：渲染提交导出产物；面板在文档从未保存过时已签发同名
 *   `.mindmap` 兜底授权（PRD §8.2 防源文档丢失），导出成功后补写并绑定
 *   为当前文档目标（后续 ⌘S 原地保存到该源文件）。
 */
export async function unifiedSaveFlow(
  session: DocumentSession,
  deps: FileFlowDeps & { renderer: ExportRendererLike },
): Promise<UnifiedSaveResult> {
  let grant;
  try {
    grant = await deps.filePort.requestUnifiedSaveAuthorization(
      suggestedName(session),
      session.displayPath !== null,
    );
  } catch (e) {
    return platformError(e);
  }
  if (grant === null) return { kind: "cancelled" };

  if (grant.format === "mindmap") {
    const saved = await trackSave(
      session,
      executeSaveAsWithGrant(session, deps, grant.authorizationRef),
    );
    if (saved.kind === "ok") return { kind: "ok", format: "mindmap", receipt: saved.value.receipt };
    return saved;
  }

  const exported = await exportWithGrant(session, deps, grant.format, grant.authorizationRef);
  if (exported.kind === "cancelled") return { kind: "cancelled" };
  if (exported.kind === "error")
    return { kind: "error", code: exported.code, message: exported.message };

  let backupPath: string | undefined;
  if (grant.backupAuthorizationRef !== undefined) {
    const backup = await trackSave(
      session,
      executeSaveAsWithGrant(session, deps, grant.backupAuthorizationRef),
    );
    if (backup.kind !== "ok") {
      // 导出已落盘、兜底失败：如实报告半完成状态（不吞掉失败也不假装全失败）。
      const reason =
        backup.kind === "conflict"
          ? backup.message
          : backup.kind === "error"
            ? `${backup.code}: ${backup.message}`
            : "兜底提交未执行（授权已签发，cancelled 理论上不可达）";
      return {
        kind: "error",
        code: "BACKUP_SAVE_FAILED",
        message: `已导出 ${exported.displayPath}，但可编辑源文件备份失败（${reason}）。当前文档仍未保存，请立即用「存储为…」保存 .mindmap。`,
      };
    }
    backupPath = backup.value.receipt.displayPath;
  }
  return {
    kind: "ok",
    format: grant.format,
    exportPath: exported.displayPath,
    ...(backupPath !== undefined ? { backupPath } : {}),
  };
}

/** 新建结果：ok（已替换为空白文档）/ cancelled（放弃确认）/ error（busy 等）。 */
export type NewDocumentFlowResult =
  { kind: "ok" } | { kind: "cancelled" } | { kind: "error"; code: string; message: string };

/** 新建：pending save 时不执行 discard、不替换（fail closed）；确认丢弃后
 * 清空文档与目标身份（load 已清 → ordinary 转回 Save As）。 */
export async function newDocumentFlow(
  session: DocumentSession,
  confirmDiscard: () => Promise<boolean>,
): Promise<NewDocumentFlowResult> {
  if (session.hasPendingSaves) return saveInProgressBusy(); // 前置 gate：不调用 discard callback
  if (session.isDirty && !(await confirmDiscard())) return { kind: "cancelled" };
  // 确认等待（await）之后的二次 gate 由 core load() 原子承担
  const loaded = session.load(emptyDocument());
  if (loaded.kind !== "replaced") return saveInProgressBusy();
  return { kind: "ok" };
}

function commitSnapshot(deps: FileFlowDeps, snapshot: SaveSnapshot): Promise<CommitReceipt> {
  return deps.filePort.commitDocument(
    snapshot.kind === "ordinary"
      ? {
          kind: "ordinary",
          documentTargetHandle: snapshot.documentTargetHandle as never,
          expectedVersionToken: snapshot.expectedVersionToken as never,
          contentBytes: snapshot.canonicalBytes,
        }
      : {
          kind: "save-as",
          authorizationRef: snapshot.authorizationRef as never,
          contentBytes: snapshot.canonicalBytes,
        },
  );
}

/** 直接驱动一个已捕获的快照到终态；成功后确保队列驱动在跑（消费等待中的排队请求）。 */
async function executeSaveSnapshot(
  session: DocumentSession,
  deps: FileFlowDeps,
  snapshot: SaveSnapshot,
): Promise<SaveFlowResult> {
  let receipt: CommitReceipt;
  try {
    receipt = await commitSnapshot(deps, snapshot);
  } catch (e) {
    const failure = platformError(e);
    session.saveFailed(snapshot); // 失败策略（core）：清空剩余队列
    failPendingWaiters(session, failure); // 排队请求以同一失败终态收尾
    return failure;
  }
  session.saveCompleted(snapshot, receipt);
  ensureSaveQueueDriver(session, deps);
  return { kind: "ok", value: { receipt } };
}

/** 排队请求：压入等待者并确保驱动在跑；终态由驱动送达（成功回执/失败/无目标）。 */
function awaitQueuedSave(session: DocumentSession, deps: FileFlowDeps): Promise<SaveFlowResult> {
  const waiters = queuedSaveWaiters.get(session) ?? [];
  queuedSaveWaiters.set(session, waiters);
  const p = new Promise<SaveFlowResult>((resolve) => {
    waiters.push(resolve);
  });
  ensureSaveQueueDriver(session, deps);
  return p;
}

/**
 * 保存队列的唯一驱动循环：串行执行直到队列空/失败。
 * 防重入：WeakMap 标记在首个 await 前同步置位，完成/失败后在 finally
 * 同步清除——入队与驱动启动之间不存在搁浅窗口。
 */
function ensureSaveQueueDriver(session: DocumentSession, deps: FileFlowDeps): void {
  if (activeQueueDrivers.get(session)) return;
  activeQueueDrivers.set(session, true);
  void (async () => {
    try {
      for (;;) {
        const next = session.takeNextSaveIntent();
        if (next.kind === "empty") return;
        if (next.kind === "dropped-no-target") {
          // 该排队请求以"无目标"终态出队（见 core NextSaveIntent 注释）
          resolveNextWaiter(session, {
            kind: "error",
            code: "SAVE_NO_TARGET",
            message: "尚未选择保存位置；请使用“另存为…”选择目标。",
          });
          continue;
        }
        const { snapshot } = next;
        let receipt: CommitReceipt;
        try {
          receipt = await commitSnapshot(deps, snapshot);
        } catch (e) {
          const failure = platformError(e);
          session.saveFailed(snapshot); // 清空剩余队列（core 失败策略）
          failPendingWaiters(session, failure);
          return;
        }
        session.saveCompleted(snapshot, receipt);
        resolveNextWaiter(session, { kind: "ok", value: { receipt } });
      }
    } finally {
      activeQueueDrivers.delete(session);
    }
  })();
}

function resolveNextWaiter(session: DocumentSession, result: SaveFlowResult): void {
  queuedSaveWaiters.get(session)?.shift()?.(result);
}

/** 失败清队后，把仍在等待的排队请求全部以同一失败终态收尾（不悬挂）。 */
function failPendingWaiters(session: DocumentSession, failure: SaveFlowResult): void {
  const waiters = queuedSaveWaiters.get(session);
  if (!waiters) return;
  for (const resolve of waiters.splice(0)) resolve(failure);
}

export function suggestedName(session: DocumentSession): string {
  const display = session.displayPath;
  const base = display?.split(/[\\/]/).pop() ?? "未命名";
  return base.includes(".") ? base : `${base}.mindmap`;
}

/** 供测试/工具条触发的类型收敛 helper。 */
export type AnyCommand = Command;
export type Document = MindMapDocumentV1;
