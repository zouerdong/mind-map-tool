// EditorCanvas（MM-050 交付物）：可嵌入的获选 React Flow 画布。
// 组合根（apps/desktop，MM-080）传入 DocumentSession、FontResolver 与容器尺寸；
// 本组件只做交互视图：UI 事件 → InteractionController → core command。
// attribution 保留 React Flow 默认显示（ADR 0002 G1 决定，不得隐藏）。
//
// 状态架构：
// - core document = 唯一事实源；documentVersion 变化 → 投影覆盖受控 nodes/edges；
// - 拖动乐观位移由 RF 受控 state 承担（session-only），
//   onNodeDragStop 一次 MoveNodes（验收：拖动只提交一次 command）；
// - selection / viewport / editingId 均 session-only，不进命令与文件。

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Background,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type NodeProps,
  type OnConnect,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { DocumentSession, Point } from "@mindmap/core";
import { measureNodeBox, type FontResolver } from "@mindmap/export/src/layout.js";
import { documentDefaults, projectDocument, type MindFlowNode } from "../projection/projection.js";
import { createInteractionController } from "../controller/interaction-controller.js";
import { isCompositionEvent } from "./node-text-editor.js";
import { useCanvasSession } from "./use-canvas-session.js";
import { MindNodeView } from "./mind-node.js";

export interface EditorCanvasProps {
  session: DocumentSession;
  fonts: FontResolver;
  /** id 生成注入（默认 crypto.randomUUID；测试/harness 可替换）。 */
  nextNodeId?: () => string;
  nextEdgeId?: () => string;
  /**
   * 外部状态信号：组合根在画布外变更 session（load 新文档、菜单命令、
   * 保存完成等）后自增，驱动画布重投影。
   */
  revision?: number;
  /**
   * 重投影时节点位置的过渡动画时长（ms；0=关闭）。
   * 拖动走乐观态不经过重投影通道，不受影响（MM-085 丝滑整理动画）。
   * prefers-reduced-motion 时强制 0。
   */
  positionTransitionMs?: number;
  className?: string;
  /** 画布外覆层（工具条等；MM-070/MM-080 注入）。 */
  overlay?: ReactNode;
}

// ---- editing 下发通道（节点组件经 context 读取，避免重建 nodeTypes） ----

interface EditingContextValue {
  editingId: string | null;
  fonts: FontResolver;
  onCommitEdit(id: string, text: string): void;
  onCancelEdit(): void;
}

const EditingContext = createContext<EditingContextValue | null>(null);

function EditingMindNode(props: NodeProps) {
  const ctx = useContext(EditingContext);
  if (!ctx) throw new Error("EditingMindNode 必须在 EditorCanvas 内使用");
  const data = props.data as MindFlowNode["data"];
  return (
    <MindNodeView
      {...props}
      data={data}
      fonts={ctx.fonts}
      editing={ctx.editingId === props.id}
      onCommitEdit={ctx.onCommitEdit}
      onCancelEdit={ctx.onCancelEdit}
    />
  );
}

const NODE_TYPES = { mind: EditingMindNode };

let uuidCounter = 0;
function defaultId(prefix: string): string {
  uuidCounter += 1;
  return `${prefix}-${uuidCounter}-${crypto.randomUUID().slice(0, 8)}`;
}

