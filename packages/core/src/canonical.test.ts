import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { encodeDocument, decodeDocument, normalizeNumber } from "./canonical.js";
import { emptyDocument, validateDocument, type MindMapDocumentV1 } from "./schema.js";

function sampleDoc(): MindMapDocumentV1 {
  return {
    schemaVersion: 1,
    document: {
      theme: "light",
      font: "noto-sans-sc",
      shape: "card",
      framesVisible: true,
      nodes: [
        {
          id: "n-1",
          text: "标题：创意\n第二行 & <标签>",
          position: { x: 10.123456, y: -20.00004 },
          size: { width: 96.5, height: 40 },
          shape: "ellipse",
        },
        {
          id: "n-2",
          text: "目标节点",
          position: { x: -0, y: 200 },
          size: { width: 80, height: 40 },
        },
      ],
      edges: [{ id: "e-1", sourceNodeId: "n-1", targetNodeId: "n-2" }],
    },
  };
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("canonical encode/decode", () => {
  it("round-trip：decode(encode(doc)) ≡ doc（数值规范化后）", () => {
    const doc = sampleDoc();
    const bytes = encodeDocument(doc);
    const out = decodeDocument(bytes);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.doc.document.nodes[0]!.position.x).toBe(10.123); // 3 位小数
    expect(out.doc.document.nodes[0]!.position.y).toBe(-20); // -0.00004 → -0 → 0
    expect(out.doc.document.nodes[1]!.position.x).toBe(0); // -0 归一
    expect(out.doc.document.nodes[0]!.shape).toBe("ellipse");
    expect(out.doc.document.nodes[1]!.shape).toBeUndefined();
    // 再次编码与第一次 bytes 相同（canonical 稳定）
    expect(sha(encodeDocument(out.doc))).toBe(sha(bytes));
  });

  it("同输入 hash 稳定（连跑 100 次）", () => {
    const bytes = encodeDocument(sampleDoc());
    const h = sha(bytes);
    for (let i = 0; i < 100; i++) {
      expect(sha(encodeDocument(sampleDoc()))).toBe(h);
    }
  });

  it("键顺序固定：theme → font → shape → nodes → edges；节点 id→text→position→size→shape?", () => {
    const text = new TextDecoder().decode(encodeDocument(sampleDoc()));
    const docIdx = text.indexOf('"theme"');
    expect(docIdx).toBeGreaterThan(-1);
    expect(text.indexOf('"font"')).toBeGreaterThan(docIdx);
    expect(text.indexOf('"shape": "card"')).toBeGreaterThan(text.indexOf('"font"'));
    expect(text.indexOf('"framesVisible"')).toBeGreaterThan(text.indexOf('"shape": "card"'));
    expect(text.indexOf('"nodes"')).toBeGreaterThan(text.indexOf('"framesVisible"'));
    expect(text.indexOf('"edges"')).toBeGreaterThan(text.indexOf('"nodes"'));
    const nodeStart = text.indexOf('"id": "n-1"');
    expect(text.indexOf('"text"', nodeStart)).toBeGreaterThan(nodeStart);
    expect(text.indexOf('"position"', nodeStart)).toBeGreaterThan(
      text.indexOf('"text"', nodeStart),
    );
  });

  it("LF 换行、末尾单个换行、无 BOM", () => {
    const bytes = encodeDocument(sampleDoc());
    expect(bytes[0]).not.toBe(0xef);
    expect(bytes[bytes.length - 1]).toBe(0x0a);
    expect(bytes[bytes.length - 2]).not.toBe(0x0a);
    const text = new TextDecoder().decode(bytes);
    expect(text.includes("\r")).toBe(false);
  });

  it("不序列化 selection/viewport/history/path/target handle/onboarding", () => {
    const text = new TextDecoder().decode(encodeDocument(sampleDoc()));
    for (const banned of [
      "selection",
      "viewport",
      "zoom",
      "history",
      "displayPath",
      "targetHandle",
      "versionToken",
      "onboarding",
      "dirty",
    ]) {
      expect(text.includes(banned)).toBe(false);
    }
  });

  it("中文与控制字符保留并按 JSON 转义", () => {
    const doc = emptyDocument();
    doc.document.nodes.push({
      id: "cn",
      text: "引号“”\n制表\t结束",
      position: { x: 0, y: 0 },
      size: { width: 10, height: 10 },
    });
    const out = decodeDocument(encodeDocument(doc));
    expect(out.ok && out.doc.document.nodes[0]!.text).toBe("引号“”\n制表\t结束");
  });

  it("拒绝 BOM 与未来主版本", () => {
    const good = encodeDocument(sampleDoc());
    const withBom = new Uint8Array(3 + good.length);
    withBom.set([0xef, 0xbb, 0xbf], 0);
    withBom.set(good, 3);
    expect(decodeDocument(withBom).ok).toBe(false);

    const future = new TextDecoder()
      .decode(good)
      .replace('"schemaVersion": 1', '"schemaVersion": 2');
    const r = decodeDocument(new TextEncoder().encode(future));
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.code === "FUTURE_VERSION") expect(r.error.actual).toBe(2);
  });

  it("富文本 runs：round-trip、有序区间、canonical 稳定", () => {
    const doc = sampleDoc();
    doc.document.nodes[0]!.runs = [
      { start: 0, end: 2, bold: true },
      { start: 4, end: 7, underline: true, fontSize: 20 },
    ];
    const bytes = encodeDocument(doc);
    const out = decodeDocument(bytes);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.doc.document.nodes[0]!.runs).toEqual([
      { start: 0, end: 2, bold: true },
      { start: 4, end: 7, underline: true, fontSize: 20 },
    ]);
    expect(sha(encodeDocument(out.doc))).toBe(sha(bytes));
    // 区间键顺序 start,end,bold,underline,fontSize
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('"start": 0, "end": 2, "bold": true');
  });

  it("富文本 runs：越界/重叠/空样式/字号超限 拒绝", () => {
    const make = (runs: string) =>
      JSON.parse(
        `{ "schemaVersion": 1, "document": { "theme": "light", "font": "noto-sans-sc", "shape": "card", "framesVisible": true, "nodes": [ { "id": "n", "text": "abcdef", "position": { "x": 0, "y": 0 }, "size": { "width": 10, "height": 10 }, "runs": ${runs} } ], "edges": [] } }`,
      );
    expect(validateDocument(make('[{ "start": 5, "end": 3, "bold": true }]')).ok).toBe(false); // end <= start
    expect(validateDocument(make('[{ "start": 0, "end": 99, "bold": true }]')).ok).toBe(false); // 越界
    expect(
      validateDocument(
        make('[{ "start": 0, "end": 3, "bold": true }, { "start": 2, "end": 5, "bold": true }]'),
      ).ok,
    ).toBe(false); // 重叠/乱序
    expect(validateDocument(make('[{ "start": 0, "end": 3 }]')).ok).toBe(false); // 空样式
    expect(validateDocument(make('[{ "start": 0, "end": 3, "fontSize": 200 }]')).ok).toBe(false); // 字号超限
    expect(validateDocument(make('[{ "start": 0, "end": 3, "fontSize": 20 }]')).ok).toBe(true); // 合法
  });

  it("normalizeNumber：-0 → 0；>3 位小数收敛", () => {
    expect(normalizeNumber(-0)).toBe(0);
    expect(normalizeNumber(-0.0001)).toBe(0); // -0.0001 收敛为 -0 后归一为 0
    expect(normalizeNumber(10.123456)).toBe(10.123);
  });
});
