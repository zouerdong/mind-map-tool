// Onboarding 状态机与偏好 port 测试（MM-070 ②；AC-09）：
// 可完成/跳过/重放；跳过与完成后不再强制弹出；步骤推进只认真实命令；
// 状态只写本机偏好（不进文档——由 core schema 不含字段保证，这里断言 port 键集）。

import { describe, expect, it } from "vitest";
import type { Command, MindMapDocumentV1 } from "@mindmap/core";
import {
  INITIAL_ONBOARDING_STATE,
  ONBOARDING_STEPS,
  ONBOARDING_STATUS_KEY,
  createOnboardingPreferences,
  InMemoryPreferenceStore,
  onboardingReducer,
} from "../src/index.js";

const doc = (): MindMapDocumentV1 => ({
  schemaVersion: 1,
  document: {
    theme: "light",
    font: "noto-sans-sc",
    shape: "card",
    framesVisible: true,
    nodes: [],
    edges: [],
  },
});

const cmd = (c: Command) => ({ kind: "command", command: c }) as const;
const CREATE = cmd({
  kind: "CreateNode",
  id: "n1",
  text: "",
  position: { x: 0, y: 0 },
  size: { width: 10, height: 10 },
});
const EDIT = cmd({ kind: "EditNodeText", id: "n1", text: "一", size: { width: 20, height: 10 } });
const MOVE = cmd({ kind: "MoveNodes", moves: [{ id: "n1", position: { x: 1, y: 1 } }] });
const EDGE = cmd({ kind: "CreateEdge", id: "e1", sourceNodeId: "n1", targetNodeId: "n2" });
const THEME = cmd({ kind: "SetDocumentStyle", theme: "dark" });

const started = () => onboardingReducer(INITIAL_ONBOARDING_STATE, { type: "start" });

describe("首次出示与开始/跳过", () => {
  it("restore not-started：自动出示 welcome 卡", () => {
    const s = onboardingReducer(INITIAL_ONBOARDING_STATE, {
      type: "restore",
      status: "not-started",
    });
    expect(s.visible).toBe(true);
    expect(s.currentStep).toBe("welcome");
  });

  it("restore completed/skipped：不再强制弹出（AC-09）", () => {
    for (const status of ["completed", "skipped"] as const) {
      const s = onboardingReducer(INITIAL_ONBOARDING_STATE, { type: "restore", status });
      expect(s.visible).toBe(false);
      expect(s.currentStep).toBeNull();
    }
  });

  it("start 进入第一步；skip 后 status=skipped 且隐藏", () => {
    const s = started();
    expect(s.status).toBe("in-progress");
    expect(s.currentStep).toBe("create-first");
    const skipped = onboardingReducer(s, { type: "skip" });
    expect(skipped.status).toBe("skipped");
    expect(skipped.visible).toBe(false);
  });

  it("hide 只是暂时隐藏：status 不变、可 show 恢复（关闭≠跳过）", () => {
    const s = started();
    const hidden = onboardingReducer(s, { type: "hide" });
    expect(hidden.status).toBe("in-progress");
    expect(hidden.visible).toBe(false);
    expect(onboardingReducer(hidden, { type: "show" }).visible).toBe(true);
  });
});

describe("步骤推进（只认真实命令/动作）", () => {
  it("第 1 步需要 CreateNode + EditNodeText（全部）", () => {
    let s = started();
    s = onboardingReducer(s, { type: "observe", observation: CREATE });
    expect(s.currentStep).toBe("create-first"); // 未齐不推进
    s = onboardingReducer(s, { type: "observe", observation: EDIT });
    expect(s.completedSteps).toContain("create-first");
    expect(s.currentStep).toBe("second-connect");
  });

  it("与当前步骤无关的命令不推进（如 welcome 后直接 SetDocumentStyle）", () => {
    const s = started();
    const after = onboardingReducer(s, { type: "observe", observation: THEME });
    expect(after.currentStep).toBe("create-first");
  });

  it("第 2 步：CreateNode/MoveNodes/CreateEdge 全部", () => {
    let s = started();
    for (const o of [CREATE, EDIT]) s = onboardingReducer(s, { type: "observe", observation: o });
    for (const o of [CREATE, MOVE, EDGE])
      s = onboardingReducer(s, { type: "observe", observation: o });
    expect(s.currentStep).toBe("undo-or-theme");
  });

  it("第 3 步任一即可（undo / redo / SetDocumentStyle）", () => {
    let s = started();
    for (const o of [CREATE, EDIT, CREATE, MOVE, EDGE])
      s = onboardingReducer(s, { type: "observe", observation: o });
    s = onboardingReducer(s, { type: "observe", observation: { kind: "history", action: "undo" } });
    expect(s.currentStep).toBe("save-or-export");
  });

  it("第 4 步：保存或导出（外部动作）任一 → completed", () => {
    let s = started();
    for (const o of [CREATE, EDIT, CREATE, MOVE, EDGE, THEME])
      s = onboardingReducer(s, { type: "observe", observation: o });
    s = onboardingReducer(s, {
      type: "observe",
      observation: { kind: "external", action: "save" },
    });
    expect(s.status).toBe("completed");
    expect(s.visible).toBe(false);
  });

  it("重放：从第一步重来（completedSteps 清空），可再次走完", () => {
    let s = started();
    for (const o of [CREATE, EDIT, CREATE, MOVE, EDGE, THEME])
      s = onboardingReducer(s, { type: "observe", observation: o });
    const replaying = onboardingReducer(s, { type: "replay" });
    expect(replaying.status).toBe("in-progress");
    expect(replaying.completedSteps).toHaveLength(0);
    expect(replaying.currentStep).toBe("create-first");
  });

  it("restore in-progress：从首个未完成步骤继续", () => {
    const s = onboardingReducer(INITIAL_ONBOARDING_STATE, {
      type: "restore",
      status: "in-progress",
    });
    expect(s.currentStep).toBe("create-first");
    expect(s.visible).toBe(true);
  });
});

describe("偏好 port（只写本机，键集受控）", () => {
  it("load 恢复合法状态；未知/缺失 → not-started", async () => {
    const store = new InMemoryPreferenceStore({ [ONBOARDING_STATUS_KEY]: "skipped" });
    const prefs = createOnboardingPreferences(store);
    expect(await prefs.load()).toBe("skipped");

    const empty = createOnboardingPreferences(new InMemoryPreferenceStore());
    expect(await empty.load()).toBe("not-started");

    const garbage = createOnboardingPreferences(
      new InMemoryPreferenceStore({ [ONBOARDING_STATUS_KEY]: "hax" }),
    );
    expect(await garbage.load()).toBe("not-started");
  });

  it("store 写 onboardingStatus；not-started 不写", async () => {
    const store = new InMemoryPreferenceStore();
    const prefs = createOnboardingPreferences(store);
    await prefs.store("completed");
    expect(store.snapshot()).toEqual({ onboardingStatus: "completed" });
    await prefs.store("not-started");
    expect(store.snapshot()).toEqual({ onboardingStatus: "completed" }); // 未被清掉
  });

  it("文档序列化不含 onboarding 字段（AC-06/09：schema 无此字段）", () => {
    const serialized = JSON.stringify(doc());
    expect(serialized).not.toContain("onboarding");
  });

  it("步骤锚点与文案一一对应（漂移守卫）", () => {
    expect(ONBOARDING_STEPS.length).toBe(5);
    expect(ONBOARDING_STEPS.map((s) => s.id)).toEqual([
      "welcome",
      "create-first",
      "second-connect",
      "undo-or-theme",
      "save-or-export",
    ]);
  });
});
