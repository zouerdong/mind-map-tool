// 节点文本编辑输入（MM-050 ⑥：IME 安全；提交键定稿 2026-08-29）：
// - composition 开始到结束期间，任何全局快捷键（undo/redo/delete 等）
//   不得由编辑态派发（composing 隔离）；
// - Enter 换行（不拦截，textarea 默认）；⌘Enter/Ctrl+Enter 提交
//   （IME 确认的 Enter 表现为 keyCode 229，不触发提交逻辑）；
// - Escape 取消；blur 提交；
// - 自动聚焦与全选，中/英/日输入法行为一致。

import { useEffect, useRef, useState } from "react";

export interface NodeTextEditorProps {
  initialText: string;
  onCommit(text: string): void;
  onCancel(): void;
}

export function NodeTextEditor({ initialText, onCommit, onCancel }: NodeTextEditorProps) {
  const [value, setValue] = useState(initialText);
  const [composing, setComposing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commitOnce = (text: string) => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(text);
  };

  return (
    <textarea
      ref={ref}
      value={value}
      aria-label="编辑节点文本"
      onChange={(e) => setValue(e.target.value)}
      onCompositionStart={() => setComposing(true)}
      onCompositionEnd={(e) => {
        setComposing(false);
        setValue(e.currentTarget.value); // 各浏览器 compositionend 后值同步差异兜底
      }}
      onKeyDown={(e) => {
        // IME 组合中：不拦截任何键（含 Enter/Escape——组合确认优先）。
        if (composing || e.nativeEvent.isComposing || e.keyCode === 229) return;
        const mod = e.metaKey || e.ctrlKey;
        if (e.key === "Enter" && mod) {
          // ⌘Enter 提交（Enter 本身留给换行——textarea 默认行为）。
          e.preventDefault();
          e.stopPropagation();
          commitOnce(value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          committedRef.current = true;
          onCancel();
        }
        // 其他按键（含快捷键字母、无修饰 Enter 换行）走 textarea 默认行为；
        // undo/redo 等全局键由画布层在 editing 态跳过（见 editor-canvas）。
      }}
      onBlur={() => commitOnce(value)}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        resize: "none",
        border: "none",
        outline: "none",
        background: "transparent",
        font: "inherit",
        fontFamily: "inherit",
        padding: "8px 10px",
        color: "inherit",
        overflow: "hidden",
      }}
    />
  );
}

/** 供画布层查询：当前事件是否处于 IME 组合（快捷键隔离）。 */
export function isCompositionEvent(e: React.KeyboardEvent): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229;
}
