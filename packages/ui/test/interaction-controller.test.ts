// InteractionController 单元测试（MM-050 步骤②③④）：
// 事件 → 命令归一化的全部规则（一次命令、无空命令、预检拒绝）。

import { describe, expect, it } from "vitest";
import type { MindMapDocumentV1 } from "@mindmap/core";
import { createInteractionController } from "../src/controller/interaction-controller.js";

const ADVANCE_PER_PT = 10; // 假字体：每字符宽 = fontSize × 10（确定性 size）

function setup(font = "noto-sans-sc" as const) {
  let nodeSeq = 0;
  let edgeSeq = 0;
  const controller = createInteractionController({
    nextNodeId: () => `n-${++nodeSeq}`,
    nextEdgeId: () => `e-${++edgeSeq}`,
    measure: (text, fontId) => {
      expect(fontId).toBe(font);
      const lines = text.split("\n");
      const width = Math.max(...lines.map((l) => l.length), 1) * 14 * ADVANCE_PER_PT;
      const height = lines.length * 14 * 1.5;
      return { width: width + 20, height: height + 16 };
    },
    currentFont: () => font,
  });
  return controller;
}

function doc(): MindMapDocumentV1 {
  return {
    schemaVersion: 1,
    document: {
      theme: "light",
      font: "noto-sans-sc",
      shape: "card",
      framesVisible: true,
      nodes: [
        { id: "a", text: "A", position: { x: 0, y: 0 }, size: { width: 50, height: 37 } },
        { id: "b", text: "B", position: { x: 100, y: 0 }, size: { width: 50, height: 37 } },
      ],
      edges: [{ id: "e0", sourceNodeId: "a", targetNodeId: "b" }],
    },
  };
}

describe("createNodeAt", () => {
  it("注入 id 与权威 size（共享 layout 度量）", () => {
    const c = setup();
    const cmd = c.createNodeAt({ x: 12.3456, y: -0.0001 });
    expect(cmd).toMatchObject({
      kind: "CreateNode",
      id: "n-1",
      position: { x: 12.346, y: 0 }, // round3 + -0 归一
    });
    // 空文本：单行最小宽（1 字符）+ padding
    expect((cmd as { size: { width: number } }).size.width).toBe(1 * 140 + 20);
    expect((cmd as { size: { height: number } }).size.height).toBe(21 + 16);
  });
});

describe("commitEditText", () => {
  it("文本变化 → EditNodeText（text + 权威 size 同命令）", () => {
    const c = setup();
    const cmd = c.commitEditText("a", "两个节点", "A");
    expect(cmd).toMatchObject({ kind: "EditNodeText", id: "a", text: "两个节点" });
    expect((cmd as { size: { width: number } }).size.width).toBe(4 * 140 + 20);
  });
  it("文本未变 → null（无空历史）", () => {
    expect(setup().commitEditText("a", "A", "A")).toBeNull();
  });
});

describe("moveNodes（验收：拖动只提交一次 command）", () => {
  it("产生一条批量 MoveNodes；round3 生效", () => {
    const cmd = setup().moveNodes(
      [
        { id: "a", position: { x: 10.0005, y: 1 } },
        { id: "b", position: { x: 100.12345, y: 0 } },
      ],
      doc(),
    );
    expect(cmd).toEqual({
      kind: "MoveNodes",
      moves: [
        { id: "a", position: { x: 10.001, y: 1 } },
        { id: "b", position: { x: 100.123, y: 0 } },
      ],
    });
  });
  it("零位移 → null；未知节点被跳过", () => {
    const c = setup();
    expect(c.moveNodes([{ id: "a", position: { x: 0, y: 0 } }], doc())).toBeNull();
    expect(c.moveNodes([{ id: "ghost", position: { x: 5, y: 5 } }], doc())).toBeNull();
    const cmd = c.moveNodes(
      [
        { id: "ghost", position: { x: 9, y: 9 } },
        { id: "b", position: { x: 101, y: 0 } },
      ],
      doc(),
    );
    expect(cmd?.kind).toBe("MoveNodes");
    if (cmd?.kind === "MoveNodes") expect(cmd.moves).toHaveLength(1);
  });
});

describe("connect（预检）", () => {
  it("正常连接 → CreateEdge（注入 id）", () => {
    expect(setup().connect("b", "a", doc())).toMatchObject({
      kind: "CreateEdge",
      id: "e-1",
      sourceNodeId: "b",
      targetNodeId: "a",
    });
  });
  it("自环 / 同方向重复 / 悬空 → null（不提交注定失败的命令）", () => {
    const c = setup();
    expect(c.connect("a", "a", doc())).toBeNull();
    expect(c.connect("a", "b", doc())).toBeNull(); // e0 已存在 a→b
    expect(c.connect("a", "ghost", doc())).toBeNull();
  });
});

describe("deleteSelection / setTheme / setNodeShape", () => {
  it("空选择 → null", () => {
    expect(setup().deleteSelection([], [])).toBeNull();
  });
  it("选择 → DeleteSelection（节点+边）", () => {
    expect(setup().deleteSelection(["a"], ["e0"])).toEqual({
      kind: "DeleteSelection",
      nodeIds: ["a"],
      edgeIds: ["e0"],
    });
  });
  it("主题与形状命令", () => {
    const c = setup();
    expect(c.setTheme("dark")).toEqual({ kind: "SetDocumentStyle", theme: "dark" });
    expect(c.setNodeShape("a", "ellipse")).toEqual({ kind: "SetNodeShape", id: "a", shape: "ellipse" });
    expect(c.setNodeShape("a", null)).toEqual({ kind: "SetNodeShape", id: "a", shape: null });
  });
});
