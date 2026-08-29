// @vitest-environment jsdom
// MM-088 集成测试（AC-16 应用层）：热键设置流——读取当前值、修改成功、
// 冲突稳定提示不崩溃、取消不动状态。

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

vi.mock("@xyflow/react", () => import("./rf-stub.js").then((m) => m.rfStubModule()));

const { MindMapApp } = await import("./mindmap-app.js");
const { FakeFilePort, FakePreferencesPort, FakeExportRenderer } = await import("./fake-ports.js");
const { FakeGlobalShortcut } = await import("./ports.js");

import { vi } from "vitest";

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

function setup(conflictWith: string | null = null) {
  const shortcut = new FakeGlobalShortcut();
  shortcut.conflictWith = conflictWith;
  const renderer = new FakeExportRenderer();
  render(
    <MindMapApp
      ports={{
        filePort: new FakeFilePort(),
        preferences: new FakePreferencesPort(),
        renderer,
        fonts: renderer.fonts(),
        isBrowserDev: true,
        globalShortcut: shortcut,
      }}
    />,
  );
  return { shortcut };
}

describe("全局热键设置（AC-16 应用层）", () => {
  it("打开设置显示当前热键；修改成功后提示并关闭", async () => {
    const { shortcut } = setup();
    fireEvent.click(screen.getByRole("button", { name: /热键…/ }));
    const input = await screen.findByTestId("shortcut-input") as HTMLInputElement;
    expect(input.value).toBe("Alt+Space"); // 定稿默认（键位专项讨论 2026-08-29）

    fireEvent.change(input, { target: { value: "CmdOrCtrl+Shift+M" } });
    fireEvent.click(screen.getByTestId("shortcut-apply"));
    await waitFor(() =>
      expect(screen.getByText(/全局唤起热键已设为 CmdOrCtrl\+Shift\+M/)).toBeTruthy(),
    );
    expect(screen.queryByTestId("shortcut-panel")).toBeNull();
    expect(shortcut.accelerator).toBe("CmdOrCtrl+Shift+M");
  });

  it("冲突：稳定错误提示，面板保留可重试，应用不崩", async () => {
    setup("CmdOrCtrl+Shift+B");
    fireEvent.click(screen.getByRole("button", { name: /热键…/ }));
    const input = (await screen.findByTestId("shortcut-input")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "CmdOrCtrl+Shift+B" } });
    fireEvent.click(screen.getByTestId("shortcut-apply"));
    await waitFor(() =>
      expect(screen.getByTestId("shortcut-error").textContent).toContain("注册失败"),
    );
    // 面板仍在（可改可取消）；画布可用
    expect(screen.getByTestId("shortcut-panel")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByTestId("shortcut-panel")).toBeNull();
    expect(screen.getByRole("application", { name: "脑图画布" })).toBeTruthy();
  });
});
