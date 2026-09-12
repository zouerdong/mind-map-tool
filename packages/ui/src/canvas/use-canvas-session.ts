// 画布会话 hook（MM-050 ⑤）：core 单一事实源驱动的命令通道。
// 职责（刻意收窄）：
// - 版本号驱动重投影：commit/undo/redo 后 documentVersion 自增，
//   EditorCanvas 以此为信号用投影覆盖受控 view-model；
// - view-model（含拖动乐观位移）由 React Flow 的受控 state 承担，
//   drag stop 时 EditorCanvas 用当前 view-model 位置 diff core 提交一次 MoveNodes；
// - selection 与 viewport 是 session-only，绝不进入命令或文件。
// 命令失败（CommandError）返回 false：core 状态未变，投影保持一致。

import { useCallback, useRef, useState } from "react";
import type { Command, DocumentSession } from "@mindmap/core";
import { projectDocument } from "../projection/projection.js";

export interface CanvasSessionApi {
  /** 自增版本号：core 状态变化（内部 commit/undo/redo 或外部 revision）的信号。 */
  documentVersion: number;
  /** 当前 core 状态的整体投影（重同步时调用）。 */
  projectNow(): ReturnType<typeof projectDocument>;
  commit(command: Command): boolean;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
  isDirty: boolean;
}

/**
 * @param session core 会话（可变容器）
 * @param externalRevision 外部状态信号（组合根 load/菜单命令等画布外变更后自增）
 */
export function useCanvasSession(session: DocumentSession, externalRevision = 0): CanvasSessionApi {
  const [internalVersion, setInternalVersion] = useState(0);
  const versionRef = useRef(0);
  const documentVersion = internalVersion + externalRevision;

  // 投影纯函数的自洽性由 projection contract tests 锁定。不要在生产 render
  // 路径把可变 session 与上一版本的缓存投影比较并抛错：外部命令与 React
  // state 通知之间即使只存在一个微任务窗口，也会把整张画布替换成错误页，
  // 对用户数据没有任何保护作用。所有正式变更仍必须经下方 commit/undo/redo
  // 或 externalRevision 驱动重投影。

  const bump = useCallback(() => {
    versionRef.current += 1;
    setInternalVersion(versionRef.current);
  }, []);

  const commit = useCallback(
    (command: Command): boolean => {
      const result = session.commit(command);
      if (!result.ok) return false;
      bump();
      return true;
    },
    [session, bump],
  );

  const undo = useCallback(() => {
    if (session.undo()) bump();
  }, [session, bump]);

  const redo = useCallback(() => {
    if (session.redo()) bump();
  }, [session, bump]);

  return {
    documentVersion,
    projectNow: () => projectDocument(session.current.document),
    commit,
    undo,
    redo,
    canUndo: session.canUndo,
    canRedo: session.canRedo,
    isDirty: session.isDirty,
  };
}
