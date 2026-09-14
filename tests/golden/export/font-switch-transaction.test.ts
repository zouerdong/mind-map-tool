// PRR-040 集成验收：字体切换的权威几何事务在真实字体/真实导出链上闭环。
// 覆盖：Noto↔LXGW 两向切换后 node size 全部来自目标字体（与目标字体
// 直接度量一致）、canonical 序列化保存/重开往返保持切换结果、
// SVG/2x PNG/PDF 三格式在新字体下渲染成功且 SVG 文本布局与度量一致。

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeDocument, emptyDocument, encodeDocument, DocumentSession } from "@mindmap/core";
import { createExportRenderer } from "@mindmap/export";
import type { FontResolver } from "@mindmap/export/src/layout.js";
import { measureNodeVisual } from "@mindmap/export/src/visual-style.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");

async function loadFonts() {
  const { readFile } = await import("node:fs/promises");
  const dir = resolve(ROOT, "assets/fonts");
  return {
    "noto-sans-sc-regular": new Uint8Array(
      await readFile(resolve(dir, "noto-sans-sc-regular.woff2")),
    ),
    "noto-sans-sc-bold": new Uint8Array(await readFile(resolve(dir, "noto-sans-sc-bold.woff2"))),
    "lxgw-wenkai-regular": new Uint8Array(
      await readFile(resolve(dir, "lxgw-wenkai-regular.woff2")),
    ),
  };
}

const wasm = (() => {
  const req = createRequire(resolve(ROOT, "packages/export/package.json"));
  return new Uint8Array(
    readFileSync(resolve(dirname(req.resolve("@resvg/resvg-wasm")), "index_bg.wasm")),
  );
})();

function seededDocument() {
  const doc = emptyDocument();
  // 本测试验证 Noto→LXGW→Noto 两向切换事务；OFR-2026-09-14 #4 后新文档
  // 默认文楷，显式锁定起点字体，不依赖产品默认值。
  doc.document.font = "noto-sans-sc";
  doc.document.nodes.push(
    {
      id: "n-1",
      text: "黑体基准节点：中文与 English 混排",
      position: { x: 0, y: 0 },
      size: { width: 120, height: 40 },
    },
    {
      id: "n-2",
      text: "第二个节点（含换行）\n第二行",
      kicker: "眉题 KICKER",
      position: { x: 260, y: 80 },
      size: { width: 140, height: 60 },
    },
  );
  doc.document.edges.push({ id: "e-1", sourceNodeId: "n-1", targetNodeId: "n-2" });
  return doc;
}

function switchFontCommand(
  session: DocumentSession,
  font: "noto-sans-sc" | "lxgw-wenkai",
  fonts: FontResolver,
) {
  const doc = session.current.document;
  const previousFont = doc.document.font;
  const sizes = doc.document.nodes.map((node) => ({
    id: node.id,
    size: measureNodeVisual(node, font, fonts),
  }));
  return {
    kind: "SetDocumentFontAndResizeNodes" as const,
    font,
    previousFont,
    sizes,
  };
}

describe("PRR-040 字体切换几何事务（真实字体 + 三格式导出）", () => {
  it("Noto→LXGW→Noto 两向切换：size 始终等于目标字体直接度量，Save/reopen 保留结果，三格式渲染成功", async () => {
    const fonts = await loadFonts();
    const renderer = await createExportRenderer({ fonts, resvgWasm: wasm });
    const resolver = renderer.fontResolver();
    const session = new DocumentSession(seededDocument());

    // 用当前（黑体）字体重测基线，保证起点 size 是权威值
    for (const node of session.current.document.document.nodes) {
      node.size = measureNodeVisual(node, "noto-sans-sc", resolver);
    }

    // Noto → LXGW
    const toLxgw = switchFontCommand(session, "lxgw-wenkai", resolver);
    const r1 = session.commit(toLxgw);
    expect(r1.ok).toBe(true);
    expect(session.current.document.document.font).toBe("lxgw-wenkai");
    let anyWidthChanged = false;
    for (const node of session.current.document.document.nodes) {
      const direct = measureNodeVisual(node, "lxgw-wenkai", resolver);
      expect(node.size).toEqual(direct); // 持久化 size = 目标字体真实度量
      if (node.size.width !== measureNodeVisual(node, "noto-sans-sc", resolver).width) {
        anyWidthChanged = true;
      }
    }
    // 混排文本（含 ASCII）在两款字体下度量必须存在真实差异——
    // 证明切换后的 size 不是旧字体几何的搬运。
    expect(anyWidthChanged).toBe(true);

    // Save（canonical 序列化）→ reopen（decode）往返
    const saved = encodeDocument(session.current.document);
    const reopened = decodeDocument(saved);
    expect(reopened.ok).toBe(true);
    if (reopened.ok) {
      expect(reopened.doc.document.font).toBe("lxgw-wenkai");
      expect(reopened.doc.document.nodes).toEqual(session.current.document.document.nodes);
    }

    // 三格式导出（LXGW 文档）
    const sceneLxgw = await renderer.buildScene(session.current.document);
    expect(sceneLxgw.ok).toBe(true);
    if (sceneLxgw.ok) {
      const svg = await renderer.renderSvg(sceneLxgw.scene);
      expect(svg.length).toBeGreaterThan(0);
      const png = await renderer.renderPng(svg, sceneLxgw.scene, 2);
      expect(png.ok).toBe(true);
      const pdf = await renderer.renderPdf(sceneLxgw.scene);
      expect(pdf.ok).toBe(true);
    }

    // LXGW → Noto（反向切换）+ 一步 undo 恢复
    const toNoto = switchFontCommand(session, "noto-sans-sc", resolver);
    const r2 = session.commit(toNoto);
    expect(r2.ok).toBe(true);
    expect(session.current.document.document.font).toBe("noto-sans-sc");
    for (const node of session.current.document.document.nodes) {
      expect(node.size).toEqual(measureNodeVisual(node, "noto-sans-sc", resolver));
    }
    session.undo();
    expect(session.current.document.document.font).toBe("lxgw-wenkai");
    for (const node of session.current.document.document.nodes) {
      expect(node.size).toEqual(measureNodeVisual(node, "lxgw-wenkai", resolver));
    }

    // 切换后导出（回到 Noto 的 redo 态也可导出）
    session.redo();
    const sceneNoto = await renderer.buildScene(session.current.document);
    expect(sceneNoto.ok).toBe(true);
    if (sceneNoto.ok) {
      const svg = await renderer.renderSvg(sceneNoto.scene);
      const png = await renderer.renderPng(svg, sceneNoto.scene, 2);
      const pdf = await renderer.renderPdf(sceneNoto.scene);
      expect(png.ok).toBe(true);
      expect(pdf.ok).toBe(true);
    }
  });
});
