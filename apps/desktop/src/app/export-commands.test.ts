// PRR-070-R2 定向测试：Graph JSON 第四格式接线契约（任务卡 §3.1–3.4/3.7）。
// 面板显示顺序、flush 时序与字体失败分支在 app-integration.test.tsx（jsdom）。

import { describe, expect, it, vi } from "vitest";
import { DocumentSession, emptyDocument, type MindMapDocumentV1 } from "@mindmap/core";
import { exportFlow, exportSuggestedName, type ExportRendererLike } from "./export-commands.js";
import { okRenderer } from "./export-commands.test-helpers.js";
import { FakeFilePort } from "./fake-ports.js";

function docWithGraph(): MindMapDocumentV1 {
  const doc = emptyDocument();
  doc.document.nodes.push(
    {
      id: "n1",
      text: "想法一\n第二行",
      position: { x: 40, y: 80 },
      size: { width: 120, height: 48 },
    },
    {
      id: "n2",
      text: "Second idea",
      position: { x: 300, y: 80 },
      size: { width: 140, height: 48 },
    },
  );
  doc.document.edges.push({ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" });
  return doc;
}


describe("exportSuggestedName（PRR-070-R2 §3.1）", () => {
  it("graph-json → .graph.json；视觉格式扩展名不变", () => {
    const fresh = new DocumentSession(emptyDocument());
    expect(exportSuggestedName(fresh, "graph-json")).toBe("未命名.graph.json");
    const opened = new DocumentSession(emptyDocument());
    opened.adoptOpenedTarget("fake-doc-1", "tok", "/docs/我的脑图.mindmap");
    expect(exportSuggestedName(opened, "graph-json")).toBe("我的脑图.graph.json");
    expect(exportSuggestedName(opened, "svg")).toBe("我的脑图.svg");
    expect(exportSuggestedName(opened, "png")).toBe("我的脑图.png");
    expect(exportSuggestedName(opened, "pdf")).toBe("我的脑图.pdf");
  });
});

describe("Graph JSON 导出契约（§3.2/3.3）", () => {
  it("bytes 可解析且结构完整：format/version/meta/graph 节点边与 source/target", async () => {
    const session = new DocumentSession(docWithGraph());
    const filePort = new FakeFilePort();
    filePort.nextSaveDialog = "/out/map.graph.json";
    const result = await exportFlow(session, { filePort, renderer: okRenderer() }, "graph-json");
    expect(result).toMatchObject({ kind: "ok", displayPath: "/out/map.graph.json" });
    const g = JSON.parse(new TextDecoder().decode(filePort.files.get("/out/map.graph.json")!));
    expect(g.format).toBe("mindmap-graph-json");
    expect(g.version).toBe(1);
    expect(g.meta.nodeCount).toBe(2);
    expect(g.meta.edgeCount).toBe(1);
    expect(g.graph.nodes.map((n: { id: string }) => n.id)).toEqual(["n1", "n2"]);
    const n1 = g.graph.nodes[0];
    expect(n1.text).toBe("想法一\n第二行");
    expect(n1.label).toBe("想法一");
    expect(n1.position).toEqual({ x: 40, y: 80 });
    expect(n1.size).toEqual({ width: 120, height: 48 });
    expect(g.graph.nodes[1].text).toBe("Second idea");
    expect(g.graph.edges[0]).toMatchObject({ id: "e1", source: "n1", target: "n2" });
  });

  it("确定性：同一文档两次输出 bytes 完全一致；无时间戳/机器路径/内部 schemaVersion", async () => {
    const session = new DocumentSession(docWithGraph());
    const filePort = new FakeFilePort();
    filePort.nextSaveDialog = "/out/a.graph.json";
    await exportFlow(session, { filePort, renderer: okRenderer() }, "graph-json");
    filePort.nextSaveDialog = "/out/b.graph.json";
    await exportFlow(session, { filePort, renderer: okRenderer() }, "graph-json");
    const first = filePort.files.get("/out/a.graph.json")!;
    const second = filePort.files.get("/out/b.graph.json")!;
    expect(second).toEqual(first);
    const text = new TextDecoder().decode(first);
    expect(text).not.toContain("schemaVersion");
    expect(text).not.toContain("generatedAt");
    expect(text).not.toContain("/Users/");
    expect(text.endsWith("\n")).toBe(true); // 末尾换行
    expect(text).toContain('"format": "mindmap-graph-json"'); // 两空格缩进
  });

  it("目标选择前冻结 bytes：授权对话框期间文档变化不进入本次导出", async () => {
    const session = new DocumentSession(docWithGraph());
    // 模拟对话框打开期间文档继续变化（load 成三节点文档）
    class MutatingDuringDialog extends FakeFilePort {
      override async requestTargetAuthorization(
        ...args: Parameters<FakeFilePort["requestTargetAuthorization"]>
      ) {
        const changed = docWithGraph();
        changed.document.nodes.push({
          id: "n3",
          text: "对话框期间新增",
          position: { x: 600, y: 80 },
          size: { width: 120, height: 48 },
        });
        session.load(changed);
        return super.requestTargetAuthorization(...args);
      }
    }
    const filePort = new MutatingDuringDialog();
    filePort.nextSaveDialog = "/out/frozen.graph.json";
    const result = await exportFlow(session, { filePort, renderer: okRenderer() }, "graph-json");
    expect(result.kind).toBe("ok");
    const g = JSON.parse(new TextDecoder().decode(filePort.files.get("/out/frozen.graph.json")!));
    expect(g.meta.nodeCount).toBe(2); // 快照是面板打开那一刻，不含对话框期间的新节点
    expect(session.current.document.document.nodes.length).toBe(3); // 会话本身已前进
  });
});

describe("渲染器独立性（§3.4）与视觉格式不回归（§3.7）", () => {
  it("Graph JSON 零触碰 renderer：buildScene/render* 不被调，fonts 抛错仍成功", async () => {
    const renderer: ExportRendererLike = {
      buildScene: vi.fn(),
      renderSvg: vi.fn(),
      renderPng: vi.fn(),
      renderPdf: vi.fn(),
      fonts: vi.fn(() => {
        throw new Error("font metrics 不可用（模拟）");
      }),
    };
    const session = new DocumentSession(docWithGraph());
    const filePort = new FakeFilePort();
    filePort.nextSaveDialog = "/out/norender.graph.json";
    const result = await exportFlow(session, { filePort, renderer }, "graph-json");
    expect(result).toMatchObject({ kind: "ok" });
    expect(renderer.buildScene).not.toHaveBeenCalled();
    expect(renderer.renderSvg).not.toHaveBeenCalled();
    expect(renderer.renderPng).not.toHaveBeenCalled();
    expect(renderer.renderPdf).not.toHaveBeenCalled();
    expect(filePort.files.get("/out/norender.graph.json")!.length).toBeGreaterThan(0);
  });

  it("视觉格式仍走 renderer：buildScene 结构化失败在授权前返回（不回归）", async () => {
    const renderer: ExportRendererLike = {
      buildScene: vi.fn(async () => ({
        ok: false as const,
        error: { code: "EXPORT_EMPTY_DOCUMENT", message: "空文档" },
      })),
      renderSvg: vi.fn(),
      renderPng: vi.fn(),
      renderPdf: vi.fn(),
      fonts: vi.fn(),
    };
    const filePort = new FakeFilePort();
    const calls = filePort.saveDialogCalls;
    const result = await exportFlow(
      new DocumentSession(docWithGraph()),
      { filePort, renderer },
      "svg",
    );
    expect(result).toMatchObject({ kind: "error", code: "EXPORT_EMPTY_DOCUMENT" });
    expect(filePort.saveDialogCalls).toBe(calls); // 失败前置 → 不弹授权
  });
});
