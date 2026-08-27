// FilePort 的 Tauri 2 实现（MM-060 步骤①④）。
// 仅做：字节↔JSON 字符串转换、invoke 调用、错误映射；
// 全部授权/handle/token 语义在 Rust host（见 src-tauri/src/file/）。

import { invoke } from "@tauri-apps/api/core";
import {
  IPC_COMMANDS,
  type CommitDocumentPayload,
  type CommitReceipt,
  type ExportCommitResult,
  type GrantedTargetAuthorization,
  type OpenedDocumentIpc,
} from "../ipc/types.js";
import { toPlatformError } from "./errors.js";
import {
  asDocumentTargetHandle,
  asVersionToken,
  type CommitDocumentRequest,
  type FilePort,
  type OpenedDocument,
  type TargetAuthorizationRef,
} from "./types.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true }); // canonical JSON 必须是合法 UTF-8

export class TauriFileAdapter implements FilePort {
  async openDocument(): Promise<OpenedDocument | null> {
    const raw = await this.call<OpenedDocumentIpc | null>(IPC_COMMANDS.openDocument, null);
    if (raw === null) return null; // 用户取消
    return {
      contentBytes: toBytes(raw.contentJson),
      documentTargetHandle: asDocumentTargetHandle(raw.documentTargetHandle),
      versionToken: asVersionToken(raw.versionToken),
      displayPath: raw.displayPath,
    };
  }

  async openPath(path: string): Promise<OpenedDocument> {
    const raw = await this.call<OpenedDocumentIpc>(IPC_COMMANDS.openPath, { path });
    return {
      contentBytes: toBytes(raw.contentJson),
      documentTargetHandle: asDocumentTargetHandle(raw.documentTargetHandle),
      versionToken: asVersionToken(raw.versionToken),
      displayPath: raw.displayPath,
    };
  }

  async requestTargetAuthorization(
    kind: "document" | "export",
    suggestedName: string,
  ): Promise<(GrantedTargetAuthorization & { authorizationRef: TargetAuthorizationRef }) | null> {
    const raw = await this.call<GrantedTargetAuthorization | null>(
      IPC_COMMANDS.requestTargetAuthorization,
      { kind, suggestedName },
    );
    if (raw === null) return null;
    return { ...raw, authorizationRef: raw.authorizationRef as TargetAuthorizationRef };
  }

  async commitDocument(request: CommitDocumentRequest): Promise<CommitReceipt> {
    const ipcPayload: CommitDocumentPayload =
      request.kind === "ordinary"
        ? {
            kind: "ordinary",
            documentTargetHandle: request.documentTargetHandle as string,
            expectedVersionToken: request.expectedVersionToken as string,
            contentJson: fromBytes(request.contentBytes),
          }
        : {
            kind: "save-as",
            authorizationRef: request.authorizationRef as string,
            contentJson: fromBytes(request.contentBytes),
          };
    return this.call<CommitReceipt>(IPC_COMMANDS.commitDocument, { payload: ipcPayload });
  }

  async commitExport(
    authorizationRef: TargetAuthorizationRef,
    bytes: Uint8Array,
  ): Promise<ExportCommitResult> {
    // 二进制（PNG/PDF）走 base64；SVG 亦是字节精确传输，不做特殊化。
    const bytesBase64 = encodeBase64(bytes);
    return this.call<ExportCommitResult>(IPC_COMMANDS.commitExport, {
      authorizationRef,
      bytesBase64,
    });
  }

  private async call<T>(command: string, args: Record<string, unknown> | null): Promise<T> {
    try {
      return (await invoke<T>(command, args ?? undefined)) as T;
    } catch (raw) {
      throw toPlatformError(raw);
    }
  }
}

// ---- 编码工具（避免依赖 Node Buffer；Web 环境可用） ----

function toBytes(json: string): Uint8Array {
  return encoder.encode(json);
}

function fromBytes(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000; // 避免超长 apply 栈限制
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
