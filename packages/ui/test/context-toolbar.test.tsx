// @vitest-environment jsdom
// 上下文工具条（VRA-050 ③）：选中 → 工具条出现；节点操作（强调/眉题/字号）
// 与边线型经 session.commit 提交对应命令；无选中不渲染。RF stub 环境。

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentSession, makeStateNode, type MindMapDocumentV1 } from "@mindmap/core";
import type { FontResolver } from "@mindmap/export/src/layout.js";

vi.mock("@xyflow/react", () => import("./helpers/rf-stub.js").then((m) => m.rfStubModule()));

const { EditorCanvas } = await import("../src/canvas/editor-canvas.js");

afterEach(cleanup);

const fakeFonts: FontResolver = {
  regular: () => ({ advance: (_ch: string, size: number) => size * 10, ascentRatio: 0.8 }),
  bold: () => ({ advance: (_ch: string, size: number) => size * 10, ascentRatio: 0.8 }),
};

function doc(): MindMapDocumentV1 {
  return {
    schemaVersion: 2,
    document: {
      theme: "light",
      font: "noto-sans-sc",
      shape: "card",
      framesVisible: true,
      nodes: [
        {
          id: "a",
          text: "起点",
          position: { x: 0, y: 0 },
          size: { width: 100, height: 40 },
          kicker: "IDEA",
        },
        { id: "b", text: "目标", position: { x: 200, y: 0 }, size: { width: 100, height: 40 } },
      ],
      edges: [{ id: "e1", sourceNodeId: "a", targetNodeId: "b", lineStyle: "dashed" }],
    },
  };
}

function renderCanvas() {
  const session = new DocumentSession(makeStateNode(doc()).document);
  render(
    <EditorCanvas
      session={session}
      fonts={fakeFonts}
      nextNodeId={() => `n-${Math.random().toString(36).slice(2, 6)}`}
      nextEdgeId={() => `e-${Math.random().toString(36).slice(2, 6)}`}
    />,
  );
  return { session };
}

/** 模拟 RF 选中变化（rf-stub 的节点 testid 触发 select change 的方式同其他测试）。 */
async function selectNode(id: string) {
  const el = await screen.findByTestId(`rf-node-${id}`);
  fireEvent.click(el); // rf-stub click → select change 流
  await waitFor(() => expect(screen.getByTestId("context-toolbar")).toBeTruthy());
}

