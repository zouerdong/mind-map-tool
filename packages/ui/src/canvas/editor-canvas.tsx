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

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type NodeProps,
  type OnConnect,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  organizeCommand,
  type DocumentSession,
  type OrganizeCommandResult,
  type Point,
} from "@mindmap/core";
import { measureNodeBox, type FontResolver } from "@mindmap/export/src/layout.js";
import { measureNodeVisual } from "@mindmap/export/src/visual-style.js";
import type { LayoutDirection } from "@mindmap/export/src/edge-geometry.js";
import {
  documentDefaults,
  projectDocument,
  type MindFlowEdge,
  type MindFlowNode,
} from "../projection/projection.js";
import { createInteractionController } from "../controller/interaction-controller.js";
import { isCompositionEvent } from "./node-text-editor.js";
import { useCanvasSession } from "./use-canvas-session.js";
import { MindNodeView } from "./mind-node.js";
import { MindEdgeView } from "./mind-edge.js";
import { ContextToolbar } from "./context-toolbar.js";
import { themeTokens } from "../theme/theme-tokens.js";
import type { GeometryBarrier } from "./geometry-barrier.js";
import {
  MotionCoordinator,
  computeCoordinatedViewport,
  type MotionFrame,
} from "./motion-coordinator.js";
import {
  linkingReducer,
  nearestNodeInDirection,
  type LinkingState,
  type NavDirection,
} from "./keyboard-navigation.js";

export interface EditorCanvasProps {
  session: DocumentSession;
  fonts: FontResolver;
  /** PRC-025 权威几何提交屏障：未 ready 前阻断 fallback size 持久化写入。 */
  geometryBarrier?: GeometryBarrier;
  /** 供上层（Save/Close 等）在提交前 flush 活动编辑器的当前文本。 */
  activeEditorRef?: React.MutableRefObject<{ flush(): void } | null>;
  /** id 生成注入（默认 crypto.randomUUID；测试/harness 可替换）。 */
  nextNodeId?: () => string;
  nextEdgeId?: () => string;
  /**
   * 外部状态信号：组合根在画布外变更 session（load 新文档、菜单命令、
   * 保存完成等）后自增，驱动画布重投影。
   */
  revision?: number;
  /**
   * 快捷建节点信号（键位定稿 2026-08-29）：组合根收到全局热键
   * `quick-create` 事件（画布已聚焦态，⌥Space 同键分流）后自增；
   * 画布在视口中心建节点并自动进入编辑。编辑/连线态忽略（不打断）。
   */
  quickCreateSignal?: number;
  /**
   * 视野框架化信号（用户实测 2026-08-29）：声明式 fitView 会在「空文档
   * 首次建点」时触发——单个小节点被 fit 到 maxZoom 2.5，用户感觉「字巨大」。
   * 改为显式信号：只在文档加载（打开/新建/启动路由）时框架化，
   * 用户建点永不拉动镜头。
   */
  fitViewSignal?: number;
  /**
   * 整理动画触发信号（VRA-060）：外部触发整理动作时自增此信号。
   */
  organizeSignal?: number;
  /**
   * 整理布局方向（默认 horizontal；G-VIS D7）。
   */
  organizeDirection?: LayoutDirection;
  /**
   * 整理结果回调（通知上层成功/no-op/超限错误）。
   */
  onOrganizeResult?: (result: OrganizeCommandResult) => void;
  /**
   * 整理完成回调。
   */
  onOrganizeComplete?: () => void;
  /**
   * @deprecated 兼容历史 prop；VRA-060 起由 motion-coordinator 统一接管，普通交互不再套全局 transition。
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
  /** 键盘焦点节点（MM-089；焦点环视觉）。 */
  focusId: string | null;
  /** 键盘连线模式当前候选（高亮）。 */
  linkCandidateId: string | null;
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
      focused={ctx.focusId === props.id}
      linkCandidate={ctx.linkCandidateId === props.id}
      onCommitEdit={ctx.onCommitEdit}
      onCancelEdit={ctx.onCancelEdit}
    />
  );
}

const NODE_TYPES = { mind: EditingMindNode };
const EDGE_TYPES = { mind: MindEdgeView };

