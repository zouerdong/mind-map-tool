// Canonical UTF-8 JSON 编解码（ADR 0003；v2 字段序 ADR 0010）：
// 无 BOM、两空格缩进、LF、末尾一个换行、固定键顺序；
// 数值最多 3 位小数、-0 归一为 0；对 locale/timezone 不敏感。
// decode(encode(doc)) ≡ doc；同 doc 的 encode bytes 恒定（可 hash/golden）。
// 保存（=新写）恒输出 schemaVersion 2（ADR 0010：读旧写新）。

import {
  LIMITS,
  validateDocument,
  type MindMapDocumentV1,
  type MindNode,
  type MindEdge,
} from "./schema.js";

/** 数值规范化：round 到 3 位小数；-0 → 0。encode 与 schema 校验共用。 */
export function normalizeNumber(v: number): number {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}

function fmt(v: number): string {
  return String(normalizeNumber(v));
}

function esc(s: string): string {
  // JSON 字符串转义（控制字符按 JSON 规则；保留用户 Unicode 内容）
  return JSON.stringify(s);
}

export function encodeDocument(doc: MindMapDocumentV1): Uint8Array {
  const d = doc.document;
  const parts: string[] = [];
  parts.push('{\n  "schemaVersion": 2,');
  parts.push(`  "document": {`);
  parts.push(`    "theme": ${esc(d.theme)},`);
  parts.push(`    "font": ${esc(d.font)},`);
  parts.push(`    "shape": ${esc(d.shape)},`);
  parts.push(`    "framesVisible": ${d.framesVisible === false ? "false" : "true"},`);
  parts.push(`    "nodes": [`);
  const nodeLines: string[] = [];
  for (let i = 0; i < d.nodes.length; i++)
    nodeLines.push(nodeLine(d.nodes[i]!, i === d.nodes.length - 1));
  parts.push(nodeLines.map((l) => "      " + l).join("\n"));
  parts.push(`    ],`);
  parts.push(`    "edges": [`);
  const edgeLines: string[] = [];
  for (let i = 0; i < d.edges.length; i++)
    edgeLines.push(edgeLine(d.edges[i]!, i === d.edges.length - 1));
  parts.push(edgeLines.map((l) => "      " + l).join("\n"));
  parts.push(`    ]`);
  parts.push(`  }`);
  parts.push(`}`);
  const text = parts.join("\n") + "\n";
  return new TextEncoder().encode(text);
}

function nodeLine(n: MindNode, last: boolean): string {
  const fields = [
    `"id": ${esc(n.id)}`,
    `"text": ${esc(n.text)}`,
    `"position": { "x": ${fmt(n.position.x)}, "y": ${fmt(n.position.y)} }`,
    `"size": { "width": ${fmt(n.size.width)}, "height": ${fmt(n.size.height)} }`,
  ];
  if (n.shape !== undefined) fields.push(`"shape": ${esc(n.shape)}`);
  // [ADR 0010 v2] kicker/emphasis 紧随 shape（缺省不输出；空串/false 已在 schema 层归一）
  if (n.kicker !== undefined && n.kicker.length > 0) fields.push(`"kicker": ${esc(n.kicker)}`);
  if (n.emphasis === true) fields.push(`"emphasis": true`);
  if (n.runs !== undefined && n.runs.length > 0) {
    const runParts = n.runs.map((r) => {
      const rf = [`"start": ${r.start}`, `"end": ${r.end}`];
      if (r.bold !== undefined) rf.push(`"bold": ${r.bold}`);
      if (r.underline !== undefined) rf.push(`"underline": ${r.underline}`);
      if (r.fontSize !== undefined) rf.push(`"fontSize": ${normalizeNumber(r.fontSize)}`);
      return `{ ${rf.join(", ")} }`;
    });
    fields.push(`"runs": [${runParts.join(", ")}]`);
  }
  return `{ ${fields.join(", ")} }${last ? "" : ","}`;
}

function edgeLine(e: MindEdge, last: boolean): string {
  // [ADR 0010 v2] lineStyle 紧随 targetNodeId（solid 缺省不输出）
  const style =
    e.lineStyle === "dashed" || e.lineStyle === "dotted" ? `, "lineStyle": ${esc(e.lineStyle)}` : "";
  return `{ "id": ${esc(e.id)}, "sourceNodeId": ${esc(e.sourceNodeId)}, "targetNodeId": ${esc(e.targetNodeId)}${style} }${last ? "" : ","}`;
}

export type DecodeError =
  | { code: "INPUT_TOO_LARGE"; bytes: number; max: number }
  | { code: "NOT_UTF8" }
  | { code: "NOT_JSON"; message: string }
  | { code: "HAS_BOM" }
  | { code: "FUTURE_VERSION"; actual: number }
  | { code: "SCHEMA"; detail: unknown };

/** 读取入口：大小前置限制 → UTF-8 → BOM 拒绝 → JSON → schema/语义校验。 */
export function decodeDocument(
  bytes: Uint8Array,
): { ok: true; doc: MindMapDocumentV1 } | { ok: false; error: DecodeError } {
  if (bytes.length > LIMITS.maxInputBytes)
    return {
      ok: false,
      error: { code: "INPUT_TOO_LARGE", bytes: bytes.length, max: LIMITS.maxInputBytes },
    };
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return { ok: false, error: { code: "HAS_BOM" } };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, error: { code: "NOT_UTF8" } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      error: { code: "NOT_JSON", message: String((e as Error).message).slice(0, 200) },
    };
  }
  // 未来主版本：只读拒绝（调用方提示升级，不允许覆盖原文件）。v1/v2 可读（ADR 0010）。
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    typeof (parsed as Record<string, unknown>).schemaVersion === "number" &&
    (parsed as Record<string, unknown>).schemaVersion !== 1 &&
    (parsed as Record<string, unknown>).schemaVersion !== 2
  ) {
    return {
      ok: false,
      error: {
        code: "FUTURE_VERSION",
        actual: (parsed as Record<string, unknown>).schemaVersion as number,
      },
    };
  }
  const validated = validateDocument(parsed);
  if (!validated.ok) return { ok: false, error: { code: "SCHEMA", detail: validated.error } };
  // 规范化数值（3 位小数 / -0）保证 round-trip 等价
  const doc = validated.doc;
  for (const n of doc.document.nodes) {
    n.position.x = normalizeNumber(n.position.x);
    n.position.y = normalizeNumber(n.position.y);
    n.size.width = normalizeNumber(n.size.width);
    n.size.height = normalizeNumber(n.size.height);
  }
  return { ok: true, doc };
}
