// 上下文工具条（VRA-050 ③；tokens §4 极简 App Shell 的画布侧）：
// 选中节点 → 节点操作（强调/眉题/字体/字号/粗体/下划线/形状/框线/删除）；
// 选中边 → 线型工具（实/虚/点/删除）。全部经 session.commit 的既有命令系统，
// 不存任何 UI-only 样式。位置为 RF Panel 顶部居中浮层（精确跟随主选卡上方
// 属 VRA-070 壳接入时的坐标精调——本卡保证可发现与可达，位置语义已对）。
//
// runs 说明：本卡字号/粗体/下划线作用于**整节点**（无选区交互时以全区间 runs
// 提交，与 EditNodeText 的 runs 通道同源、可 undo）；编辑器内**文字选区级**
// runs 工具随 VRA-050 后续编辑器选区增强补齐（已在交付记录标注）。

import { useEffect, useRef, useState } from "react";
import { Panel } from "@xyflow/react";
import type { Command, FontToken, LineStyle, MindMapDocumentV1, MindNode, TextRun } from "@mindmap/core";
import { themeTokens } from "../theme/theme-tokens.js";

export interface ContextToolbarSelection {
  nodes: string[];
  edges: string[];
}

interface ContextToolbarProps {
  selection: ContextToolbarSelection;
  document: MindMapDocumentV1;
  onCommand(command: Command): void;
  /** 主选节点 id（selection.nodes 最后选中者）；无节点选中时为 null。 */
  primaryNodeId: string | null;
}

export function ContextToolbar({ selection, document: doc, onCommand, primaryNodeId }: ContextToolbarProps) {
  const theme = doc.document.theme;
  const t = themeTokens(theme);
  const nodeSel = selection.nodes;
  const edgeSel = selection.edges;
  const nothing = nodeSel.length === 0 && edgeSel.length === 0;
  const primary = primaryNodeId !== null ? doc.document.nodes.find((n) => n.id === primaryNodeId) ?? null : null;
  const primaryEdge = edgeSel.length > 0 ? doc.document.edges.find((e) => e.id === edgeSel[edgeSel.length - 1]) ?? null : null;

  const barStyle: React.CSSProperties = {
    display: "flex",
    gap: 4,
    padding: "5px 7px",
    background: theme === "dark" ? "#201D17" : "#FFFDF9",
    border: `1px solid ${theme === "dark" ? "#35312A" : "#E3DFD5"}`,
    borderRadius: 10,
    boxShadow: "0 6px 18px rgba(0,0,0,.12)",
    zIndex: 20,
  };
  const btn = (label: string, onClick: () => void, opts?: { title?: string; active?: boolean; bold?: boolean; underline?: boolean }): React.JSX.Element => (
    <button
      key={label}
      type="button"
      title={opts?.title ?? label}
      aria-pressed={opts?.active}
      onClick={onClick}
      style={{
        font: "inherit",
        fontSize: 12,
        border: "none",
        background: opts?.active ? t.hoverPort : "transparent",
        color: opts?.active ? "#FFFDF9" : t.shellText,
        padding: "4px 8px",
        borderRadius: 6,
        cursor: "pointer",
        fontWeight: opts?.bold ? 700 : 400,
        textDecoration: opts?.underline ? "underline" : undefined,
      }}
    >
      {label}
    </button>
  );
  const sep = (key: string) => (
    <span key={key} style={{ width: 1, background: theme === "dark" ? "#35312A" : "#E3DFD5", margin: "3px 2px" }} />
  );

  if (nothing) return null;

  return (
    <Panel position="top-center" data-testid="context-toolbar" role="toolbar" aria-label="上下文工具">
      <div style={barStyle}>
        {primary !== null ? (
          <NodeTools
            key={primary.id}
            nodeId={primary.id}
            node={primary}
            doc={doc}
            onCommand={onCommand}
            render={{ btn, sep, t }}
            selectionCount={nodeSel.length}
          />
        ) : null}
        {primary !== null && primaryEdge !== null ? sep("mid") : null}
        {primaryEdge !== null ? (
          <EdgeTools edgeId={primaryEdge.id} lineStyle={primaryEdge.lineStyle ?? "solid"} onCommand={onCommand} render={{ btn, t }} />
        ) : null}
        {nodeSel.length > 0
          ? btn("删除", () => onCommand({ kind: "DeleteSelection", nodeIds: [...nodeSel], edgeIds: [...edgeSel] }), { title: "删除选中（⌫）" })
          : null}
      </div>
    </Panel>
  );
}

type BtnRender = (label: string, onClick: () => void, opts?: { title?: string; active?: boolean; bold?: boolean; underline?: boolean }) => React.JSX.Element;

interface RenderCtx {
  btn: BtnRender;
  sep: (key: string) => React.JSX.Element;
  t: ReturnType<typeof themeTokens>;
}