let uuidCounter = 0;
function defaultId(prefix: string): string {
  uuidCounter += 1;
  return `${prefix}-${uuidCounter}-${crypto.randomUUID().slice(0, 8)}`;
}

export function EditorCanvas({
  session,
  fonts,
  geometryBarrier,
  activeEditorRef,
  nextNodeId,
  nextEdgeId,
  revision = 0,
  quickCreateSignal = 0,
  fitViewSignal = 0,
  organizeSignal = 0,
  organizeDirection = "horizontal",
  onOrganizeResult,
  onOrganizeComplete,
  positionTransitionMs: _positionTransitionMs = 0,
  className,
  overlay,
}: EditorCanvasProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 }); // session-only
  const initial = useMemo(() => projectDocument(session.current.document), [session]);

  const [pendingNodes, setPendingNodes] = useState<
    Map<string, { id: string; position: Point; text: string }>
  >(new Map());
  const [textOverrides, setTextOverrides] = useState<Map<string, string>>(new Map());

  const applyPendingAndOverrides = useCallback(
    (nodes: MindFlowNode[]): MindFlowNode[] => {
      let result = nodes;
      if (textOverrides.size > 0) {
        result = result.map((n) => {
          const o = textOverrides.get(n.id);
          return o !== undefined ? { ...n, data: { ...n.data, text: o } } : n;
        });
      }
      if (pendingNodes.size > 0) {
        const existingIds = new Set(result.map((n) => n.id));
        const pNodes: MindFlowNode[] = Array.from(pendingNodes.values())
          .filter((p) => !existingIds.has(p.id))
          .map((p) => ({
            id: p.id,
            type: "mind",
            position: { x: p.position.x, y: p.position.y },
            data: {
              text: p.text,
              runs: undefined,
              kicker: undefined,
              emphasis: false,
              shape: documentDefaults(session.current.document).shape,
              theme: session.current.document.document.theme,
              font: documentDefaults(session.current.document).font,
              framesVisible: session.current.document.document.framesVisible,
            },
            width: 60,
            height: 37,
          }));
        result = [...result, ...pNodes];
      }
      return result;
    },
    [pendingNodes, session, textOverrides],
  );

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

  const coordinatorRef = useRef<MotionCoordinator>(new MotionCoordinator());
  const reducedMotion = useReducedMotionFlag();
  const displayPositionsRef = useRef<Map<string, Point>>(
    new Map(initial.nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }])),
  );

  // 卸载清理动画
  useEffect(() => {
    return () => {
      coordinatorRef.current.cancel();
    };
  }, []);

  // 显式整理信号（organizeSignal）
  const lastOrganizeSignalRef = useRef(organizeSignal);
  useEffect(() => {
    if (organizeSignal === 0 || organizeSignal === lastOrganizeSignalRef.current) return;
    lastOrganizeSignalRef.current = organizeSignal;

    const result = organizeCommand(session.current.document, { direction: organizeDirection });
    onOrganizeResult?.(result);
    if (result.status === "moved") {
      api.commit(result.command);
    }
  }, [organizeSignal, organizeDirection, onOrganizeResult, api, session]);

  // core 重投影同步
  // VRA-060：由 MotionCoordinator 统一接管整理/undo 动画；彻底移除旧 MM-085 的全局 CSS transition。
  // 拖动、文本编辑、节点增删等普通操作无过渡直接更新。
  const docVersion = api.documentVersion;
  const projectNowRef = useRef(api.projectNow);
  projectNowRef.current = api.projectNow;
  const lastDocVersionRef = useRef(docVersion);
  const lastRevisionRef = useRef(revision);

  useEffect(() => {
    const isExternalRevision = revision !== lastRevisionRef.current;
    lastRevisionRef.current = revision;
    const isDocChange = docVersion !== lastDocVersionRef.current;
    lastDocVersionRef.current = docVersion;

    const view = projectNowRef.current();
    const doc = session.current.document;

    // 若外部 revision 导致文档切换（例如 session.load）
    if (isExternalRevision && !isDocChange) {
      coordinatorRef.current.cancel();
      displayPositionsRef.current = new Map(
        view.nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]),
      );
      setRfNodes(applyPendingAndOverrides(view.nodes));
      setRfEdges(view.edges);
      return;
    }

    if (isDocChange) {
      setPendingNodes(new Map());
      setTextOverrides(new Map());
    }

    // 检查是否发生了多节点布局重排（整理动作提交或 undo/redo）
    let movedCount = 0;
    const targetPositions = new Map<string, Point>();
    for (const n of doc.document.nodes) {
      targetPositions.set(n.id, { x: n.position.x, y: n.position.y });
      const cur = displayPositionsRef.current.get(n.id);
      if (cur && (Math.abs(cur.x - n.position.x) > 1 || Math.abs(cur.y - n.position.y) > 1)) {
        movedCount++;
      }
    }

    // 若正在动画中或者有多节点位置变更（且不是单节点拖拽提交）
    if (movedCount >= 2 || coordinatorRef.current.getPhase() === "running") {
      const isUndo = session.canRedo; // undo 导致的重排
      const onFrame = (frame: MotionFrame) => {
        setRfNodes((prevNodes) =>
          prevNodes.map((n) => {
            const p = frame.positions.get(n.id);
            if (!p) return n;
            displayPositionsRef.current.set(n.id, p);
            return { ...n, position: { x: p.x, y: p.y } };
          }),
        );
        setRfEdges((prevEdges) =>
          prevEdges.map((e) => {
            const geom = frame.edgePaths.get(e.id);
            if (!geom || !e.data) return e;
            const updated: MindFlowEdge = {
              ...e,
              data: {
                lineStyle: e.data.lineStyle,
                theme: e.data.theme,
                pathD: geom.pathD,
                arrowD: geom.arrowD,
              },
            };
            return updated;
          }),
        );
      };

      if (isUndo) {
        coordinatorRef.current.reverseTo(doc, targetPositions, {
          direction: organizeDirection,
          reducedMotion,
          onFrame,
          onComplete: () => {
            onOrganizeComplete?.();
          },
        });
      } else {
        // 视口一次性协调
        const pane = paneRectFromDom();
        if (pane && rfInstanceRef.current) {
          const { target, needed } = computeCoordinatedViewport(
            displayPositionsRef.current,
            targetPositions,
            doc,
            pane.width,
            pane.height,
            rfInstanceRef.current.getViewport(),
          );
          if (needed) {
            void rfInstanceRef.current.setViewport(target, { duration: 600 });
          }
        }
        coordinatorRef.current.start(doc, displayPositionsRef.current, targetPositions, {
          direction: organizeDirection,
          reducedMotion,
          onFrame,
          onComplete: () => {
            onOrganizeComplete?.();
          },
        });
      }
      return;
    }

    // 普通编辑、文本修改、增删节点、单节点拖动结束等：直接投影，不套动画
    displayPositionsRef.current = new Map(
      view.nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]),
    );
    setRfNodes(applyPendingAndOverrides(view.nodes));
    setRfEdges(view.edges);
  }, [
    applyPendingAndOverrides,
    docVersion,
    revision,
    reducedMotion,
    organizeDirection,
    onOrganizeComplete,
    setRfNodes,
    setRfEdges,
    session,
  ]);

  useEffect(() => {
    if (pendingNodes.size === 0 && textOverrides.size === 0) return;
    const view = projectNowRef.current();
    setRfNodes(applyPendingAndOverrides(view.nodes));
  }, [pendingNodes, textOverrides, applyPendingAndOverrides, setRfNodes]);

  // selection（session-only）：从 RF change 流提取，供删除命令与上下文工具条。
  // 节点/边靠流来源区分（onNodesChange ↔ onEdgesChange），id 不混入对方集合。
  const selectionRef = useRef<{ nodes: Set<string>; edges: Set<string> }>({
    nodes: new Set(),
    edges: new Set(),
  });
  // VRA-050：工具条需要响应选中（ref 不触发渲染）——同步一份 state；
  // primary = 最后选中的节点（主选：角标记 + 工具条目标）。
  const [uiSelection, setUiSelection] = useState<{
    nodes: string[];
    edges: string[];
    primary: string | null;
  }>({
    nodes: [],
    edges: [],
    primary: null,
  });
  const primaryRef = useRef<string | null>(null);
  const trackSelection = useCallback(
    (source: "nodes" | "edges", changes: Array<NodeChange<MindFlowNode> | EdgeChange>) => {
      let touched = false;
      for (const c of changes) {
        if (c.type !== "select" || !("id" in c)) continue;
        const selected = (c as { selected?: boolean }).selected;
        if (selected === undefined) continue;
        const id = (c as { id: string }).id;
        if (selected) {
          selectionRef.current[source].add(id);
          if (source === "nodes") primaryRef.current = id;
          touched = true;
        } else if (selectionRef.current[source].delete(id)) {
          if (source === "nodes" && primaryRef.current === id) primaryRef.current = null;
          touched = true;
        }
      }
      if (touched) {
        setUiSelection({
          nodes: [...selectionRef.current.nodes],
          edges: [...selectionRef.current.edges],
          primary: primaryRef.current,
        });
      }
    },
    [],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<MindFlowNode>[]) => {
      trackSelection("nodes", changes);
      // 若动画运行中，用户拖拽节点立即打断接管该节点
      for (const c of changes) {
        if (c.type === "position" && c.position) {
          coordinatorRef.current.interruptNode(c.id, c.position);
          displayPositionsRef.current.set(c.id, c.position);
        }
      }
      onNodesChangeBase(changes); // 受控 view-model（拖动位移在此本地应用）
    },
    [onNodesChangeBase, trackSelection],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<MindFlowEdge>[]) => {
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
      if (geometryBarrier && geometryBarrier.getMetricsState() !== "ready") {
        const id = (nextNodeId ?? (() => defaultId("n")))();
        void geometryBarrier.enqueue({ kind: "create-node", id, position: point, text: "" });
        setPendingNodes((prev) => new Map(prev).set(id, { id, position: point, text: "" }));
      } else {
        api.commit(controller.createNodeAt(point));
      }
    },
    [api, controller, geometryBarrier, nextNodeId, viewport],
  );

  // 键盘全集（MM-089；editing 与 IME 组合期间全部隔离；键位占位可改——
  // 最终键位待键位专项讨论，机制与键位解耦）。
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [linking, setLinking] = useState<LinkingState>({ phase: "idle" });
  const rfInstanceRef = useRef<ReactFlowInstance<MindFlowNode, MindFlowEdge> | null>(null);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (editingId !== null) return; // 编辑输入自行处理（NodeTextEditor）
      if (isCompositionEvent(e)) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      // 缩放（⌘+ / ⌘- / ⌘0 fit）
      if (mod && (key === "0" || e.key === "+" || e.key === "-" || e.key === "=")) {
        e.preventDefault();
        if (key === "0") void rfInstanceRef.current?.fitView({ padding: 0.2 });
        else if (e.key === "-" || key === "-") void rfInstanceRef.current?.zoomOut();
        else void rfInstanceRef.current?.zoomIn();
        return;
      }
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) api.redo();
        else api.undo();
        return;
      }
      // ⌘A 全选（受控 selected 更新 + selectionRef 同步）
      if (mod && key === "a") {
        e.preventDefault();
        const all = rfNodes.map((n) => n.id);
        setRfNodes((ns) => ns.map((n) => ({ ...n, selected: true })));
        selectionRef.current = { nodes: new Set(all), edges: new Set() };
        return;
      }
      // ⌘L：键盘连线流（从焦点或首个选中发起；占位键位）
      if (mod && key === "l" && !e.shiftKey) {
        e.preventDefault();
        const source = focusNodeId ?? [...selectionRef.current.nodes][0] ?? rfNodes[0]?.id ?? null;
        if (source === null) return;
        const r = linkingReducer(linking, { type: "begin", sourceId: source }, rfNodes);
        setLinking(r.state);
        setFocusNodeId(source);
        return;
      }

      // 方向键：连线模式下换候选；否则焦点导航
      const dir = arrowDirection(e.key);
      if (dir !== null) {
        e.preventDefault();
        if (linking.phase === "linking") {
          const r = linkingReducer(linking, { type: "retarget", direction: dir }, rfNodes);
          setLinking(r.state);
          if (r.state.phase === "linking" && r.state.candidateId)
            setFocusNodeId(r.state.candidateId);
          return;
        }
        const current = focusNodeId ?? rfNodes[0]?.id ?? null;
        if (current === null) return;
        setFocusNodeId(nearestNodeInDirection(rfNodes, current, dir) ?? current);
        return;
      }

      // Enter：连线确认 / 焦点进编辑（键位定稿 2026-08-29：建节点归 ⌥Space 同键分流）
      if (e.key === "Enter") {
        e.preventDefault();
        if (linking.phase === "linking") {
          const r = linkingReducer(linking, { type: "confirm" }, rfNodes);
          setLinking(r.state);
          if (r.confirmed) {
            const cmd = controller.connect(
              r.confirmed.source,
              r.confirmed.target,
              session.current.document,
            );
            if (cmd) api.commit(cmd);
          }
          return;
        }
        if (focusNodeId !== null) beginEdit(focusNodeId);
        return;
      }
      if (e.key === "Escape" && linking.phase === "linking") {
        e.preventDefault();
        setLinking(linkingReducer(linking, { type: "cancel" }, rfNodes).state);
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
    [api, beginEdit, controller, editingId, focusNodeId, linking, rfNodes, session],
  );

  // 快捷建节点（键位定稿 2026-08-29）：组合根 quickCreateSignal 自增驱动——
  // 视口中心建节点 + 自动进编辑（「捕捉 idea」闭环：按 ⌥Space → 直接打字）。
  // 编辑/连线态忽略（不打断进行中的工作）；初始 mount（signal=0）不触发。
  // MM-090-D8 终案（用户决策：回归原设计）——⌥Space 直达建点+进编辑：
  // 空节点建于视口中心、自动开编辑（NodeTextEditor 挂载即重试抢焦，
  // 窗口激活动画完成后的某次重试会命中）。编辑态下本信号解释为
  // 「焦点修复」：重新聚焦编辑框（极端情况再按一次=聚焦，不盲建）。
  const lastQuickCreateRef = useRef(quickCreateSignal);
  useEffect(() => {
    if (quickCreateSignal === lastQuickCreateRef.current) return;
    lastQuickCreateRef.current = quickCreateSignal;
    if (editingId !== null) {
      document.querySelector<HTMLTextAreaElement>('[aria-label="编辑节点文本"]')?.focus();
      return;
    }
    if (linking.phase === "linking") return;
    const pane = paneRectFromDom();
    if (!pane || !rfInstanceRef.current) return;
    const center = rfInstanceRef.current.screenToFlowPosition({
      x: pane.left + pane.width / 2,
      y: pane.top + pane.height / 2,
    });
    const id = (nextNodeId ?? (() => defaultId("n")))();
    const pos = {
      x: Math.round(center.x * 1000) / 1000,
      y: Math.round(center.y * 1000) / 1000,
    };

    if (geometryBarrier && geometryBarrier.getMetricsState() !== "ready") {
      void geometryBarrier.enqueue({ kind: "create-node", id, position: pos, text: "" });
      setPendingNodes((prev) => new Map(prev).set(id, { id, position: pos, text: "" }));
      setFocusNodeId(id);
      beginEdit(id);
    } else {
      const cmd = controller.createNodeAt(pos);
      api.commit(cmd);
      if (cmd.kind === "CreateNode") {
        setFocusNodeId(cmd.id);
        beginEdit(cmd.id);
      }
    }
  }, [
    quickCreateSignal,
    api,
    beginEdit,
    controller,
    editingId,
    geometryBarrier,
    linking,
    nextNodeId,
  ]);

  // 视野框架化（fitViewSignal）：文档加载后组合根自增信号，画布 frame 内容。
  // 刻意不做声明式 fitView——它会在空文档首次建点时误触发（跳 maxZoom）。
  const lastFitSignalRef = useRef(fitViewSignal);
  useEffect(() => {
    if (fitViewSignal === lastFitSignalRef.current) return;
    lastFitSignalRef.current = fitViewSignal;
    void rfInstanceRef.current?.fitView({ padding: 0.2 });
  }, [fitViewSignal]);

  const onCommitEdit = useCallback(
    (id: string, text: string) => {
      setEditingId(null);
      if (pendingNodes.has(id)) {
        if (geometryBarrier) {
          void geometryBarrier.enqueue({ kind: "edit-text", id, text });
        }
        setPendingNodes((prev) => {
          const next = new Map(prev);
          const n = next.get(id);
          if (n) next.set(id, { ...n, text });
          return next;
        });
        return;
      }
      const current = session.current.document.document.nodes.find((n) => n.id === id)?.text ?? "";
      if (text === current) return;
      if (geometryBarrier && geometryBarrier.getMetricsState() !== "ready") {
        void geometryBarrier.enqueue({ kind: "edit-text", id, text });
        setTextOverrides((prev) => new Map(prev).set(id, text));
      } else {
        const cmd = controller.commitEditText(id, text, current);
        if (cmd) api.commit(cmd);
      }
    },
    [api, controller, geometryBarrier, pendingNodes, session],
  );

  const onCancelEdit = useCallback(() => {
    if (editingId && pendingNodes.has(editingId)) {
      const p = pendingNodes.get(editingId);
      if (p && p.text === "") {
        geometryBarrier?.cancelPendingNode(editingId);
        setPendingNodes((prev) => {
          const next = new Map(prev);
          next.delete(editingId);
          return next;
        });
      }
    }
    setEditingId(null);
  }, [editingId, geometryBarrier, pendingNodes]);

  const flushActiveEditor = useCallback(() => {
    if (editingId !== null) {
      const activeEl = document.querySelector<HTMLTextAreaElement>(
        "textarea[aria-label='编辑节点文本']",
      );
      if (activeEl) {
        onCommitEdit(editingId, activeEl.value);
      }
    }
  }, [editingId, onCommitEdit]);

  useEffect(() => {
    if (activeEditorRef) {
      activeEditorRef.current = { flush: flushActiveEditor };
      return () => {
        activeEditorRef.current = null;
      };
    }
  }, [activeEditorRef, flushActiveEditor]);

  const editingValue = useMemo<EditingContextValue>(
    () => ({
      editingId,
      fonts,
      focusId: focusNodeId,
      linkCandidateId: linking.phase === "linking" ? linking.candidateId : null,
      onCommitEdit,
      onCancelEdit,
    }),
    [editingId, focusNodeId, fonts, linking, onCancelEdit, onCommitEdit],
  );

  return (
    <EditingContext.Provider value={editingValue}>
      <div
        className={className}
        // MM-090-D9：黑板主题的纯黑画布此前从未接线（tokens 定义了但无消费者，
        // jsdom 测不到视觉——用户实测发现）。画布底色/点阵随文档主题。
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          background: themeTokens(session.current.document.document.theme).canvasBackground,
          transition: "background 200ms ease",
        }}
        role="application"
        aria-label="脑图画布"
        tabIndex={0}
        // MM-090-D5（open）：点击 pane 不聚焦 wrapper → 键盘流需先 Tab。
        // 实测两版 mousedown 聚焦（preventDefault / setTimeout）都会破坏
        // 双击建点的 dblclick 派发——缺陷卡记录候选：RF onPaneClick 聚焦。
        onKeyDown={onKeyDown}
        onDoubleClick={onWrapperDoubleClick}
      >
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          // MM-090-D9：背景设在 RF 本体——wrapper 上的背景会被 RF 内层默认
          // 白底盖住（实测：主题接线后按钮翻转但画布不变色的根因）。
          style={{
            backgroundColor: themeTokens(session.current.document.document.theme).canvasBackground,
          }}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          onNodeDoubleClick={(_e, node) => beginEdit(node.id)}
          onMove={(_, vp) => setViewport(vp)} // session-only
          onInit={(instance) => {
            rfInstanceRef.current = instance;
            // 冷启动即带内容（测试/恢复场景）才框架化；空文档不框架化，
            // 避免首个节点出现时镜头跳到 maxZoom（见 fitViewSignal 注释）。
            if (session.current.document.document.nodes.length > 0) {
              void instance.fitView({ padding: 0.2 });
            }
          }}
          nodesConnectable
          selectionOnDrag
          panOnDrag
          zoomOnScroll
          // 双击=建点（键位定稿 2026-08-29），不是缩放（缩放走 ⌘+/⌘-/⌘0）。
          // 且 d3-zoom 的 dblclick.zoom 会 stopImmediatePropagation（noevent），
          // 不关它 wrapper 的 onDoubleClick 永远收不到——双击建点从未生效的根因。
          zoomOnDoubleClick={false}
          deleteKeyCode={null} // 删除统一走画布 keydown（selection 语义一致）
          proOptions={{ hideAttribution: false }} // G1 决定：保留 attribution
          minZoom={0.2}
          maxZoom={2.5}
        >
          {/* G-VIS D1：画布平坦无纹理、无常驻点阵——Background 点阵已移除 */}
          <ContextToolbar
            selection={{ nodes: uiSelection.nodes, edges: uiSelection.edges }}
            document={session.current.document}
            primaryNodeId={uiSelection.primary}
            onCommand={(command) => {
              if (command.kind === "SetNodeKicker") {
                if (geometryBarrier && geometryBarrier.getMetricsState() !== "ready") {
                  void geometryBarrier.enqueue({
                    kind: "set-kicker",
                    id: command.id,
                    kicker: command.kicker,
                  });
                } else {
                  const fontId = documentDefaults(session.current.document).font;
                  const node = session.current.document.document.nodes.find(
                    (n) => n.id === command.id,
                  );
                  const measured = node
                    ? measureNodeVisual({ ...node, kicker: command.kicker }, fontId, fonts)
                    : undefined;
                  api.commit({
                    ...command,
                    ...(measured !== undefined ? { measured } : {}),
                  });
                }
              } else if (command.kind === "EditNodeText") {
                if (geometryBarrier && geometryBarrier.getMetricsState() !== "ready") {
                  void geometryBarrier.enqueue({
                    kind: "edit-text",
                    id: command.id,
                    text: command.text,
                    ...(command.runs !== undefined ? { runs: command.runs } : {}),
                  });
                } else {
                  const fontId = documentDefaults(session.current.document).font;
                  const box = measureNodeBox(command.text, command.runs, fontId, fonts);
                  api.commit({
                    ...command,
                    size: { width: box.width, height: box.height },
                  });
                }
              } else if (command.kind === "SetDocumentStyle" && command.font !== undefined) {
                // [PRR-040] 字体切换永远经 GeometryBarrier：ready 时 barrier
                // 用目标字体立即度量全部节点并原子提交（单 undo step 同时
                // 恢复旧字体与旧 size）；pending/failed 时保留意图，禁止
                // 旧字体几何随 SetDocumentStyle 直接入库。无 barrier 的
                // 测试/harness 环境维持旧语义。
                if (geometryBarrier) {
                  void geometryBarrier.enqueue({ kind: "set-document-font", font: command.font });
                } else {
                  api.commit(command);
                }
              } else {
                api.commit(command); // commit 与版本信号必须走同一原子通道
              }
            }}
          />
        </ReactFlow>
        {overlay}
      </div>
    </EditingContext.Provider>
  );
}

