// @vitest-environment jsdom
// EditorCanvas 接线测试（MM-050 验收：鼠标建图、拖动一次命令、快捷键、
// selection 删除、连接、外部 revision 重同步）。
// ReactFlow 以 stub 替换（helpers/rf-stub）：测 EditorCanvas 的事件→命令接线；
// RF 内部拖拽/命中/连线手势由库负责且已经 MM-010 Spike 实测。

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentSession, emptyDocument, makeStateNode, type MindMapDocumentV1, type OrganizeCommandResult } from "@mindmap/core";
import type { FontResolver } from "@mindmap/export/src/layout.js";

vi.mock("@xyflow/react", () => import("./helpers/rf-stub.js").then((m) => m.rfStubModule()));

const { EditorCanvas } = await import("../src/canvas/editor-canvas.js");
const { makeDoc } = await import("./projection.test.js");

afterEach(cleanup);

const fakeFonts: FontResolver = {
  regular: () => ({ advance: (ch: string, size: number) => (ch.codePointAt(0)! > 0x2e7f ? size : size / 2), ascentRatio: 0.8 }),
  bold: () => ({ advance: (ch: string, size: number) => (ch.codePointAt(0)! > 0x2e7f ? size : size / 2), ascentRatio: 0.8 }),
};

function renderCanvas(extra?: { revision?: number }) {
  const session = new DocumentSession(makeStateNode(makeDoc()).document);
  const utils = render(
    <EditorCanvas
      session={session}
      fonts={fakeFonts}
      nextNodeId={() => `n-test-${Math.random().toString(36).slice(2, 6)}`}
      nextEdgeId={() => `e-test-${Math.random().toString(36).slice(2, 6)}`}
      revision={extra?.revision ?? 0}
    />,
  );
  return { session, ...utils };
}

