// 节点文本编辑输入（MM-050 ⑥：IME 安全；提交键定稿 2026-08-29）：
// - composition 开始到结束期间，任何全局快捷键（undo/redo/delete 等）
//   不得由编辑态派发（composing 隔离）；
// - Enter 换行（不拦截，textarea 默认）；⌘Enter/Ctrl+Enter 提交
//   （IME 确认的 Enter 表现为 keyCode 229，不触发提交逻辑）；
// - Escape 取消；blur 提交；
// - 自动聚焦与全选，中/英/日输入法行为一致。

import { useEffect, useRef, useState } from "react";
import { LAYOUT } from "@mindmap/export/src/layout.js";

export interface NodeTextEditorProps {
  initialText: string;
  onCommit(text: string): void;
  onCancel(): void;
  /** 所见即所得外观（用户实测 2026-08-29：继承来的字号/字体与提交后渲染
   *  不一致，且小节点里一行塞不下一个汉字）。不传则退化为填满容器（单测直渲）。 */
  fontFamily?: string;
  fontSize?: number;
  textColor?: string;
  background?: string;
  /** 传入时编辑框随输入实时增长——与提交后渲染同一测量源（measureNodeBox），
   *  提交瞬间无跳变。文档尺寸仍在提交时由 core 权威写入，此处只是视觉先行。 */
  measureBox?: (text: string) => { width: number; height: number };
  /** 每次测量结果上报（节点外框同步跟随增长）。 */
  onMeasure?: (box: { width: number; height: number }) => void;
}

export function NodeTextEditor({
  initialText,
  onCommit,
  onCancel,
  fontFamily,
  fontSize,
  textColor,
  background,
  measureBox,
  onMeasure,
}: NodeTextEditorProps) {
  const [value, setValue] = useState(initialText);
  const [composing, setComposing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const committedRef = useRef(false);

  const effectiveFontSize = fontSize ?? LAYOUT.baseFontSize;
  const box = measureBox?.(value);

  // 每次输入把测量框上报给节点外框（含首帧：空节点也要让外框知道编辑尺寸）。
  // 依赖用基本类型而非 box 对象——box 每次渲染都是新引用，直接依赖会无限循环。
  const boxW = box?.width;
  const boxH = box?.height;
  useEffect(() => {
    if (boxW != null && boxH != null) onMeasure?.({ width: boxW, height: boxH });
  }, [boxW, boxH, onMeasure]);

  useEffect(() => {
    // MM-090-D8：窗口激活竞态——quick-create 从后台唤起时 textarea.focus()
    // 可能在窗口成为 key window 前执行而静默失败，且此后无人重试（用户
    // 实测：IME 弹出但字不落）。改为轮询重试至 activeElement 真正命中。
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tryFocus = () => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.select();
      if (document.activeElement === el || ++tries > 20) return; // 最多 ~2s
      timer = setTimeout(tryFocus, 100);
    };
    tryFocus();
    return () => clearTimeout(timer);
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
        top: 0,
        left: 0,
        // 实时增长：随输入按提交后同一测量口径扩框（max 保证不缩得比节点小）
        width: box ? `max(100%, ${box.width}px)` : "100%",
        height: box ? `max(100%, ${box.height}px)` : "100%",
        boxSizing: "border-box",
        resize: "none",
        border: "none",
        outline: "none",
        background: background ?? "transparent",
        fontSize: effectiveFontSize,
        lineHeight: `${effectiveFontSize * LAYOUT.lineHeightFactor}px`,
        fontFamily,
        padding: `${LAYOUT.paddingY}px ${LAYOUT.paddingX}px`,
        color: textColor ?? "inherit",
        caretColor: textColor,
        // 与提交后渲染一致：只按 \n 分行，不软换行（layoutNodeText 语义）
        whiteSpace: "pre",
        overflow: "hidden",
      }}
    />
  );
}

/** 供画布层查询：当前事件是否处于 IME 组合（快捷键隔离）。 */
export function isCompositionEvent(e: React.KeyboardEvent): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229;
}
