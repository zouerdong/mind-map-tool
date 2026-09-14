// DFR-090 F2：正文编辑的 runs 区间映射（既有 TextRun [start,end) 区间模型）。
// 红线：整节点样式（粗体/字号/下划线）必须随正文续写保留；混合 runs 按
// 文本变更边界映射，不得原样套旧索引。

import { describe, expect, it } from "vitest";
import type { TextRun } from "@mindmap/core";
import { remapRunsForTextChange, uniformRunsStyle } from "../src/controller/runs-remap.js";

describe("remapRunsForTextChange", () => {
  it("无 runs / 空 runs → undefined（core 语义：无样式）", () => {
    expect(remapRunsForTextChange("abc", undefined, "abcd")).toBeUndefined();
    expect(remapRunsForTextChange("abc", [], "abcd")).toBeUndefined();
  });

  it("整节点统一 runs：中段插入/追加/删除/全量替换均保留全域样式", () => {
    const bold: TextRun[] = [{ start: 0, end: 4, bold: true }];
    // 中段插入
    expect(remapRunsForTextChange("创意起源", bold, "创意新起源")).toEqual([
      { start: 0, end: 5, bold: true },
    ]);
    // 追加
    expect(remapRunsForTextChange("创意起源", bold, "创意起源修订")).toEqual([
      { start: 0, end: 6, bold: true },
    ]);
    // 删除
    expect(remapRunsForTextChange("创意起源", bold, "创意")).toEqual([
      { start: 0, end: 2, bold: true },
    ]);
    // 全量替换（重新打字）：整节点样式语义覆盖新文本
    expect(remapRunsForTextChange("创意起源", bold, "完全不同")).toEqual([
      { start: 0, end: 4, bold: true },
    ]);
  });

  it("整节点统一样式携带字号与下划线组合", () => {
    const runs: TextRun[] = [{ start: 0, end: 3, bold: true, fontSize: 20, underline: true }];
    expect(remapRunsForTextChange("节点甲", runs, "节点甲乙")).toEqual([
      { start: 0, end: 4, bold: true, fontSize: 20, underline: true },
    ]);
  });

  it("多段同属性 runs 覆盖全域视为整节点样式（stepFontSize 产物）", () => {
    const runs: TextRun[] = [
      { start: 0, end: 2, fontSize: 18 },
      { start: 2, end: 4, fontSize: 18 },
    ];
    expect(remapRunsForTextChange("创意起源", runs, "创意起源续")).toEqual([
      { start: 0, end: 5, fontSize: 18 },
    ]);
  });

  it("混合 runs：插入点在 run 之前 → 整体平移", () => {
    const runs: TextRun[] = [{ start: 2, end: 4, bold: true }];
    expect(remapRunsForTextChange("创意起源", runs, "新创意起源")).toEqual([
      { start: 3, end: 5, bold: true },
    ]);
  });

  it("混合 runs：插入点在 run 内部 → run 扩展覆盖插入文本（编辑器惯例）", () => {
    const runs: TextRun[] = [{ start: 1, end: 3, bold: true }];
    // "创意起源" 在「意」「起」之间插入「新」
    expect(remapRunsForTextChange("创意起源", runs, "创意新起源")).toEqual([
      { start: 1, end: 4, bold: true },
    ]);
  });

  it("混合 runs：删除 run 内字符 → run 收缩", () => {
    const runs: TextRun[] = [{ start: 1, end: 3, bold: true }];
    // 删除「意」："创起源"
    expect(remapRunsForTextChange("创意起源", runs, "创起源")).toEqual([
      { start: 1, end: 2, bold: true },
    ]);
  });

  it("混合 runs：run 完全落在被替换区间 → 丢弃", () => {
    const runs: TextRun[] = [{ start: 1, end: 2, bold: true }];
    // 「意起」替换为「新」："创新源"
    expect(remapRunsForTextChange("创意起源", runs, "创新源")).toBeUndefined();
  });

  it("混合 runs：多段各自映射且保持有序不重叠", () => {
    const runs: TextRun[] = [
      { start: 0, end: 2, bold: true },
      { start: 2, end: 4, fontSize: 20 },
    ];
    // 首部插入一字：两段都平移
    expect(remapRunsForTextChange("创意起源", runs, "新创意起源")).toEqual([
      { start: 1, end: 3, bold: true },
      { start: 3, end: 5, fontSize: 20 },
    ]);
  });

  it("新文本为空 → undefined（空文本不得携带 runs）", () => {
    const runs: TextRun[] = [{ start: 0, end: 4, bold: true }];
    expect(remapRunsForTextChange("创意起源", runs, "")).toBeUndefined();
  });
});

describe("uniformRunsStyle", () => {
  it("整节点统一 runs → 编辑态渲染样式", () => {
    expect(
      uniformRunsStyle([{ start: 0, end: 4, bold: true, fontSize: 20 }], 4),
    ).toEqual({ bold: true, fontSize: 20 });
  });

  it("混合/部分覆盖 runs → null（编辑态退回纯文本渲染）", () => {
    expect(uniformRunsStyle([{ start: 1, end: 3, bold: true }], 4)).toBeNull();
    expect(uniformRunsStyle(undefined, 4)).toBeNull();
    expect(uniformRunsStyle([], 4)).toBeNull();
  });

  it("空文本 → null", () => {
    expect(uniformRunsStyle([{ start: 0, end: 4, bold: true }], 0)).toBeNull();
  });
});