describe("上下文工具条（VRA-050）", () => {
  it("DFR-090 F2：格式可叠加——字号后再粗体不丢字号（toggleWhole 保留其他属性）", async () => {
    const { session } = renderCanvas();
    await selectNode("b");
    fireEvent.click(screen.getByTitle("字号 +2"));
    await waitFor(() => {
      expect(
        session.current.document.document.nodes.find((x) => x.id === "b")?.runs,
      ).toEqual([{ start: 0, end: 2, fontSize: 18 }]);
    });
    fireEvent.click(screen.getByTitle("整节点粗体"));
    await waitFor(() => {
      expect(
        session.current.document.document.nodes.find((x) => x.id === "b")?.runs,
      ).toEqual([{ start: 0, end: 2, fontSize: 18, bold: true }]);
    });
    // 再点粗体关闭：字号仍保留（显式 false 不丢其他属性）
    fireEvent.click(screen.getByTitle("整节点粗体"));
    await waitFor(() => {
      expect(
        session.current.document.document.nodes.find((x) => x.id === "b")?.runs,
      ).toEqual([{ start: 0, end: 2, fontSize: 18, bold: false }]);
    });
  });

  it("无选中不渲染；选中节点出现工具条（强调/眉题/字体/字号/形状/框线/删除）", async () => {
    renderCanvas();
    expect(screen.queryByTestId("context-toolbar")).toBeNull();
    await selectNode("a");
    for (const title of [
      "普通/强调角色",
      "字号 −2",
      "字号 +2",
      "整节点粗体",
      "整节点下划线",
      "单节点形状",
      "文档级框线显隐",
      "删除选中（⌫）",
    ]) {
      expect(screen.getByTitle(title), title).toBeTruthy();
    }
    expect(screen.getByTestId("kicker-input")).toBeTruthy();
  });

  it("强调切换 → SetNodeEmphasis 提交（kicker 保留）", async () => {
    const { session } = renderCanvas();
    await selectNode("a");
    fireEvent.click(screen.getByTitle("普通/强调角色"));
    await waitFor(() => {
      const n = session.current.document.document.nodes.find((x) => x.id === "a");
      expect(n?.emphasis).toBe(true);
      expect(n?.kicker).toBe("IDEA"); // 强调不清眉题
    });
    // undo 一次恢复
    session.undo();
    await waitFor(() => {
      expect(
        session.current.document.document.nodes.find((x) => x.id === "a")?.emphasis,
      ).toBeUndefined();
    });
  });

  it("工具条命令提交后立即重投影，不留下会触发 projection drift 的旧版本", async () => {
    const { session } = renderCanvas();
    await selectNode("a");

    fireEvent.click(screen.getByTitle("文档字体切换（当前 noto-sans-sc）"));

    await waitFor(() => {
      expect(session.current.document.document.font).toBe("lxgw-wenkai");
      expect(screen.getByTitle("文档字体切换（当前 lxgw-wenkai）")).toBeTruthy();
    });
  });

  it("DFR-010 显示同步回归：字体切换后节点正文 font-family 真实翻转，一次 ⌘Z 同时恢复显示字体与尺寸", async () => {
    const { session } = renderCanvas();
    await selectNode("a");

    // 切换前：真实 DOM 渲染为 Noto
    expect(screen.getByText("起点").getAttribute("font-family")).toContain("Noto Sans SC");
    const widthBefore = session.current.document.document.nodes.find((n) => n.id === "a")?.size
      .width;

    fireEvent.click(screen.getByTitle("文档字体切换（当前 noto-sans-sc）"));

    // 显示层（svg text 的 font-family）与 core 同步翻转——不是只读 session 判断
    await waitFor(() => {
      expect(screen.getByText("起点").getAttribute("font-family")).toContain("LXGW WenKai");
    });

    // 一次撤销：core 单条原子命令同时恢复旧字体与全部旧 size，显示随之恢复
    const canvasHost = screen.getByRole("application");
    fireEvent.keyDown(canvasHost, { key: "z", metaKey: true });
    await waitFor(() => {
      expect(session.current.document.document.font).toBe("noto-sans-sc");
      expect(screen.getByText("起点").getAttribute("font-family")).toContain("Noto Sans SC");
      expect(
        session.current.document.document.nodes.find((n) => n.id === "a")?.size.width,
      ).toBe(widthBefore);
    });
  });

  it("DFR-010 选择态一致性：命令提交重投影后选择保留，不产生幽灵选择", async () => {
    const { session } = renderCanvas();
    await selectNode("a");
    expect(screen.getByTestId("kicker-input")).toBeTruthy(); // 单选形态

    // 提交一次命令（强调）→ core 驱动重投影
    fireEvent.click(screen.getByTitle("普通/强调角色"));
    await waitFor(() => {
      const n = session.current.document.document.nodes.find((x) => x.id === "a");
      expect(n?.emphasis).toBe(true);
    });

    // 选择与单选工具条形态必须随重投影保留（此前 selected 被静默丢弃，
    // selectionRef 与视图脱节形成幽灵选择，眉题输入框消失）
    await waitFor(() => {
      expect(screen.getByTestId("context-toolbar")).toBeTruthy();
      expect(screen.getByTestId("kicker-input")).toBeTruthy();
    });

    // undo/redo 后仍然保持
    const canvasHost = screen.getByRole("application");
    fireEvent.keyDown(canvasHost, { key: "z", metaKey: true });
    await waitFor(() => {
      expect(
        session.current.document.document.nodes.find((x) => x.id === "a")?.emphasis,
      ).toBeUndefined();
    });
    await waitFor(() => expect(screen.getByTestId("kicker-input")).toBeTruthy());
  });

  it("DFR-030：工具条定位主选节点附近并夹紧视口（不再固定顶部居中）", async () => {
    renderCanvas();
    await selectNode("a");
    const panel = screen.getByTestId("context-toolbar");
    // 节点 a 位于 (0,0)、宽 100 → 锚点 x = 50；jsdom 测量高为 0，顶部夹紧 8px
    expect(panel.style.left).toBe("50px");
    expect(panel.style.top).toBe("8px");
  });

  it("眉题输入（失焦提交）→ SetNodeKicker；清空 = 移除眉题", async () => {
    const { session } = renderCanvas();
    await selectNode("b");
    const input = screen.getByTestId("kicker-input");
    fireEvent.change(input, { target: { value: "工具 TOOL" } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(session.current.document.document.nodes.find((x) => x.id === "b")?.kicker).toBe(
        "工具 TOOL",
      );
    });
  });

  it("字号 A+ → 整节点 runs 字号 18 提交（EditNodeText 通道，可 undo）", async () => {
    const { session } = renderCanvas();
    await selectNode("b");
    fireEvent.click(screen.getByTitle("字号 +2"));
    await waitFor(() => {
      const n = session.current.document.document.nodes.find((x) => x.id === "b");
      expect(n?.runs?.[0]?.fontSize).toBe(18);
      expect(n?.text).toBe("目标"); // 文本不被清空（runs 不清内容）
      expect(n?.size.width).toBeGreaterThanOrEqual(120); // G-VIS 完整卡片几何，不回退旧小框
    });
    session.undo();
    await waitFor(() => {
      expect(
        session.current.document.document.nodes.find((x) => x.id === "b")?.runs,
      ).toBeUndefined();
    });
  });
});