/** 方向键 → 导航方向；非方向键返回 null。 */
function arrowDirection(key: string): NavDirection | null {
  if (key === "ArrowUp") return "up";
  if (key === "ArrowDown") return "down";
  if (key === "ArrowLeft") return "left";
  if (key === "ArrowRight") return "right";
  return null;
}

/** 画布 pane 的屏幕矩形（键盘创建节点的视口中心换算用）。 */
function paneRectFromDom(): DOMRect | null {
  if (typeof document === "undefined") return null;
  const pane = document.querySelector(".react-flow__pane");
  return pane instanceof HTMLElement ? pane.getBoundingClientRect() : null;
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

/** 画布事件 → 画布坐标（viewport 逆变换）。仅命中空白 pane 才有效：
 *  命中节点/边返回 null——双击节点是「进入编辑」（onNodeDoubleClick），
 *  不能同时触发建点（用户实测：双击编辑会在原节点上再叠一个空节点）。 */
function panePointFromEvent(
  event: { clientX: number; clientY: number; target: EventTarget | null },
  viewport: Viewport,
): Point | null {
  const target = event.target as HTMLElement | null;
  if (target?.closest(".react-flow__node, .react-flow__edge")) return null;
  const pane = target?.closest(".react-flow__pane") as HTMLElement | null;
  if (!pane) return null;
  const rect = pane.getBoundingClientRect();
  const x = (event.clientX - rect.left - viewport.x) / viewport.zoom;
  const y = (event.clientY - rect.top - viewport.y) / viewport.zoom;
  return { x, y };
}
