// 主题切换入口（MM-070 ①）：提交 SetDocumentStyle（主题持久化、可 undo、
// 触发 dirty —— ADR 0003/AC-04）。不直接改画布：命令经 core → 投影更新。
// 组合根（MM-080）把本组件放进菜单/工具条。

import { useCallback } from "react";
import type { Command, ThemeName } from "@mindmap/core";

export interface ThemeToggleProps {
  currentTheme: ThemeName;
  /** 命令通道（EditorCanvas 同源 commit；MM-080 接线时传入组合根通道）。 */
  onCommand(command: Command): void;
  /** 键盘可达性：默认可聚焦按钮。 */
  disabled?: boolean;
}

/** 白板/黑板切换按钮（纯语义按钮，无装饰）。 */
export function ThemeToggle({ currentTheme, onCommand, disabled }: ThemeToggleProps) {
  const next: ThemeName = currentTheme === "dark" ? "light" : "dark";
  const label = currentTheme === "dark" ? "切换到白板主题" : "切换到黑板主题";
  const toggle = useCallback(() => {
    onCommand({ kind: "SetDocumentStyle", theme: next });
  }, [next, onCommand]);
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      aria-label={label}
      data-onboarding-anchor="theme.toggle"
      title={label}
    >
      {currentTheme === "dark" ? "○ 白板" : "● 黑板"}
    </button>
  );
}
