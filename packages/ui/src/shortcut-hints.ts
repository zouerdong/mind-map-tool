// 快捷键显示提示（ADR 0017 双平台）：UI 文案中的键位徽记按平台渲染。
// 纯展示层：功能键位由原生菜单 `CmdOrCtrl` accelerator 与 keydown
// `metaKey || ctrlKey` 保证跨平台正确，本模块只决定「显示什么字」。
// 平台由组合根（apps/desktop）探测后经 props 注入；本包不探测 OS
// （packages/ui 平台无关约束，PRD §1.1）。

export type ShortcutPlatform = "mac" | "pc";

export interface ShortcutHints {
  /** 快捷建节点（全局唤起热键默认）。 */
  quickCreate: string;
  /** 节点文字编辑确认提交。 */
  confirmEdit: string;
  undo: string;
  redo: string;
  /** 一键整理 / 还原整理前布局。 */
  organize: string;
  save: string;
  storeAs: string;
  /** 统一存储/导出面板。 */
  exportPanel: string;
  newDoc: string;
  openDoc: string;
  /** 帮助 / 重放引导。 */
  help: string;
}

const MAC_HINTS: ShortcutHints = {
  quickCreate: "⌥Space",
  confirmEdit: "⌘Enter",
  undo: "⌘Z",
  redo: "⇧⌘Z",
  organize: "⇧⌘L",
  save: "⌘S",
  storeAs: "⌘⇧S",
  exportPanel: "⌘E",
  newDoc: "⌘N",
  openDoc: "⌘O",
  help: "⌘⇧H",
};

// Windows 修饰键序遵循 Microsoft 惯例：Ctrl+Shift+Alt+键。
const PC_HINTS: ShortcutHints = {
  quickCreate: "Alt+Space",
  confirmEdit: "Ctrl+Enter",
  undo: "Ctrl+Z",
  redo: "Ctrl+Shift+Z",
  organize: "Ctrl+Shift+L",
  save: "Ctrl+S",
  storeAs: "Ctrl+Shift+S",
  exportPanel: "Ctrl+E",
  newDoc: "Ctrl+N",
  openDoc: "Ctrl+O",
  help: "Ctrl+Shift+H",
};

export function shortcutHints(platform: ShortcutPlatform): ShortcutHints {
  return platform === "mac" ? MAC_HINTS : PC_HINTS;
}
