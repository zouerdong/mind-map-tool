// 快捷键归一（MM-080 ②）：全局快捷键表（单一事实源，见 shortcut-table.md）。
// 隔离规则（PRD §6/AC-02）：
// - 输入控件（textarea/input/contenteditable）内除 Escape 外不派发；
// - IME 组合（isComposing / keyCode 229）不派发；
// - undo/redo 由画布处理（focus 在画布时），此处不重复。

export type ShortcutAction =
  | "new"
  | "open"
  | "save"
  | "save-as"
  | "export-panel"
  | "replay-onboarding";

export interface NormalizedShortcut {
  action: ShortcutAction;
  id: string;
}

const isEditable = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "TEXTAREA" ||
    target.tagName === "INPUT" ||
    target.isContentEditable
  );
};

const isComposing = (e: KeyboardEvent): boolean => e.isComposing || e.keyCode === 229;

/** 从 keydown 归一化快捷键；不匹配或被隔离返回 null。 */
export function normalizeShortcut(e: KeyboardEvent): NormalizedShortcut | null {
  if (isComposing(e)) return null;
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return null;
  // 输入态隔离：文本编辑自身处理按键（Enter/Escape 等）
  if (isEditable(e.target)) return null;

  const key = e.key.toLowerCase();
  if (key === "s") return e.shiftKey ? { action: "save-as", id: "mod+shift+s" } : { action: "save", id: "mod+s" };
  if (key === "o" && !e.shiftKey) return { action: "open", id: "mod+o" };
  if (key === "n" && !e.shiftKey) return { action: "new", id: "mod+n" };
  if (key === "e" && !e.shiftKey) return { action: "export-panel", id: "mod+e" };
  if (key === "h" && e.shiftKey) return { action: "replay-onboarding", id: "mod+shift+h" };
  return null;
}
