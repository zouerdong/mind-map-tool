// 文件命令流（MM-080 ③）：App 层把 FilePort 与 DocumentSession 快照协议接起来。
// 语义（ADR 0003 §4）：
// - ordinary Save 只回传 opaque handle/token（绝不弹选址对话框）；
//   无 handle（新建从未保存）自动转 Save As；
// - Save As 才请求一次性 TargetAuthorization；
// - 成功 → saveCompleted（保存点=冻结 identity）；失败/冲突 → saveFailed，
//   保存身份完全不变（调用方保持 dirty 与提示）；
// - 排队保存：完成后 drain（重新捕获当时状态），适配异步保存期间的编辑。

import {
  decodeDocument,
  emptyDocument,
  type Command,
  type DocumentSession,
  type MindMapDocumentV1,
} from "@mindmap/core";
import {
  PlatformError,
  type CommitReceipt,
  type FilePort,
  type OpenedDocument,
} from "@mindmap/platform";

export type FlowResult<T = undefined> =
  | ({ kind: "ok" } & (T extends undefined ? Record<string, never> : { value: T }))
  | { kind: "cancelled" }
  | { kind: "conflict"; message: string }
  | { kind: "error"; code: string; message: string };

export interface FileFlowDeps {
  filePort: FilePort;
}

function platformError(e: unknown): { kind: "conflict"; message: string } | { kind: "error"; code: string; message: string } {
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

/** open 对话框 → decode → load + adoptOpenedTarget。 */
export async function openDocumentFlow(
  session: DocumentSession,
  deps: FileFlowDeps,
): Promise<FlowResult<{ displayPath: string }>> {
  let opened: OpenedDocument | null;
  try {
    opened = await deps.filePort.openDocument();
  } catch (e) {
    return platformError(e);
  }
  if (opened === null) return { kind: "cancelled" };
  return adoptOpened(session, opened);
}

/** 按路径打开（launch intent 加载，无对话框）。 */
export async function openPathFlow(
  session: DocumentSession,
  deps: FileFlowDeps,
  path: string,
): Promise<FlowResult<{ displayPath: string }>> {
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
  session.load(decoded.doc);
  session.adoptOpenedTarget(
    opened.documentTargetHandle,
    opened.versionToken,
    opened.displayPath,
  );
  return { kind: "ok", value: { displayPath: opened.displayPath } };
}

/** 保存：ordinary（handle+token，无对话框）→ 无 handle 时转 Save As。 */
export async function saveFlow(
  session: DocumentSession,
  deps: FileFlowDeps,
): Promise<FlowResult<{ receipt: CommitReceipt }>> {
  const snapshot = session.requestOrdinarySave();
  if (snapshot === null) return saveAsFlow(session, deps, suggestedName(session));
  try {
    const receipt = await deps.filePort.commitDocument({
      kind: "ordinary",
      documentTargetHandle: snapshot.documentTargetHandle as never,
      expectedVersionToken: snapshot.expectedVersionToken as never,
      contentBytes: snapshot.canonicalBytes,
    });
    session.saveCompleted(snapshot, receipt);
    drainQueue(session, deps);
    return { kind: "ok", value: { receipt } };
  } catch (e) {
    session.saveFailed(snapshot);
    return platformError(e);
  }
}

/** Save As：一次性选址授权 → 提交（成功签发新 handle）。 */
export async function saveAsFlow(
  session: DocumentSession,
  deps: FileFlowDeps,
  suggested: string,
): Promise<FlowResult<{ receipt: CommitReceipt }>> {
  let grant;
  try {
    grant = await deps.filePort.requestTargetAuthorization("document", suggested);
  } catch (e) {
    return platformError(e);
  }
  if (grant === null) return { kind: "cancelled" };
  const snapshot = session.requestSaveAs(grant.authorizationRef);
  if (snapshot === null) return { kind: "error", code: "SAVE_IN_FLIGHT", message: "已有保存进行中" };
  try {
    const receipt = await deps.filePort.commitDocument({
      kind: "save-as",
      authorizationRef: snapshot.authorizationRef as never,
      contentBytes: snapshot.canonicalBytes,
    });
    session.saveCompleted(snapshot, receipt);
    drainQueue(session, deps);
    return { kind: "ok", value: { receipt } };
  } catch (e) {
    session.saveFailed(snapshot);
    return platformError(e);
  }
}

/** 新建：确认丢弃后清空文档与目标身份（load 已清 → ordinary 转回 Save As）。 */
export async function newDocumentFlow(
  session: DocumentSession,
  confirmDiscard: () => Promise<boolean>,
): Promise<{ kind: "ok" } | { kind: "cancelled" }> {
  if (session.isDirty && !(await confirmDiscard())) return { kind: "cancelled" };
  session.load(emptyDocument());
  return { kind: "ok" };
}

/** 排队保存 drain：完成后逐条重新捕获（异步保存期间的新编辑不丢）。 */
function drainQueue(session: DocumentSession, deps: FileFlowDeps): void {
  void (async () => {
    while (session.queuedSaveCount > 0 && !session.hasInFlightSave) {
      const snapshot = session.requestOrdinarySave();
      if (snapshot === null) break; // 无 handle → 留给用户显式 Save As
      try {
        const receipt = await deps.filePort.commitDocument({
          kind: "ordinary",
          documentTargetHandle: snapshot.documentTargetHandle as never,
          expectedVersionToken: snapshot.expectedVersionToken as never,
          contentBytes: snapshot.canonicalBytes,
        });
        session.saveCompleted(snapshot, receipt);
      } catch {
        session.saveFailed(snapshot);
        break; // 失败停止 drain，保持 dirty 交给用户
      }
    }
  })();
}

export function suggestedName(session: DocumentSession): string {
  const display = session.displayPath;
  const base = display?.split(/[\\/]/).pop() ?? "未命名";
  return base.endsWith(".json") || base.includes(".") ? base : `${base}.json`;
}

/** 供测试/工具条触发的类型收敛 helper。 */
export type AnyCommand = Command;
export type Document = MindMapDocumentV1;
