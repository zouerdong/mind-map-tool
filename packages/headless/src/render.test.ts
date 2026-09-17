// render.test.ts — 无头渲染矩阵（产品规格 AC-1/AC-2：与 golden 同源管线）。

import { describe, it, expect, beforeAll } from "vitest";
import { decodeDocument, validateDocument, type MindMapDocumentV1 } from "@mindmap/core";
import { createExportRenderer, GRAPH_JSON_FORMAT, type ExportRenderer } from "@mindmap/export";
import { loadFontBundle, loadResvgWasm } from "./assets.js";
import { buildDocumentFromOutline } from "./outline.js";
import { renderDocument, OUTPUT_FORMATS } from "./render.js";

let renderer: ExportRenderer;
let doc: MindMapDocumentV1;

beforeAll(async () => {
  renderer = await createExportRenderer({
    fonts: loadFontBundle(),
    resvgWasm: loadResvgWasm(),
  });
  const built = buildDocumentFromOutline(renderer, {
    text: "发布会计划",
    children: [
      { text: "开源换证", children: [{ text: "MIT 许可证" }] },
      { text: "Agent 无头导出", children: [{ text: "MCP stdio" }, { text: "默认 PNG" }] },
    ],
  });
  expect(built.ok).toBe(true);
  if (built.ok) doc = built.document;
});

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("renderDocument 全格式矩阵", () => {
  it("png：PNG magic + 非空（2x）", async () => {
    const r = await renderDocument(renderer, doc, "png");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([...r.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(r.bytes.length).toBeGreaterThan(1000);
  });

  it("svg：语义 SVG 含 <svg 与文本", async () => {
    const r = await renderDocument(renderer, doc, "svg");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const svg = text(r.bytes);
    expect(svg).toContain("<svg");
    expect(svg).toContain("发布会计划");
  });

  it("pdf：%PDF magic", async () => {
    const r = await renderDocument(renderer, doc, "pdf");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(text(r.bytes.slice(0, 4))).toBe("%PDF");
  });

  it("json：Graph JSON 契约", async () => {
    const r = await renderDocument(renderer, doc, "json");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const parsed = JSON.parse(text(r.bytes));
    expect(parsed.format).toBe(GRAPH_JSON_FORMAT);
    expect(parsed.graph.nodes.length).toBe(6);
  });

  it("mindmap：encodeDocument → decodeDocument 往返且通过 schema 校验", async () => {
    const r = await renderDocument(renderer, doc, "mindmap");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const decoded = decodeDocument(r.bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(validateDocument(decoded.doc).ok).toBe(true);
    expect(decoded.doc.document.nodes.length).toBe(doc.document.nodes.length);
    expect(decoded.doc.document.edges.length).toBe(doc.document.edges.length);
  });

  it("OUTPUT_FORMATS 五种格式均可渲染", async () => {
    for (const format of OUTPUT_FORMATS) {
      const r = await renderDocument(renderer, doc, format);
      expect(r.ok, `format=${format}`).toBe(true);
    }
  });
});
