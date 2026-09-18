// 显示用平台探测（ADR 0017 双平台）：仅决定 UI 文案中的键位徽记
// （mac=⌘系字形 / pc=Ctrl 系文字）。功能键位不依赖本探测——原生菜单
// accelerator 用 `CmdOrCtrl`，WebView keydown 用 `metaKey || ctrlKey`，
// 行为在任一平台都正确；本模块只影响「显示什么字」。
// 探测放组合根（apps/desktop）：packages/ui 保持平台无关，平台经 props
// 注入。Tauri WebView2 UA 含 "Windows"，WKWebView 含 "Macintosh"；
// 未知环境默认 mac（保持历史行为），Linux/Android 归 pc（Ctrl 系）。

import type { ShortcutPlatform } from "@mindmap/ui";

export function detectShortcutPlatform(
  userAgent: string | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator.userAgent,
): ShortcutPlatform {
  if (userAgent === undefined) return "mac";
  return /windows|linux|android/i.test(userAgent) ? "pc" : "mac";
}
