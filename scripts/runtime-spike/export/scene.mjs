// Export scene builder + canonical SVG serializer (MM-010 spike).
// Shared text-layout contract: fixed font size/weight, line-height, padding,
// baseline. Explicit \n only. Node size in the document is authoritative.
// Spike code — zero product-reuse assumption (MM-010 risk mitigation).

export const LAYOUT = {
  fontToken: "Noto Sans SC",
  fontSize: 14,
  lineHeight: 1.5,
  paddingX: 10,
  paddingY: 8,
  contentMargin: 40,
  strokeWidth: 1.5,
};

export const THEMES = {
  light: {
    bg: "#ffffff",
    nodeFill: "#f7f7f5",
    nodeStroke: "#3d3d3a",
    text: "#1a1a1a",
    edge: "#75746f",
  },
  dark: {
    bg: "#111318",
    nodeFill: "#1d2026",
    nodeStroke: "#c9ced8",
    text: "#e8eaf0",
    edge: "#8a8f99",
  },
};

// Numeric contract: max 3 decimals, no trailing zeros, -0 -> 0.
export function num(v) {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
}

function escapeXml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Canonical line splitting: explicit \n only, no implicit reflow.
export function splitLines(text) {
  return String(text).split("\n");
}

export function contentBounds(nodes) {
  if (nodes.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + n.size.width);
    maxY = Math.max(maxY, n.position.y + n.size.height);
  }
  return { minX, minY, maxX, maxY };
}

// document (MindMapDocumentV1) -> scene { width, height, theme, items[] }
// items are z-ordered: edges below, nodes above, text last.
export function buildScene(doc) {
  const { theme, nodes, edges } = doc.document;
  const t = THEMES[theme] ?? THEMES.light;
  const bounds = contentBounds(nodes);
  if (!bounds) return { empty: true, theme, width: 0, height: 0, items: [] };

  const m = LAYOUT.contentMargin;
  const offX = -(bounds.minX - m);
  const offY = -(bounds.minY - m);
  const width = bounds.maxX - bounds.minX + m * 2;
  const height = bounds.maxY - bounds.minY + m * 2;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edgeItems = [];
  for (const e of edges) {
    const a = byId.get(e.sourceNodeId);
    const b = byId.get(e.targetNodeId);
    if (!a || !b) continue; // no dangling edges in scene
    const x1 = a.position.x + a.size.width / 2 + offX;
    const y1 = a.position.y + a.size.height / 2 + offY;
    const x2 = b.position.x + b.size.width / 2 + offX;
    const y2 = b.position.y + b.size.height / 2 + offY;
    const dx = (x2 - x1) / 2;
    const d = `M ${num(x1)} ${num(y1)} C ${num(x1 + dx)} ${num(y1)}, ${num(x2 - dx)} ${num(y2)}, ${num(x2)} ${num(y2)}`;
    edgeItems.push({ kind: "edge", d, stroke: t.edge });
  }

  const nodeItems = [];
  const textItems = [];
  for (const n of nodes) {
    const x = n.position.x + offX;
    const y = n.position.y + offY;
    nodeItems.push({
      kind: "node",
      x, y, w: n.size.width, h: n.size.height,
      fill: t.nodeFill, stroke: t.nodeStroke,
    });
    const lines = splitLines(n.text);
    const lh = LAYOUT.fontSize * LAYOUT.lineHeight;
    const blockH = lines.length * lh;
    const startY = y + (n.size.height - blockH) / 2 + LAYOUT.fontSize; // first baseline
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length === 0) continue;
      const w = measureLine(line); // shared contract measurement (see measureText.mjs)
      const tx = x + (n.size.width - w) / 2;
      textItems.push({
        kind: "text",
        x: tx,
        y: startY + i * lh,
        text: line,
        fill: t.text,
      });
    }
  }

  return {
    empty: false,
    theme,
    width: Math.round(width),
    height: Math.round(height),
    items: [...edgeItems, ...nodeItems, ...textItems],
    missingGlyphs: collectMissingGlyphs(nodes),
  };
}

// Hook points populated by measureText.mjs (font-dependent). Pure-CJK ASCII
// fallback keeps this module loadable without a font file.
let measureFn = (line) => line.length * LAYOUT.fontSize;
let missingFn = () => [];
export function setTextMeasurement({ measure, missing }) {
  if (measure) measureFn = measure;
  if (missing) missingFn = missing;
}
export function measureLine(line) { return measureFn(line); }
export function collectMissingGlyphs(nodes) {
  const chars = new Set();
  for (const n of nodes) for (const ch of n.text) if (ch !== "\n") chars.add(ch);
  return missingFn([...chars]);
}

export const SIZE_LIMITS = {
  maxPixels: 120_000_000, // 120 MP total budget for PNG
  maxSide: 32_767, // per-side cap
};

export function checkExportSize(scene, scale = 2) {
  const w = scene.width * scale;
  const h = scene.height * scale;
  if (w > SIZE_LIMITS.maxSide || h > SIZE_LIMITS.maxSide || w * h > SIZE_LIMITS.maxPixels) {
    return {
      ok: false,
      code: "EXPORT_SIZE_LIMIT",
      message: `导出尺寸 ${w}x${h} 超过上限（单边 ≤ ${SIZE_LIMITS.maxSide}px，总像素 ≤ ${SIZE_LIMITS.maxPixels}）。请缩小画布或改用 SVG。`,
      w, h,
    };
  }
  return { ok: true, w, h };
}

// scene -> canonical SVG bytes (fixed attribute order, no foreignObject)
export function sceneToSvg(scene) {
  if (scene.empty) {
    return { error: { code: "EXPORT_EMPTY_DOCUMENT", message: "空文档不能导出。" } };
  }
  const t = THEMES[scene.theme] ?? THEMES.light;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}">`);
  parts.push(`<rect x="0" y="0" width="${scene.width}" height="${scene.height}" fill="${t.bg}"/>`);
  for (const it of scene.items) {
    if (it.kind === "edge") {
      parts.push(`<path d="${it.d}" fill="none" stroke="${it.stroke}" stroke-width="${num(LAYOUT.strokeWidth)}"/>`);
    } else if (it.kind === "node") {
      parts.push(`<rect x="${num(it.x)}" y="${num(it.y)}" width="${num(it.w)}" height="${num(it.h)}" rx="6" fill="${it.fill}" stroke="${it.stroke}" stroke-width="1"/>`);
    } else if (it.kind === "text") {
      parts.push(`<text x="${num(it.x)}" y="${num(it.y)}" fill="${it.fill}" font-family="${LAYOUT.fontToken}" font-size="${LAYOUT.fontSize}">${escapeXml(it.text)}</text>`);
    }
  }
  parts.push("</svg>");
  const svg = parts.join("\n") + "\n";
  return { svg, bytes: Buffer.from(svg, "utf8") };
}
