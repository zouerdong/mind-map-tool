// TauriFileAdapter / TauriPreferencesAdapter 测试（MM-060 步骤①⑧）：
// 用 fake invoke 验证命令名、载荷编码（JSON 字符串/base64）与稳定错误映射。
// Rust 侧语义（ledger/TOCTOU/原子提交）由 cargo test 覆盖。

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const { TauriFileAdapter } = await import("../src/file/tauri-file-adapter.js");
const { TauriPreferencesAdapter } = await import("../src/preferences/tauri-adapter.js");
const { PlatformError } = await import("../src/file/errors.js");

const bytesOf = (s: string) => new TextEncoder().encode(s);
const b64 = (bytes: Uint8Array) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

beforeEach(() => invokeMock.mockReset());

describe("TauriFileAdapter", () => {
  // MRT-004 Wave 2：renderer 直连打开（对话框/按路径）已退役——打开一律
  // 经 host launch intent（platform_request_open_intent）与按窗分配的
  // platform_open_assigned_document(deliveryId)。保留 FilePort 契约方法，
  // 生产调用必须稳定报错（不静默失败、不发 IPC）。
  it("openDocument：已退役——稳定报错且不触发 IPC", async () => {
    const port = new TauriFileAdapter();
    await expect(port.openDocument()).rejects.toThrow(/已退役/);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("openPath：已退役——稳定报错且不触发 IPC", async () => {
    const port = new TauriFileAdapter();
    await expect(port.openPath("/tmp/launch.mm")).rejects.toThrow(/已退役/);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("requestTargetAuthorization：kind 与 suggestedName 透传，ref 标记 opaque", async () => {
    invokeMock.mockResolvedValueOnce({ authorizationRef: "auth-1", displayPath: "/tmp/x.mm" });
    const port = new TauriFileAdapter();
    const granted = await port.requestTargetAuthorization("document", "未命名.mm");
    expect(invokeMock).toHaveBeenCalledWith("platform_request_target_authorization", {
      kind: "document",
      suggestedName: "未命名.mm",
    });
    expect(granted!.authorizationRef).toBe("auth-1");
  });

  it("commitDocument ordinary：bytes 转 JSON 字符串，携带 handle+token，不弹对话框语义由 host 保证", async () => {
    invokeMock.mockResolvedValueOnce({
      documentTargetHandle: "h-1",
      versionToken: "tok-2",
      displayPath: "/tmp/a.mm",
    });
    const port = new TauriFileAdapter();
    await port.commitDocument({
      kind: "ordinary",
      documentTargetHandle: "h-1" as never,
      expectedVersionToken: "tok-1" as never,
      contentBytes: bytesOf("{}"),
    });
    expect(invokeMock).toHaveBeenCalledWith("platform_commit_document", {
      payload: {
        kind: "ordinary",
        documentTargetHandle: "h-1",
        expectedVersionToken: "tok-1",
        contentJson: "{}",
      },
    });
  });

  it("commitDocument save-as：携带一次性授权引用", async () => {
    invokeMock.mockResolvedValueOnce({
      documentTargetHandle: "h-2",
      versionToken: "t",
      displayPath: "/p",
    });
    const port = new TauriFileAdapter();
    await port.commitDocument({
      kind: "save-as",
      authorizationRef: "auth-1" as never,
      contentBytes: bytesOf("x"),
    });
    expect(invokeMock).toHaveBeenCalledWith("platform_commit_document", {
      payload: { kind: "save-as", authorizationRef: "auth-1", contentJson: "x" },
    });
  });

  it("commitExport：二进制走 base64（含非 ASCII 字节）", async () => {
    invokeMock.mockResolvedValueOnce({ displayPath: "/p.png" });
    const port = new TauriFileAdapter();
    const payload = new Uint8Array([0, 255, 128, 7, 200]);
    await port.commitExport("auth-e" as never, payload);
    expect(invokeMock).toHaveBeenCalledWith("platform_commit_export", {
      authorizationRef: "auth-e",
      bytesBase64: b64(payload),
    });
  });

  it("host 拒绝映射为稳定错误码（任务卡点名的四个 authorization 码逐一验证）", async () => {
    const port = new TauriFileAdapter();
    for (const code of [
      "INVALID_TARGET_AUTHORIZATION",
      "TARGET_AUTHORIZATION_EXPIRED",
      "TARGET_AUTHORIZATION_CONSUMED",
      "TARGET_AUTHORIZATION_KIND_MISMATCH",
      "INVALID_DOCUMENT_TARGET_HANDLE",
      "TARGET_MODIFIED_EXTERNALLY",
      "TARGET_APPEARED",
    ]) {
      invokeMock.mockRejectedValueOnce({ code, message: "host rejected" });
      const err = await port.commitExport("auth" as never, new Uint8Array()).catch((e) => e);
      expect(err).toBeInstanceOf(PlatformError);
      expect(err.code).toBe(code);
    }
  });

  it("未知错误形状 fail-closed 归入 FILE_IO_ERROR，不吞信息", async () => {
    invokeMock.mockRejectedValueOnce("disk full");
    const port = new TauriFileAdapter();
    const err = await port.commitExport("auth" as never, new Uint8Array()).catch((e) => e);
    expect(err.code).toBe("FILE_IO_ERROR");
    expect(err.message).toContain("disk full");
  });
});

describe("TauriPreferencesAdapter", () => {
  it("load 返回快照；store 以 delta 合并调用", async () => {
    invokeMock.mockResolvedValueOnce({ theme: "dark" });
    const prefs = new TauriPreferencesAdapter();
    expect(await prefs.load()).toEqual({ theme: "dark" });
    await prefs.store({ onboardingDone: true });
    expect(invokeMock).toHaveBeenCalledWith("platform_store_preferences", {
      delta: { onboardingDone: true },
    });
  });

  it("偏好 IO 失败映射 PREFERENCES_IO_ERROR", async () => {
    invokeMock.mockRejectedValueOnce({ code: "PREFERENCES_IO_ERROR", message: "locked" });
    const prefs = new TauriPreferencesAdapter();
    const err = await prefs.load().catch((e) => e);
    expect(err.code).toBe("PREFERENCES_IO_ERROR");
  });

  it("偏好 JSON 损坏时回退为空快照并提供一次性恢复提示", async () => {
    invokeMock.mockRejectedValueOnce({ code: "PREFERENCES_CORRUPT", message: "invalid json" });
    const prefs = new TauriPreferencesAdapter();

    await expect(prefs.load()).resolves.toEqual({});
    expect(prefs.consumeWarning?.()).toContain("偏好文件损坏");
    expect(prefs.consumeWarning?.()).toBeNull();
  });
});
