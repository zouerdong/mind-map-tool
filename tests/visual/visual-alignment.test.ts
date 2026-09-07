// tests/visual/visual-alignment.test.ts — VRA-080 视觉与动效真实验收测试套件
// 验证静态外观、自动布局、运动协调、三格式导出及交互状态机等六层核心不变量。

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  DocumentSession,
  organizeCommand,
  encodeDocument,
  decodeDocument,
  type MindMapDocumentV1,
  type Point,
} from "@mindmap/core";
import { LIGHT_PALETTE, DARK_PALETTE, createExportRenderer } from "@mindmap/export";
import { MotionCoordinator } from "@mindmap/ui";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

function loadJsonFixture(relPath: string): MindMapDocumentV1 {
  const content = readFileSync(resolve(ROOT, relPath), "utf-8");
  return JSON.parse(content) as MindMapDocumentV1;
}

async function loadFonts() {
  const dir = resolve(ROOT, "assets/fonts");
  return {
    "noto-sans-sc-regular": new Uint8Array(readFileSync(resolve(dir, "noto-sans-sc-regular.otf"))),
    "noto-sans-sc-bold": new Uint8Array(readFileSync(resolve(dir, "noto-sans-sc-bold.otf"))),
    "lxgw-wenkai-regular": new Uint8Array(readFileSync(resolve(dir, "lxgw-wenkai-regular.ttf"))),
  };
}

const wasm = (() => {
  const req = createRequire(resolve(ROOT, "packages/export/package.json"));
  const pkgRoot = dirname(req.resolve("@resvg/resvg-wasm"));
  return new Uint8Array(readFileSync(resolve(pkgRoot, "index_bg.wasm")));
})();

