// PlatformError：稳定错误码 + 人类可读信息。
// code 是对外契约（见 ipc/types.ts PLATFORM_ERROR_CODES）；
// message 仅用于日志/调试，不得作为判定依据。

import type { PlatformErrorCode, PlatformIpcError } from "../ipc/types.js";

export class PlatformError extends Error {
  readonly code: PlatformErrorCode;

  constructor(code: PlatformErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "PlatformError";
    this.code = code;
  }
}

/** 解析 Rust 命令层 reject 的错误（字符串或结构化对象）为 PlatformError。 */
export function toPlatformError(raw: unknown): PlatformError {
  if (typeof raw === "object" && raw !== null && "code" in raw) {
    const e = raw as PlatformIpcError;
    return new PlatformError(e.code, e.message ?? "host error");
  }
  // 未知形状：归入 IO 错误（fail-closed），不吞掉信息。
  return new PlatformError("FILE_IO_ERROR", String(raw));
}
