// ADR 0019 v1.1.0 ③：整理方向应用级偏好——默认发散、读取解析、持久化往返。

import { describe, expect, it } from "vitest";
import { InMemoryPreferenceStore } from "@mindmap/ui";
import {
  DEFAULT_ORGANIZE_DIRECTION,
  LAYOUT_DIRECTION_KEY,
  loadLayoutDirection,
  parseLayoutDirection,
  storeLayoutDirection,
} from "./layout-direction-preferences.js";

describe("layout-direction-preferences（ADR 0019 v1.1.0）", () => {
  it("默认方向为发散", () => {
    expect(DEFAULT_ORGANIZE_DIRECTION).toBe("balanced");
  });

  it("无记录/非法值 → null（回退默认）", async () => {
    expect(await loadLayoutDirection(new InMemoryPreferenceStore())).toBeNull();
    expect(
      await loadLayoutDirection(new InMemoryPreferenceStore({ [LAYOUT_DIRECTION_KEY]: "weird" })),
    ).toBeNull();
    expect(parseLayoutDirection(42)).toBeNull();
    expect(parseLayoutDirection(null)).toBeNull();
  });

  it("三个合法方向解析与持久化往返", async () => {
    const store = new InMemoryPreferenceStore();
    for (const direction of ["horizontal", "vertical", "balanced"] as const) {
      await storeLayoutDirection(store, direction);
      expect(await loadLayoutDirection(store)).toBe(direction);
    }
    // 持久化键固定（菜单/文档同步的单一事实源）
    expect(store.snapshot()[LAYOUT_DIRECTION_KEY]).toBe("balanced");
  });
});