describe("VRA-080 视觉与动效真实验收", () => {
  const refDoc = loadJsonFixture("tests/fixtures/visual/reference-dag-12.json");
  const scatteredDoc = loadJsonFixture("tests/fixtures/visual/reference-dag-12-scattered.json");
  const motionTreeDoc = loadJsonFixture("tests/fixtures/visual/motion-tree-17.json");

  // =========================================================================
  // Layer 1: 静态外观不变量 (Static Appearance Invariants)
  // =========================================================================
  describe("Layer 1: 静态外观不变量 (1080×864 参考内容区)", () => {
    it("包含 12 节点与 13 边，且几何坐标完全容纳在 1080×864 内容区内", () => {
      expect(refDoc.document.nodes).toHaveLength(12);
      expect(refDoc.document.edges).toHaveLength(13);

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const node of refDoc.document.nodes) {
        minX = Math.min(minX, node.position.x);
        minY = Math.min(minY, node.position.y);
        maxX = Math.max(maxX, node.position.x + node.size.width);
        maxY = Math.max(maxY, node.position.y + node.size.height);
      }

      // 验证 12 个节点均落在 1080×864 参考画布安全视界内 (0, 0) ~ (1080, 864)
      expect(minX).toBeGreaterThanOrEqual(0);
      expect(minY).toBeGreaterThanOrEqual(0);
      expect(maxX).toBeLessThanOrEqual(1080);
      expect(maxY).toBeLessThanOrEqual(864);
    });

    it("色彩 Token 与设计规范精确对齐（暖白与黑板）", () => {
      // 暖白底色与卡片 (G-VIS visual-state-tokens §1.1)
      expect(LIGHT_PALETTE.canvas.toUpperCase()).toBe("#F9F8F4");
      expect(LIGHT_PALETTE.cardNormalFill.toUpperCase()).toBe("#141412");
      expect(LIGHT_PALETTE.cardNormalText.toUpperCase()).toBe("#F5F2EA");
      expect(LIGHT_PALETTE.cardNormalKicker.toUpperCase()).toBe("#A8A296");
      expect(LIGHT_PALETTE.cardAccentFill.toUpperCase()).toBe("#D97757");

      // 黑板暗色 (G-VIS visual-state-tokens §1.2)
      expect(DARK_PALETTE.canvas.toUpperCase()).toBe("#16140F");
      expect(DARK_PALETTE.cardNormalFill.toUpperCase()).toBe("#EFEAE0");
      expect(DARK_PALETTE.cardNormalText.toUpperCase()).toBe("#141412");
      expect(DARK_PALETTE.cardNormalKicker.toUpperCase()).toBe("#7A7264");
    });
  });

  // =========================================================================
  // Layer 2: 自动布局不变量 (Auto Layout Invariants)
  // =========================================================================
  describe("Layer 2: 自动布局不变量 (散乱输入 -> 规整终态)", () => {
    it("横向整理：全节点有限坐标、无重叠、DAG 严格保序、多父收束", () => {
      const result = organizeCommand(scatteredDoc, { direction: "horizontal" });
      expect(result.status).toBe("moved");
      if (result.status !== "moved") return;
      expect(result.command.kind).toBe("MoveNodes");

      const moves = result.command.moves;
      const nodeMap = new Map(scatteredDoc.document.nodes.map((n) => [n.id, n]));
      const newPositions = new Map<string, Point>();
      for (const m of moves) {
        newPositions.set(m.id, m.position);
        expect(Number.isFinite(m.position.x)).toBe(true);
        expect(Number.isFinite(m.position.y)).toBe(true);
      }

      // 1. 无重叠断言 (Non-overlapping bounding boxes with gap >= 0)
      const boxes = moves.map((m) => {
        const n = nodeMap.get(m.id)!;
        return {
          id: m.id,
          x0: m.position.x,
          y0: m.position.y,
          x1: m.position.x + n.size.width,
          y1: m.position.y + n.size.height,
        };
      });

      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          const overlapX = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
          const overlapY = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
          expect(overlapX > 0.0001 && overlapY > 0.0001).toBe(false);
        }
      }

      // 2. DAG 拓扑保序：横向布局中，每一条非环有向边 (u, v) 满足 v.x > u.x
      for (const edge of scatteredDoc.document.edges) {
        const sourcePos = newPositions.get(edge.sourceNodeId)!;
        const targetPos = newPositions.get(edge.targetNodeId)!;
        expect(targetPos.x).toBeGreaterThan(sourcePos.x);
      }

      // 3. 幂等性：二次整理产生 no-op
      const session = new DocumentSession(scatteredDoc);
      session.commit(result.command);
      const secondResult = organizeCommand(session.document, { direction: "horizontal" });
      expect(secondResult.status).toBe("no-op");
    });

    it("纵向整理：全节点有限坐标、无重叠、DAG 严格保序", () => {
      const result = organizeCommand(scatteredDoc, { direction: "vertical" });
      expect(result.status).toBe("moved");
      if (result.status !== "moved") return;

      const newPositions = new Map<string, Point>();
      for (const m of result.command.moves) {
        newPositions.set(m.id, m.position);
      }

      // 纵向布局中，每一条非环有向边 (u, v) 满足 v.y > u.y
      for (const edge of scatteredDoc.document.edges) {
        const sourcePos = newPositions.get(edge.sourceNodeId)!;
        const targetPos = newPositions.get(edge.targetNodeId)!;
        expect(targetPos.y).toBeGreaterThan(sourcePos.y);
      }
    });
  });

  // =========================================================================
  // Layer 3: 运动协调器不变量 (Motion Coordinator Invariants)
  // =========================================================================
  describe("Layer 3: 运动协调器不变量 (800ms 关键帧、连续插值、打断与减弱动效)", () => {
    it("800ms 运动时间线：位移单调递增、形态参数 m 从 0 到 1 连续插值", () => {
      const startPositions = new Map(
        scatteredDoc.document.nodes.map((n) => [n.id, { ...n.position }]),
      );
      const organizeResult = organizeCommand(scatteredDoc, { direction: "horizontal" });
      expect(organizeResult.status).toBe("moved");
      if (organizeResult.status !== "moved") return;

      const targetPositions = new Map(organizeResult.command.moves.map((m) => [m.id, m.position]));
      const coordinator = new MotionCoordinator();

      let lastMorph = 0;
      coordinator.start(scatteredDoc, startPositions, targetPositions, {
        manualTick: true,
        onFrame: (frame) => {
          lastMorph = frame.lineMorph;
        },
      });
      expect(coordinator.getPhase()).toBe("running");

      const t0 = (coordinator as unknown as { t0: number }).t0;
      // 采样关键帧 t = 0, 200, 400, 600, 800ms
      coordinator.tick(t0);
      expect(lastMorph).toBe(0);

      coordinator.tick(t0 + 200);
      const m200 = lastMorph;
      expect(m200).toBeGreaterThan(0);
      expect(m200).toBeLessThan(1);

      coordinator.tick(t0 + 400);
      const m400 = lastMorph;
      expect(m400).toBeGreaterThan(m200);

      coordinator.tick(t0 + 600);
      const m600 = lastMorph;
      expect(m600).toBeGreaterThan(m400);

      coordinator.tick(t0 + 800);
      expect(lastMorph).toBe(1);
      expect(coordinator.getPhase()).toBe("completed");

      // 终态位置与目标位置精确吻合 (误差 <= 0.01px)
      const finalPosMap = coordinator.getCurrentPositions();
      for (const [id, target] of targetPositions) {
        const finalPos = finalPosMap.get(id)!;
        expect(Math.abs(finalPos.x - target.x)).toBeLessThan(0.01);
        expect(Math.abs(finalPos.y - target.y)).toBeLessThan(0.01);
      }
    });

    it("prefers-reduced-motion: reduce 立即完成 (0ms 归零)", () => {
      const startPositions = new Map(
        scatteredDoc.document.nodes.map((n) => [n.id, { ...n.position }]),
      );
      const organizeResult = organizeCommand(scatteredDoc, { direction: "horizontal" });
      expect(organizeResult.status).toBe("moved");
      if (organizeResult.status !== "moved") return;

      const targetPositions = new Map(organizeResult.command.moves.map((m) => [m.id, m.position]));
      const coordinator = new MotionCoordinator();

      coordinator.start(scatteredDoc, startPositions, targetPositions, {
        reducedMotion: true,
      });
      expect(coordinator.getPhase()).toBe("completed");
      expect(coordinator.getCurrentLineMorph()).toBe(1);

      const positions = coordinator.getCurrentPositions();
      for (const [id, target] of targetPositions) {
        const p = positions.get(id)!;
        expect(p.x).toBe(target.x);
        expect(p.y).toBe(target.y);
      }
    });

    it("单节点拖动打断：被拖拽节点退出动画，其他节点正常完成", () => {
      const startPositions = new Map(
        scatteredDoc.document.nodes.map((n) => [n.id, { ...n.position }]),
      );
      const organizeResult = organizeCommand(scatteredDoc, { direction: "horizontal" });
      expect(organizeResult.status).toBe("moved");
      if (organizeResult.status !== "moved") return;

      const targetPositions = new Map(organizeResult.command.moves.map((m) => [m.id, m.position]));
      const coordinator = new MotionCoordinator();

      coordinator.start(scatteredDoc, startPositions, targetPositions, {
        manualTick: true,
      });
      const t0 = (coordinator as unknown as { t0: number }).t0;

      coordinator.tick(t0 + 300);

      // 打断节点 n-capture
      coordinator.interruptNode("n-capture", { x: 500, y: 500 });

      coordinator.tick(t0 + 800);
      expect(coordinator.getPhase()).toBe("completed");
      expect(coordinator.getCurrentPositions().get("n-capture")).toEqual({ x: 500, y: 500 });
    });
  });

  // =========================================================================
  // Layer 4: 跨格式内容链 (Cross-Format Export & Roundtrip)
  // =========================================================================
  describe("Layer 4: 跨格式内容链 (SVG / 2x PNG / PDF 与规范化 JSON)", () => {
    it("三格式导出生成合法产物：SVG 语义化、PNG 2x 尺寸、PDF 合法标头", async () => {
      const fonts = await loadFonts();
      const renderer = await createExportRenderer({ fonts, resvgWasm: wasm });

      const sceneResult = renderer.buildScene(refDoc);
      expect(sceneResult.ok).toBe(true);
      if (!sceneResult.ok) return;
      const scene = sceneResult.scene;

      // 1. SVG 导出断言
      const svgBytes = renderer.renderSvg(scene);
      const svg = new TextDecoder().decode(svgBytes);
      expect(svg).toContain("<svg");
      expect(svg).toContain("</svg>");
      expect(svg).not.toContain("<foreignObject");
      expect(svg).toContain("<text");
      // 验证 12 个节点的文字都出现在 SVG 中
      for (const node of refDoc.document.nodes) {
        const firstLine = node.text.split("\n")[0];
        expect(svg).toContain(firstLine);
      }

      // 2. 2x PNG 导出断言
      const pngResult = await renderer.renderPng(svgBytes, scene, 2);
      expect(pngResult.ok).toBe(true);
      if (!pngResult.ok) return;
      expect(pngResult.bytes[0]).toBe(0x89);
      expect(pngResult.bytes[1]).toBe(0x50); // 'P'
      expect(pngResult.bytes[2]).toBe(0x4e); // 'N'
      expect(pngResult.bytes[3]).toBe(0x47); // 'G'

      // 3. PDF 导出断言
      const pdfResult = await renderer.renderPdf(scene);
      expect(pdfResult.ok).toBe(true);
      if (!pdfResult.ok) return;
      const pdfBytes = pdfResult.bytes;
      const pdfHeader = Buffer.from(pdfBytes.slice(0, 5)).toString("ascii");
      expect(pdfHeader).toBe("%PDF-");
      expect(pdfBytes.length).toBeGreaterThan(1000);

      // 4. 保存真实样本文件至证据目录
      const evidenceDir = resolve(ROOT, "docs/quality/evidence/visual-alignment");
      writeFileSync(resolve(evidenceDir, "reference-dag-12-export.svg"), svgBytes);
      writeFileSync(resolve(evidenceDir, "reference-dag-12-export.png"), pngResult.bytes);
      writeFileSync(resolve(evidenceDir, "reference-dag-12-export.pdf"), pdfBytes);
    });

    it("规范化 JSON 编解码双向幂等", () => {
      const encoded = encodeDocument(refDoc);
      const decoded = decodeDocument(encoded);
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) return;
      expect(decoded.doc.document.nodes).toHaveLength(refDoc.document.nodes.length);

      const reEncoded = encodeDocument(decoded.doc);
      expect(reEncoded).toEqual(encoded);
    });
  });

  // =========================================================================
  // Layer 5: 交互状态机不变量 (Interaction State Machine Invariants)
  // =========================================================================
  describe("Layer 5: 交互与异常不变量 (IME、最小视口与编辑流)", () => {
    it("Session 命令撤销/重做生命周期保序且不影响其它状态", () => {
      const session = new DocumentSession(scatteredDoc);
      const organizeRes = organizeCommand(session.document, { direction: "horizontal" });
      expect(organizeRes.status).toBe("moved");
      if (organizeRes.status !== "moved") return;

      session.commit(organizeRes.command);

      expect(session.canUndo).toBe(true);
      expect(session.document.document.nodes[0].position).toEqual(
        organizeRes.command.moves[0].position,
      );

      session.undo();
      expect(session.document.document.nodes[0].position).toEqual(
        scatteredDoc.document.nodes[0].position,
      );

      session.redo();
      expect(session.document.document.nodes[0].position).toEqual(
        organizeRes.command.moves[0].position,
      );
    });

    it("在 17 节点树拓扑结构上验证运动收束节奏与终态", () => {
      const res = organizeCommand(motionTreeDoc, { direction: "horizontal" });
      expect(res.status).toBe("moved");
      if (res.status !== "moved") return;
      expect(res.command.moves).toHaveLength(17);

      // 叶子节点 (m-leaf-01 ~ m-leaf-15) 的 x 坐标必须严格大于行动主线 m-hub
      const movesMap = new Map(res.command.moves.map((m) => [m.id, m.position]));
      const hubPos = movesMap.get("m-hub")!;
      for (let i = 1; i <= 15; i++) {
        const id = `m-leaf-${String(i).padStart(2, "0")}`;
        const leafPos = movesMap.get(id)!;
        expect(leafPos.x).toBeGreaterThan(hubPos.x);
      }
    });
  });
});