function NodeTools({
  nodeId,
  node,
  doc,
  onCommand,
  render,
  selectionCount,
}: {
  nodeId: string;
  node: MindNode;
  doc: MindMapDocumentV1;
  onCommand: (c: Command) => void;
  render: RenderCtx;
  selectionCount: number;
}) {
  const { btn, sep, t } = render;
  const [kicker, setKicker] = useState(node.kicker ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setKicker(node.kicker ?? ""), [node.id, node.kicker]);

  const font: FontToken = doc.document.font;
  const otherFont: FontToken = font === "noto-sans-sc" ? "lxgw-wenkai" : "noto-sans-sc";
  const wholeRunBold = node.runs?.some((r) => r.bold) === true;

  return (
    <>
      {btn(node.emphasis === true ? "强调✓" : "强调", () => onCommand({ kind: "SetNodeEmphasis", id: nodeId, emphasis: node.emphasis !== true }), { title: "普通/强调角色" })}
      {selectionCount === 1 ? (
        <input
          data-testid="kicker-input"
          aria-label="眉题"
          placeholder="眉题…"
          value={kicker}
          maxLength={40}
          onChange={(e) => {
            const v = e.target.value.replace(/\n/g, "");
            setKicker(v);
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
              onCommand({ kind: "SetNodeKicker", id: nodeId, kicker: v }); // 无 measured：眉题高度差由提交后重投影权威化（VRA-050 交付说明）
            }, 250);
          }}
          onBlur={() => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            onCommand({ kind: "SetNodeKicker", id: nodeId, kicker });
          }}
          style={{
            font: "inherit", fontSize: 12, width: 90, padding: "3px 7px",
            border: `1px solid ${t.shellSubtle}`, borderRadius: 6,
            background: "transparent", color: t.shellText,
          }}
        />
      ) : null}
      {btn(font === "noto-sans-sc" ? "楷体" : "黑体", () => onCommand({ kind: "SetDocumentStyle", font: otherFont }), { title: `文档字体切换（当前 ${font}）` })}
      {btn("A−", () => onCommand({ kind: "EditNodeText", id: nodeId, text: node.text, size: node.size, runs: stepFontSize(node, -2) }), { title: "字号 −2" })}
      {btn("A+", () => onCommand({ kind: "EditNodeText", id: nodeId, text: node.text, size: node.size, runs: stepFontSize(node, 2) }), { title: "字号 +2" })}
      {btn("B", () => onCommand({ kind: "EditNodeText", id: nodeId, text: node.text, size: node.size, runs: toggleWhole(node, "bold") }), { title: "整节点粗体", bold: true, active: wholeRunBold })}
      {btn("U", () => onCommand({ kind: "EditNodeText", id: nodeId, text: node.text, size: node.size, runs: toggleWhole(node, "underline") }), { title: "整节点下划线", underline: true })}
      {sep("shape")}
      {btn(node.shape === "ellipse" ? "卡片" : "手绘圈", () => onCommand({ kind: "SetNodeShape", id: nodeId, shape: node.shape === "ellipse" ? null : "ellipse" }), { title: "单节点形状" })}
      {btn(doc.document.framesVisible === false ? "显示框线" : "隐藏框线", () => onCommand({ kind: "SetDocumentStyle", framesVisible: doc.document.framesVisible === false }), { title: "文档级框线显隐" })}
    </>
  );
}

function EdgeTools({ edgeId, lineStyle, onCommand, render }: { edgeId: string; lineStyle: LineStyle; onCommand: (c: Command) => void; render: { btn: RenderCtx["btn"]; t: RenderCtx["t"] } }) {
  const { btn } = render;
  const set = (s: LineStyle) => () => onCommand({ kind: "SetEdgeLineStyle", id: edgeId, lineStyle: s });
  return (
    <>
      {btn("实线", set("solid"), { active: lineStyle === "solid" })}
      {btn("虚线", set("dashed"), { active: lineStyle === "dashed" })}
      {btn("点线", set("dotted"), { active: lineStyle === "dotted" })}
    </>
  );
}

/** 整节点字号步进：既有 runs 的 fontSize ±step，无 runs 则全区间应用。 */
function stepFontSize(node: MindNode, step: number): TextRun[] {
  if (node.runs === undefined || node.runs.length === 0) {
    return [{ start: 0, end: node.text.length, fontSize: clampSize(16 + step) }];
  }
  return node.runs.map((r) => ({ ...r, ...(r.fontSize !== undefined ? { fontSize: clampSize(r.fontSize + step) } : {}) }));
}
function clampSize(v: number): number {
  return Math.min(72, Math.max(8, Math.round(v)));
}
/** 整节点开关粗体/下划线（全区间 runs）。 */
function toggleWhole(node: MindNode, key: "bold" | "underline"): TextRun[] {
  const currently = node.runs?.some((r) => r[key] === true) === true;
  return [{ start: 0, end: node.text.length, [key]: !currently } as TextRun];
}
