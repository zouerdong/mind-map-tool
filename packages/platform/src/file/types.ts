// 文件能力 port（MM-060 步骤①④）：UI/应用层消费的平台无关接口。
// 语义（与 ADR 0003 §4-5 对齐）：
// - DocumentTargetHandle / VersionToken / TargetAuthorizationRef 对 UI 完全
//   opaque，只存放/回传；canonical path、kind、expiry、consumed 全部留在 host ledger；
// - ordinary Save 只用 handle + expectedVersionToken，绝不重开对话框；
// - Save As / Export 先请求一次性 TargetAuthorization（kind 区分 document/export）；
// - 任一拒绝（伪造/过期/已消耗/错 kind/跨窗口/TOCTOU）都不写目标、不更新保存身份。

import type {
  CommitReceipt,
  ExportCommitResult,
  GrantedTargetAuthorization,
  UnifiedSaveGrant,
  TargetKind,
} from "../ipc/types.js";

declare const brand: unique symbol;

/** host 签发的活文档目标句柄（绑定 window/session；opaque）。 */
export type DocumentTargetHandle = string & { readonly [brand]: "DocumentTargetHandle" };

/** 目标文件当前内容的 SHA-256（opaque 字符串；由 host 计算与复核）。 */
export type VersionToken = string & { readonly [brand]: "VersionToken" };

/** 一次性选址授权引用（host ledger 持有细节；consume 后失效）。 */
export type TargetAuthorizationRef = string & { readonly [brand]: "TargetAuthorizationRef" };

/** openDocument 的领域级返回（IPC 层 contentJson 已还原为字节）。 */
export interface OpenedDocument {
  /** canonical JSON 字节；由调用方交给 core decode，host 不解析内容。 */
  contentBytes: Uint8Array;
  documentTargetHandle: DocumentTargetHandle;
  versionToken: VersionToken;
  displayPath: string;
}

/** ordinary 提交：opaque handle + 期望 token（host 复核后原子写，不重开对话框）。 */
export interface CommitDocumentOrdinaryRequest {
  kind: "ordinary";
  documentTargetHandle: DocumentTargetHandle;
  expectedVersionToken: VersionToken;
  contentBytes: Uint8Array;
}

/** Save As 提交：一次性授权引用（授权细节全部在 host ledger）。 */
export interface CommitDocumentSaveAsRequest {
  kind: "save-as";
  authorizationRef: TargetAuthorizationRef;
  contentBytes: Uint8Array;
}

export type CommitDocumentRequest = CommitDocumentOrdinaryRequest | CommitDocumentSaveAsRequest;

export interface FilePort {
  /**
   * 打开现有文档：弹出原生 open 对话框 → 读字节 → host 签发
   * handle + versionToken（绑定当前 window）。
   * 用户取消返回 null（不是错误）；读失败/校验失败 reject PlatformError。
   */
  openDocument(): Promise<OpenedDocument | null>;

  /**
   * 按路径打开（launch intent / argv 文件加载；无对话框）。
   * 路径不可读 reject PlatformError（调用方决定提示）。
   */
  openPath(path: string): Promise<OpenedDocument>;

  /**
   * 请求一次性目标授权（Save As：kind="document"；导出：kind="export"）。
   * host 在授权时刻记录 canonical path、目标存在性与当时的 SHA-256，
   * 并在 commit 时复核（TOCTOU）。取消返回 null。
   */
  requestTargetAuthorization(
    kind: TargetKind,
    suggestedName: string,
  ): Promise<(GrantedTargetAuthorization & { authorizationRef: TargetAuthorizationRef }) | null>;

  /**
   * 提交文档（ordinary / save-as）。成功返回 receipt（handle 可轮换）；
   * 失败 reject PlatformError，调用方必须保持 session 的
   * saved identity / handle / token / displayPath 不变。
   */
  commitDocument(request: CommitDocumentRequest): Promise<CommitReceipt>;

  /**
   * 「存储为…」统一面板（OFR-2026-09-15 出口合并，PRD §8.2）：
   * 另存为与导出同一入口。按所选格式返回 Document 或 Export 一次性授权；
   * 选导出格式且 documentSaved=false 时附带同名 .mindmap 兜底授权。
   * 取消返回 null。
   */
  requestUnifiedSaveAuthorization(
    suggestedName: string,
    documentSaved: boolean,
  ): Promise<(UnifiedSaveGrant & { authorizationRef: TargetAuthorizationRef }) | null>;

  /** 提交导出产物（authorization kind 必须为 "export"）。 */
  commitExport(
    authorizationRef: TargetAuthorizationRef,
    bytes: Uint8Array,
  ): Promise<ExportCommitResult>;
}

/**
 * 供 core DocumentSession 使用的类型转换：session 中 handle/token 以
 * string 存放（core 不解析），platform 层仅在提交时恢复 opaque 标记。
 */
export function asDocumentTargetHandle(value: string): DocumentTargetHandle {
  return value as DocumentTargetHandle;
}

export function asVersionToken(value: string): VersionToken {
  return value as VersionToken;
}

export function asTargetAuthorizationRef(value: string): TargetAuthorizationRef {
  return value as TargetAuthorizationRef;
}