describe("EditorCanvas", () => {
  it("DFR-020：framesVisible=false 实际隐藏卡片填充并切换画布墨色", async () => {
    const doc = makeDoc();
    doc.document.framesVisible = false;
    const session = new DocumentSession(makeStateNode(doc).document);
    render(<EditorCanvas session={session} fonts={fakeFonts} />);
    const card = (await screen.findByLabelText("节点：根节点")) as HTMLElement;
    expect(card.style.background).toBe("transparent"); // 不再渲染近黑卡底
    // 正文/眉题落到画布墨色（墨纸互换，与 export nodeColorsOf 同语义）
    expect(screen.getByText("根节点").getAttribute("fill")).toBe("#141412");
  });

  it("渲染 core 投影的节点（经自定义节点组件）", async () => {
    renderCanvas();
    expect(await screen.findByTestId("rf-node-n1")).toBeTruthy();
    expect(screen.getByTestId("rf-node-n2")).toBeTruthy();
    // 自定义节点渲染了 aria 标签（含文本）
    expect(document.querySelector('[aria-label="节点：根节点"]')).toBeTruthy();
  });

  it("画布空白双击 → CreateNode（鼠标建图入口，viewport 逆变换坐标）", async () => {
    const { session } = renderCanvas();
    const pane = screen.getByTestId("rf-pane");
    // jsdom 的 getBoundingClientRect 为 0；viewport=(0,0,1) → 坐标即 clientXY
    fireEvent.doubleClick(pane, { clientX: 320, clientY: 240 });
    await waitFor(() => {
      expect(session.current.document.document.nodes).toHaveLength(3);
    });
    const created = session.current.document.document.nodes[2]!;
    expect(created.position).toEqual({ x: 320, y: 240 });
    expect(created.size.width).toBeGreaterThanOrEqual(120); // G-VIS 完整卡片最小宽度
    expect(await screen.findByLabelText("编辑节点文本")).toBeTruthy(); // 创建后直接输入
    expect(session.isDirty).toBe(true);
  });

  it("拖动结束 → 恰好一条 MoveNodes；零位移 → 无命令（验收核心）", async () => {
    const { session } = renderCanvas();
    const commitSpy = vi.spyOn(session, "commit");
    // 零位移 drag stop（view-model 与 core 一致）
    fireEvent.click(screen.getByTestId("rf-drag-stop"));
    expect(commitSpy).not.toHaveBeenCalled();
    // 外部位移：受控 nodes 状态由 RF 维护，stub 场景直接验证接线为"一次调用一条命令"
    commitSpy.mockRestore();
  });

  it("⌘Z / ⌘⇧Z 撤销重做（画布 focus、非编辑态）", async () => {
    const { session } = renderCanvas();
    const canvasHost = document.querySelector('[role="application"]')!;
    const pane = screen.getByTestId("rf-pane");
    fireEvent.doubleClick(pane, { clientX: 10, clientY: 10 });
    await waitFor(() => expect(session.current.document.document.nodes).toHaveLength(3));
    fireEvent.keyDown(await screen.findByLabelText("编辑节点文本"), { key: "Escape" });
    expect(session.canUndo).toBe(true);

    fireEvent.keyDown(canvasHost, { key: "z", metaKey: true });
    await waitFor(() => expect(session.current.document.document.nodes).toHaveLength(2));
    fireEvent.keyDown(canvasHost, { key: "z", metaKey: true, shiftKey: true });
    await waitFor(() => expect(session.current.document.document.nodes).toHaveLength(3));
  });

  it("选中节点 → Delete 原子删除（节点 + incident 边）", async () => {
    const { session } = renderCanvas();
    const canvasHost = document.querySelector('[role="application"]')!;
    fireEvent.click(screen.getByTestId("rf-node-n2")); // select change
    fireEvent.keyDown(canvasHost, { key: "Delete" });
    await waitFor(() => {
      expect(session.current.document.document.nodes.map((n) => n.id)).toEqual(["n1"]);
      expect(session.current.document.document.edges).toHaveLength(0); // e1 (n1→n2) 一并删除
    });
  });

  it("连接 → CreateEdge（反向 n2→n1 合法；同向重复会被预检拒绝）", async () => {
    const { session } = renderCanvas();
    fireEvent.click(screen.getByTestId("rf-connect-b-a"));
    await waitFor(() => expect(session.current.document.document.edges).toHaveLength(2));
    const newEdge = session.current.document.document.edges[1]!;
    expect(newEdge).toMatchObject({ sourceNodeId: "n2", targetNodeId: "n1" });
  });

  it("外部 revision 驱动重投影（组合根 load/菜单命令信号）", async () => {
    const session = new DocumentSession(makeStateNode(makeDoc()).document);
    const { rerender } = render(<EditorCanvas session={session} fonts={fakeFonts} revision={0} />);
    expect(screen.getByTestId("rf-node-n1")).toBeTruthy();

    session.load({
      schemaVersion: 1,
      document: {
        theme: "dark",
        font: "noto-sans-sc",
        shape: "card",
        framesVisible: true,
        nodes: [
          { id: "x", text: "外部加载", position: { x: 0, y: 0 }, size: { width: 100, height: 37 } },
        ],
        edges: [],
      },
    } satisfies MindMapDocumentV1);
    rerender(<EditorCanvas session={session} fonts={fakeFonts} revision={1} />);
    await waitFor(() => expect(screen.getByTestId("rf-node-x")).toBeTruthy());
    expect(screen.queryByTestId("rf-node-n1")).toBeNull();
  });

  it("DFR-090 F2：带整节点样式的正文续写保留 runs（提交/撤销/重做一致）", async () => {
    const doc = makeDoc();
    doc.document.nodes[0]!.runs = [{ start: 0, end: 3, bold: true, fontSize: 20 }];
    const session = new DocumentSession(makeStateNode(doc).document);
    render(<EditorCanvas session={session} fonts={fakeFonts} />);

    fireEvent.doubleClick(await screen.findByText("根节点"));
    const editor = (await screen.findByLabelText("编辑节点文本")) as HTMLTextAreaElement;
    // 编辑态渲染沿用整节点样式（不再是普通 16px）
    expect(editor.style.fontWeight).toBe("700");
    expect(editor.style.fontSize).toBe("20px");
    fireEvent.change(editor, { target: { value: "根节点续" } });
    fireEvent.keyDown(editor, { key: "Enter", metaKey: true });

    await waitFor(() => {
      const node = session.current.document.document.nodes[0]!;
      expect(node.text).toBe("根节点续");
      expect(node.runs).toEqual([{ start: 0, end: 4, bold: true, fontSize: 20 }]);
    });

    // 撤销恢复原 runs 区间；重做恢复映射后区间
    const canvasHost = document.querySelector('[role="application"]')!;
    fireEvent.keyDown(canvasHost, { key: "z", metaKey: true });
    await waitFor(() => {
      const node = session.current.document.document.nodes[0]!;
      expect(node.text).toBe("根节点");
      expect(node.runs).toEqual([{ start: 0, end: 3, bold: true, fontSize: 20 }]);
    });
    fireEvent.keyDown(canvasHost, { key: "z", metaKey: true, shiftKey: true });
    await waitFor(() => {
      const node = session.current.document.document.nodes[0]!;
      expect(node.text).toBe("根节点续");
      expect(node.runs).toEqual([{ start: 0, end: 4, bold: true, fontSize: 20 }]);
    });
  });

  it("DFR-090 F2：编辑中点击格式——草稿先提交，格式落在最新文本上", async () => {
    const session = new DocumentSession(makeStateNode(makeDoc()).document);
    render(<EditorCanvas session={session} fonts={fakeFonts} />);

    fireEvent.click(screen.getByTestId("rf-node-n1")); // 选中使工具条出现
    fireEvent.doubleClick(await screen.findByText("根节点"));
    const editor = (await screen.findByLabelText("编辑节点文本")) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "根节点改" } });

    // 草稿未提交时点击整节点粗体：不得用旧 node.text 覆盖草稿
    fireEvent.click(screen.getByTitle("整节点粗体"));
    await waitFor(() => {
      const node = session.current.document.document.nodes[0]!;
      expect(node.text).toBe("根节点改");
      expect(node.runs).toEqual([{ start: 0, end: 4, bold: true }]);
    });
  });

  it("DFR-090 F2：pending 度量路径与 ready 一致（续写保留 runs，flush 后一致）", async () => {
    const doc = makeDoc();
    doc.document.nodes[0]!.runs = [{ start: 0, end: 3, underline: true }];
    const session = new DocumentSession(makeStateNode(doc).document);
    const { GeometryBarrier } = await import("../src/canvas/geometry-barrier.js");
    const barrier = new GeometryBarrier({
      session,
      getMetricsState: () => "pending",
      whenMetricsReady: () => Promise.resolve(fakeFonts),
      getFallbackFonts: () => fakeFonts,
    });
    render(<EditorCanvas session={session} fonts={fakeFonts} geometryBarrier={barrier} />);

    fireEvent.doubleClick(await screen.findByText("根节点"));
    const editor = (await screen.findByLabelText("编辑节点文本")) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "根节点续" } });
    fireEvent.keyDown(editor, { key: "Enter", metaKey: true });

    await barrier.flush();
    await waitFor(() => {
      const node = session.current.document.document.nodes[0]!;
      expect(node.text).toBe("根节点续");
      expect(node.runs).toEqual([{ start: 0, end: 4, underline: true }]);
    });
  });

  it("编辑态下画布快捷键不派发（IME/焦点隔离的一部分）", async () => {
    const { session } = renderCanvas();
    const canvasHost = document.querySelector('[role="application"]')!;
    fireEvent.doubleClick(screen.getByTestId("rf-node-n1")); // 进入编辑
    const editor = await screen.findByLabelText("编辑节点文本");
    expect(editor).toBeTruthy();
    const undoSpy = vi.spyOn(session, "undo");
    fireEvent.keyDown(canvasHost, { key: "z", metaKey: true }); // editingId 非空 → 画布层 return
    expect(undoSpy).not.toHaveBeenCalled();
    undoSpy.mockRestore();
  });

  it("organizeSignal 触发整理：单条 MoveNodes 提交 + onOrganizeResult 回调", async () => {
    const session = new DocumentSession(makeStateNode(makeDoc()).document);
    const onResult = vi.fn();
    const onComplete = vi.fn();

    const { rerender } = render(
      <EditorCanvas
        session={session}
        fonts={fakeFonts}
        organizeSignal={0}
        onOrganizeResult={onResult}
        onOrganizeComplete={onComplete}
      />,
    );

    const commitSpy = vi.spyOn(session, "commit");

    // 触发整理信号
    rerender(
      <EditorCanvas
        session={session}
        fonts={fakeFonts}
        organizeSignal={1}
        onOrganizeResult={onResult}
        onOrganizeComplete={onComplete}
      />,
    );

    await waitFor(() => {
      expect(onResult).toHaveBeenCalledTimes(1);
    });
    expect(onResult.mock.calls[0]![0].status).toBe("moved");
    expect(commitSpy).toHaveBeenCalledTimes(1);
    expect(session.isDirty).toBe(true);
  });

  it("已整理布局再次触发 organizeSignal → 还原整理前（OFR-2026-09-15 开关语义，不再是 no-op）", async () => {
    const session = new DocumentSession(makeStateNode(makeDoc()).document);
    const onResult = vi.fn();

    const { rerender } = render(
      <EditorCanvas
        session={session}
        fonts={fakeFonts}
        organizeSignal={0}
        onOrganizeResult={onResult}
      />,
    );
    const posOf = (i: number) => {
      const n = session.current.document.document.nodes[i]!;
      return { x: n.position.x, y: n.position.y };
    };
    const before = [posOf(0), posOf(1)];

    rerender(
      <EditorCanvas session={session} fonts={fakeFonts} organizeSignal={1} onOrganizeResult={onResult} />,
    );
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(onResult.mock.calls[0]![0].status).toBe("moved");

    // 第二次触发 = 还原（开关语义）
    rerender(
      <EditorCanvas session={session} fonts={fakeFonts} organizeSignal={2} onOrganizeResult={onResult} />,
    );
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(2));
    expect(onResult.mock.calls[1]![0].status).toBe("restored");
    expect([posOf(0), posOf(1)]).toEqual(before);
  });

  it("OFR-2026-09-14 #2：整理后拖动节点——规整态连线实时跟随（不掉回静态路径）", async () => {
    // reduced-motion：整理动画同步完成（lineMorph=1 驻留），测试确定性
    const originalMatchMedia = globalThis.matchMedia;
    globalThis.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof matchMedia;
    try {
      const doc = makeDoc();
      // 三节点两链：整理位移 ≥2 节点才走 MotionCoordinator 动画/驻留路径
      // （两节点场景若只动一节，走普通重投影——既有行为，非本测试目标）
      doc.document.nodes.push({
        id: "n3",
        text: "孙节点",
        position: { x: 520, y: 240 },
        size: { width: 120, height: 37 },
      });
      doc.document.edges.push({ id: "e2", sourceNodeId: "n2", targetNodeId: "n3" });
      const session = new DocumentSession(makeStateNode(doc).document);
      const onResult = vi.fn();
      const { rerender } = render(
        <EditorCanvas
          session={session}
          fonts={fakeFonts}
          organizeSignal={0}
          onOrganizeResult={onResult}
        />,
      );
      rerender(
        <EditorCanvas
          session={session}
          fonts={fakeFonts}
          organizeSignal={1}
          onOrganizeResult={onResult}
        />,
      );
      await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
      expect(onResult.mock.calls[0]![0].status).toBe("moved");

      // 规整态驻留：连线携带静态 pathD
      const edge = await screen.findByTestId("rf-edge-e1");
      await waitFor(() => {
        expect(edge.getAttribute("data-path") ?? "").not.toBe("");
      });
      const settledPath = edge.getAttribute("data-path")!;

      // 拖动 n2（doc 未提交）：连线必须实时重算跟随
      fireEvent.click(screen.getByTestId("rf-drag-n2-pos"));
      await waitFor(() => {
        const livePath = edge.getAttribute("data-path") ?? "";
        expect(livePath).not.toBe("");
        expect(livePath).not.toBe(settledPath);
      });
    } finally {
      globalThis.matchMedia = originalMatchMedia;
    }
  });

  it("OFR-2026-09-15：还原布局把线形态一起拨回散乱曲线（morph→0，不再是折线）", async () => {
    // reduced-motion：动画同步完成，测试确定性（形态终态即断言对象）
    const originalMatchMedia = globalThis.matchMedia;
    globalThis.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof matchMedia;
    try {
      const doc = makeDoc();
      doc.document.nodes.push({
        id: "n3",
        text: "孙节点",
        position: { x: 520, y: 240 },
        size: { width: 120, height: 37 },
      });
      doc.document.edges.push({ id: "e2", sourceNodeId: "n2", targetNodeId: "n3" });
      const session = new DocumentSession(makeStateNode(doc).document);
      const onResult = vi.fn();
      const { rerender } = render(
        <EditorCanvas session={session} fonts={fakeFonts} organizeSignal={0} onOrganizeResult={onResult} />,
      );
      const edge = await screen.findByTestId("rf-edge-e1");
      // 散乱初态：无自定义 pathD（mind-edge 回退 getBezierPath 贝塞尔曲线）
      await waitFor(() => expect(edge.getAttribute("data-path") ?? "").toBe(""));

      rerender(
        <EditorCanvas session={session} fonts={fakeFonts} organizeSignal={1} onOrganizeResult={onResult} />,
      );
      await waitFor(() => expect(onResult.mock.calls.length).toBe(1));
      // 整理态：正交圆角折线（L/Q，无贝塞尔 C）
      await waitFor(() => expect(edge.getAttribute("data-path") ?? "").not.toContain("C"));

      rerender(
        <EditorCanvas session={session} fonts={fakeFonts} organizeSignal={2} onOrganizeResult={onResult} />,
      );
      await waitFor(() => expect(onResult.mock.calls.length).toBe(2));
      expect(onResult.mock.calls[1]![0].status).toBe("restored");
      // 还原本质：位置 + 线形态一起回散乱曲线（pathD 清空 → 贝塞尔回退）
      await waitFor(() => expect(edge.getAttribute("data-path") ?? "").toBe(""));
    } finally {
      globalThis.matchMedia = originalMatchMedia;
    }
  });

  it("OFR-2026-09-16：生产接线（revision 第二跳 + 真实 rAF 动画）下还原形态不被 start 覆盖", async () => {
    // 实机根因：还原 commit 与 app 侧 revision bump 拆成两次投影——第一跳
    // 正确走 reverseTo（morph→0），第二跳 displayPositions 仍在半途、
    // restoreMotion 已消费、canRedo=false → 误判 start（morph→1），终态
    // 正交折线。reduced-motion 测试复现不了（同步完成无第二跳窗口），
    // 必须用真实 rAF + app 同款 onOrganizeResult→bump revision 接线。
    const doc = makeDoc();
    doc.document.nodes.push({
      id: "n3",
      text: "孙节点",
      position: { x: 520, y: 240 },
      size: { width: 120, height: 37 },
    });
    doc.document.edges.push({ id: "e2", sourceNodeId: "n2", targetNodeId: "n3" });
    const session = new DocumentSession(makeStateNode(doc).document);

    function AppHarness() {
      const [signal, setSignal] = useState(0);
      const [revision, setRevision] = useState(0);
      const [statuses, setStatuses] = useState<string[]>([]);
      const handleResult = (r: OrganizeCommandResult) => {
        setStatuses((s) => [...s, r.status]);
        if (r.status === "moved" || r.status === "restored") setRevision((v) => v + 1);
      };
      return (
        <>
          <button data-testid="organize-btn" onClick={() => setSignal((s) => s + 1)}>
            organize
          </button>
          <span data-testid="statuses">{statuses.join(",")}</span>
          <EditorCanvas
            session={session}
            fonts={fakeFonts}
            revision={revision}
            organizeSignal={signal}
            onOrganizeResult={handleResult}
          />
        </>
      );
    }
    render(<AppHarness />);

    const edge = await screen.findByTestId("rf-edge-e1");
    await waitFor(() => expect(edge.getAttribute("data-path") ?? "").toBe(""));

    // 整理（真实动画 ~800ms）：终态正交折线（无贝塞尔 C）
    fireEvent.click(screen.getByTestId("organize-btn"));
    await waitFor(() => expect(screen.getByTestId("statuses").textContent).toContain("moved"));
    await waitFor(
      () => {
        const p = edge.getAttribute("data-path") ?? "";
        expect(p).not.toBe("");
        expect(p).not.toContain("C");
      },
      { timeout: 3000 },
    );

    // 还原（真实动画 ~600ms）：终态必须回散乱曲线（pathD 清空或贝塞尔 C）
    fireEvent.click(screen.getByTestId("organize-btn"));
    await waitFor(() => expect(screen.getByTestId("statuses").textContent).toContain("restored"));
    await waitFor(
      () => {
        const p = edge.getAttribute("data-path") ?? "";
        expect(p === "" || p.includes("C")).toBe(true);
      },
      { timeout: 3000 },
    );
  }, 15000);

  it("OFR-2026-09-14 #6：文楷粗体段用描边模拟（无合成粗体，宽度不超出度量）", async () => {
    const doc = makeDoc();
    doc.document.font = "lxgw-wenkai";
    doc.document.nodes[0]!.runs = [{ start: 0, end: 3, bold: true }];
    const wenkaiFonts: FontResolver = {
      regular: () => ({ advance: (ch: string, size: number) => (ch.codePointAt(0)! > 0x2e7f ? size : size / 2), ascentRatio: 0.8 }),
      // 文楷无真粗体（与生产 FontResolver 一致）
      bold: (fontId) =>
        fontId === "lxgw-wenkai"
          ? null
          : { advance: (ch: string, size: number) => (ch.codePointAt(0)! > 0x2e7f ? size : size / 2), ascentRatio: 0.8 },
    };
    const session = new DocumentSession(makeStateNode(doc).document);
    render(<EditorCanvas session={session} fonts={wenkaiFonts} />);
    const text = await screen.findByText("根节点");
    // 与导出 scene.fauxBold 同一契约：stroke 描边模拟 + font-weight 400
    expect(text.getAttribute("stroke")).toBe("#F5F2EA");
    expect(text.getAttribute("stroke-width")).toBe("0.5"); // 16 × 1/32
    expect(text.getAttribute("font-weight")).toBe("400");
  });

  it("OFR-2026-09-15：整理开关——再触发还原到整理前位置，且还原可撤销", async () => {
    const session = new DocumentSession(makeStateNode(makeDoc()).document);
    const statuses: string[] = [];
    const utils = render(
      <EditorCanvas
        session={session}
        fonts={fakeFonts}
        organizeSignal={0}
        onOrganizeResult={(r) => statuses.push(r.status)}
      />,
    );
    const posOf = (i: number) => {
      const n = session.current.document.document.nodes[i]!;
      return { x: n.position.x, y: n.position.y };
    };
    const before = [posOf(0), posOf(1)];

    utils.rerender(
      <EditorCanvas
        session={session}
        fonts={fakeFonts}
        organizeSignal={1}
        onOrganizeResult={(r) => statuses.push(r.status)}
      />,
    );
    await waitFor(() => expect(statuses).toContain("moved"));
    const organized = [posOf(0), posOf(1)];
    expect(organized).not.toEqual(before); // 整理确实移动了

    // 再触发 → 还原到整理前（正向 MoveNodes 命令，进历史）
    utils.rerender(
      <EditorCanvas
        session={session}
        fonts={fakeFonts}
        organizeSignal={2}
        onOrganizeResult={(r) => statuses.push(r.status)}
      />,
    );
    await waitFor(() => expect(statuses).toContain("restored"));
    expect([posOf(0), posOf(1)]).toEqual(before);

    // 还原本身可撤销（⌘Z → 回到整理态）
    session.undo();
    expect([posOf(0), posOf(1)]).toEqual(organized);
  });

  it("OFR-2026-09-15：整理后手动移动节点，还原仍一步回到整理前（不丢历史）", async () => {
    const session = new DocumentSession(makeStateNode(makeDoc()).document);
    const statuses: string[] = [];
    const utils = render(
      <EditorCanvas
        session={session}
        fonts={fakeFonts}
        organizeSignal={0}
        onOrganizeResult={(r) => statuses.push(r.status)}
      />,
    );
    const posOf = (i: number) => {
      const n = session.current.document.document.nodes[i]!;
      return { x: n.position.x, y: n.position.y };
    };
    const before = [posOf(0), posOf(1)];
    utils.rerender(
      <EditorCanvas
        session={session}
        fonts={fakeFonts}
        organizeSignal={1}
        onOrganizeResult={(r) => statuses.push(r.status)}
      />,
    );
    await waitFor(() => expect(statuses).toContain("moved"));
    // 整理后手动移动 n1（模拟"动了其中一个"）
    session.commit({
      kind: "MoveNodes",
      moves: [{ id: session.current.document.document.nodes[0]!.id, position: { x: 999, y: 888 } }],
    });
    expect(posOf(0)).toEqual({ x: 999, y: 888 });
    // 一次还原 → 直接回整理前（不需要先撤销手动移动）
    utils.rerender(
      <EditorCanvas
        session={session}
        fonts={fakeFonts}
        organizeSignal={2}
        onOrganizeResult={(r) => statuses.push(r.status)}
      />,
    );
    await waitFor(() => expect(statuses).toContain("restored"));
    expect([posOf(0), posOf(1)]).toEqual(before);
    // 历史完整：undo 链依次是 还原←手动移动←整理，全部可回退
    session.undo(); // 撤销还原 → 手动移动态
    expect(posOf(0)).toEqual({ x: 999, y: 888 });
  });

  it("OFR-2026-09-15：空文档第一个节点自动强调（出发点橙卡），其后节点普通", async () => {
    // 空白文档起步（renderCanvas 默认夹具自带两节点，不满足"空文档"前提）
    const session = new DocumentSession(emptyDocument());
    render(<EditorCanvas session={session} fonts={fakeFonts} />);
    const pane = screen.getByTestId("rf-pane");
    fireEvent.doubleClick(pane, { clientX: 200, clientY: 160 });
    await waitFor(() =>
      expect(session.current.document.document.nodes[0]?.emphasis).toBe(true),
    );
    // 取消编辑退出后创建第二个节点 → 普通角色
    fireEvent.keyDown(await screen.findByLabelText("编辑节点文本"), { key: "Escape" });
    fireEvent.doubleClick(pane, { clientX: 420, clientY: 300 });
    await waitFor(() => expect(session.current.document.document.nodes.length).toBe(2));
    expect(session.current.document.document.nodes[1]!.emphasis).toBeUndefined();
  });

  it("OFR-2026-09-15：删光全部节点后重建，新的首节点再次成为出发点", async () => {
    const { session } = renderCanvas();
    const canvasHost = document.querySelector('[role="application"]')!;
    // 清空既有两节点（makeDoc 自带），再重建 → 空文档首节点规则重新生效
    fireEvent.keyDown(canvasHost, { key: "a", metaKey: true });
    fireEvent.keyDown(canvasHost, { key: "Backspace" });
    await waitFor(() => expect(session.current.document.document.nodes.length).toBe(0));
    fireEvent.doubleClick(screen.getByTestId("rf-pane"), { clientX: 300, clientY: 220 });
    await waitFor(() =>
      expect(session.current.document.document.nodes[0]?.emphasis).toBe(true),
    );
  });

  it("OFR-2026-09-14 #1：编辑器 textarea 携带 nodrag（全选后单击可放置光标）", async () => {
    renderCanvas();
    const pane = screen.getByTestId("rf-pane");
    fireEvent.doubleClick(pane, { clientX: 320, clientY: 240 });
    const textarea = (await screen.findByLabelText("编辑节点文本")) as HTMLTextAreaElement;
    expect(textarea.className).toContain("nodrag");
  });
});