export function EditorCanvas({ session, fonts, nextNodeId, nextEdgeId, revision = 0, positionTransitionMs = 0, className, overlay }: EditorCanvasProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 }); // session-only
  const initial = useMemo(() => projectDocument(session.current.document), [session]);

  const controller = useMemo(
    () =>
      createInteractionController({
        nextNodeId: nextNodeId ?? (() => defaultId("n")),
        nextEdgeId: nextEdgeId ?? (() => defaultId("e")),
        measure: (text, fontId) => measureNodeBox(text, undefined, fontId, fonts), // 权威 size：与 exporter 同源
        currentFont: () => documentDefaults(session.current.document).font,
      }),
    [fonts, nextNodeId, nextEdgeId, session],
  );

  const api = useCanvasSession(session, revision);
  const [rfNodes, setRfNodes, onNodesChangeBase] = useNodesState(initial.nodes);
  const [rfEdges, setRfEdges, onEdgesChangeBase] = useEdgesState(initial.edges);

  // core 重投影同步（commit/undo/redo/外部 revision 后整体覆盖受控 view-model）。
  // 依赖只有 docVersion：setRfNodes/setRfEdges 是稳定 setter，
  // api/projectNow 每渲染新引用 —— 列入依赖会形成 set→render→effect 的无限循环。
  // MM-085：重投影时给节点位置加 CSS 过渡（丝滑整理/undo 动画；
  // 拖动走乐观态不经此通道）；prefers-reduced-motion 强制关闭。
  const docVersion = api.documentVersion;
  const projectNowRef = useRef(api.projectNow);
  projectNowRef.current = api.projectNow;
  const transitionMs = useReducedMotionFlag() ? 0 : positionTransitionMs;
  useEffect(() => {
    const view = projectNowRef.current();
    const nodes =
      transitionMs > 0 && docVersion > 0
        ? view.nodes.map((n) => ({
            ...n,
            style: { ...n.style, transition: `transform ${transitionMs}ms ease` },
          }))
        : view.nodes;
    setRfNodes(nodes);
    setRfEdges(view.edges);
  }, [docVersion, transitionMs, setRfNodes, setRfEdges]); // setRfNodes/Edges 为稳定引用

  // selection（session-only）：从 RF change 流提取，供删除命令。
  // 节点/边靠流来源区分（onNodesChange ↔ onEdgesChange），id 不混入对方集合。
  const selectionRef = useRef<{ nodes: Set<string>; edges: Set<string> }>({
    nodes: new Set(),
    edges: new Set(),
  });
  const trackSelection = useCallback((source: "nodes" | "edges", changes: Array<NodeChange<MindFlowNode> | EdgeChange>) => {
    for (const c of changes) {
      if (c.type !== "select" || !("id" in c)) continue;
      const selected = (c as { selected?: boolean }).selected;
      if (selected === undefined) continue;
      const id = (c as { id: string }).id;
      if (selected) selectionRef.current[source].add(id);
      else selectionRef.current[source].delete(id);
    }
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange<MindFlowNode>[]) => {
      trackSelection("nodes", changes);
      onNodesChangeBase(changes); // 受控 view-model（拖动位移在此本地应用）
    },
    [onNodesChangeBase, trackSelection],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      trackSelection("edges", changes);
      onEdgesChangeBase(changes);
    },
    [onEdgesChangeBase, trackSelection],
  );

  const onNodeDragStop = useCallback(() => {
    // 一次 MoveNodes：当前 view-model 位置 vs core（真实位移才产生命令）。
    const cmd = controller.moveNodes(
      rfNodes.map((n) => ({ id: n.id, position: { x: n.position.x, y: n.position.y } })),
      session.current.document,
    );
    if (cmd) api.commit(cmd);
  }, [api, controller, rfNodes, session]);

  const onConnect = useCallback<OnConnect>(
    (connection: Connection) => {
      const cmd = controller.connect(
        connection.source as string,
        connection.target as string,
        session.current.document,
      );
      if (cmd) api.commit(cmd);
    },
    [api, controller, session],
  );

  // 节点双击进入编辑（RF node 双击事件）。
  const beginEdit = useCallback((id: string) => setEditingId(id), []);

  // RF 12 无 onPaneDoubleClick：wrapper div 双击 + target 判定（panePointFromEvent 内过滤）。
  const onWrapperDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const point = panePointFromEvent(event.nativeEvent, viewport);
      if (!point) return;
      api.commit(controller.createNodeAt(point));
    },
    [api, controller, viewport],
  );

  // 键盘：undo/redo/删除（editing 与 IME 组合期间全部隔离）。
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (editingId !== null) return; // 编辑输入自行处理（NodeTextEditor）
      if (isCompositionEvent(e)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) api.redo();
        else api.undo();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const cmd = controller.deleteSelection(
          [...selectionRef.current.nodes],
          [...selectionRef.current.edges],
        );
        if (cmd) {
          e.preventDefault();
          api.commit(cmd);
        }
      }
    },
    [api, controller, editingId],
  );

  const editingValue = useMemo<EditingContextValue>(
    () => ({
      editingId,
      fonts,
      onCommitEdit: (id, text) => {
        const current = session.current.document.document.nodes.find((n) => n.id === id)?.text ?? "";
        const cmd = controller.commitEditText(id, text, current);
        setEditingId(null);
        if (cmd) api.commit(cmd);
      },
      onCancelEdit: () => setEditingId(null),
    }),
    [api, controller, editingId, fonts, session],
  );

  return (
    <EditingContext.Provider value={editingValue}>
      <div
        className={className}
        style={{ width: "100%", height: "100%", position: "relative" }}
        role="application"
        aria-label="脑图画布"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onDoubleClick={onWrapperDoubleClick}
      >
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          onNodeDoubleClick={(_e, node) => beginEdit(node.id)}
          onMove={(_, vp) => setViewport(vp)} // session-only
          fitView
          nodesConnectable
          selectionOnDrag
          panOnDrag
          zoomOnScroll
          deleteKeyCode={null} // 删除统一走画布 keydown（selection 语义一致）
          proOptions={{ hideAttribution: false }} // G1 决定：保留 attribution
          minZoom={0.2}
          maxZoom={2.5}
        >
          <Background gap={24} />
        </ReactFlow>
        {overlay}
      </div>
    </EditingContext.Provider>
  );
}

/** prefers-reduced-motion 查询（无 matchMedia 环境返回 false）。 */
function useReducedMotionFlag(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** 画布事件 → 画布坐标（viewport 逆变换；target 非 pane 时返回 null）。 */
function panePointFromEvent(
  event: { clientX: number; clientY: number; target: EventTarget | null },
  viewport: Viewport,
): Point | null {
  const target = event.target as HTMLElement | null;
  const pane = target?.closest(".react-flow__pane") as HTMLElement | null;
  if (!pane) return null;
  const rect = pane.getBoundingClientRect();
  const x = (event.clientX - rect.left - viewport.x) / viewport.zoom;
  const y = (event.clientY - rect.top - viewport.y) / viewport.zoom;
  return { x, y };
}
