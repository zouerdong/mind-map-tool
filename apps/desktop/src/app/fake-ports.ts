// Fake 平台端口（MM-080 ⑧）：浏览器 dev 与集成测试共用。
// 复刻 host 核心拒绝语义（MM-060 契约）：ordinary 的 token 复核、
// authorization 的 kind/expiry/consumed/TOCTOU、对话框调用计数
// （集成测试断言"不重弹选址对话框"的依据）。

import type {
  CloseDisposition,
  CloseLifecyclePort,
  CloseRequestPayload,
  CommitDocumentRequest,
  CommitReceipt,
  FilePort,
  OpenedDocument,
  TargetAuthorizationRef,
} from "@mindmap/platform";
import { PlatformError } from "@mindmap/platform";
import type { PreferencesPort, PreferencesSnapshot } from "@mindmap/platform";
import type { LaunchRetryableError, PendingRecovery } from "@mindmap/platform";
import type { FontResolver } from "@mindmap/export/src/layout.js";
import type { LaunchPort, FontMetricsState } from "./ports.js";

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface FakeAuthorization {
  kind: "document" | "export";
  path: string;
  existed: boolean;
  hashAtGrant: string | null;
  consumed: boolean;
  grantedAt: number;
}

export class FakeFilePort implements FilePort {
  /** 内存文件系统（外部修改 = 直接改这里）。 */
  readonly files = new Map<string, Uint8Array>();
  /** open 对话框返回值（null=取消）。 */
  nextOpenDialog: string | null = null;
  /** save 对话框返回值（null=取消）。 */
  nextSaveDialog: string | null = null;
  openDialogCalls = 0;
  saveDialogCalls = 0;
  private readonly handles = new Map<string, { path: string }>();
  private readonly auths = new Map<string, FakeAuthorization>();
  private seq = 0;

  /** 写入文件（测试布置 + 外部修改模拟）。 */
  writeFile(path: string, bytes: Uint8Array): void {
    this.files.set(path, bytes);
  }

  async openDocument(): Promise<OpenedDocument | null> {
    this.openDialogCalls += 1;
    const path = this.nextOpenDialog;
    if (path === null) return null;
    return this.openPath(path);
  }

  async openPath(path: string): Promise<OpenedDocument> {
    const bytes = this.files.get(path);
    if (bytes === undefined) throw new PlatformError("FILE_IO_ERROR", `文件不存在：${path}`);
    const handle = `fake-doc-${++this.seq}`;
    this.handles.set(handle, { path });
    return {
      contentBytes: bytes,
      documentTargetHandle: handle as OpenedDocument["documentTargetHandle"],
      versionToken: (await sha256Hex(bytes)) as OpenedDocument["versionToken"],
      displayPath: path,
    };
  }

  async requestTargetAuthorization(
    kind: "document" | "export",
    suggestedName: string,
  ): Promise<{ authorizationRef: TargetAuthorizationRef; displayPath: string } | null> {
    this.saveDialogCalls += 1;
    void suggestedName;
    const path = this.nextSaveDialog;
    if (path === null) return null;
    const bytes = this.files.get(path);
    const ref = `fake-auth-${++this.seq}`;
    this.auths.set(ref, {
      kind,
      path,
      existed: bytes !== undefined,
      hashAtGrant: bytes ? await sha256Hex(bytes) : null,
      consumed: false,
      grantedAt: Date.now(),
    });
    return { authorizationRef: ref as TargetAuthorizationRef, displayPath: path };
  }

  async commitDocument(request: CommitDocumentRequest): Promise<CommitReceipt> {
    if (request.kind === "ordinary") {
      const rec = this.handles.get(request.documentTargetHandle as string);
      if (!rec) throw new PlatformError("INVALID_DOCUMENT_TARGET_HANDLE", "句柄不存在");
      const current = this.files.get(rec.path);
      const currentHash = current ? await sha256Hex(current) : null;
      if (currentHash !== request.expectedVersionToken)
        throw new PlatformError("TARGET_MODIFIED_EXTERNALLY", "外部修改或删除");
      return this.writeAndReceipt(
        rec.path,
        request.contentBytes,
        request.documentTargetHandle as string,
      );
    }
    const auth = this.redeem(request.authorizationRef as string, "document");
    await this.verifyTargetUnchanged(auth);
    const handle = `fake-doc-${++this.seq}`;
    this.handles.set(handle, { path: auth.path });
    return this.writeAndReceipt(auth.path, request.contentBytes, handle);
  }

  async commitExport(
    authorizationRef: TargetAuthorizationRef,
    bytes: Uint8Array,
  ): Promise<{ displayPath: string }> {
    const auth = this.redeem(authorizationRef as string, "export");
    await this.verifyTargetUnchanged(auth);
    this.files.set(auth.path, bytes);
    return { displayPath: auth.path };
  }

  /** 撤销全部句柄（模拟窗口关闭）。 */
  revokeAll(): void {
    this.handles.clear();
    this.auths.clear();
  }

  private redeem(ref: string, kind: "document" | "export"): FakeAuthorization {
    const auth = this.auths.get(ref);
    if (!auth) throw new PlatformError("INVALID_TARGET_AUTHORIZATION", "授权不存在");
    if (auth.kind !== kind)
      throw new PlatformError("TARGET_AUTHORIZATION_KIND_MISMATCH", "授权种类不匹配");
    if (Date.now() > auth.grantedAt + 10 * 60 * 1000)
      throw new PlatformError("TARGET_AUTHORIZATION_EXPIRED", "授权过期");
    if (auth.consumed) throw new PlatformError("TARGET_AUTHORIZATION_CONSUMED", "授权已消耗");
    auth.consumed = true;
    return auth;
  }

  private async verifyTargetUnchanged(auth: FakeAuthorization): Promise<void> {
    const bytes = this.files.get(auth.path);
    if (!auth.existed && bytes !== undefined)
      throw new PlatformError("TARGET_APPEARED", "目标突然出现");
    if (auth.existed) {
      const hash = bytes ? await sha256Hex(bytes) : null;
      if (hash !== auth.hashAtGrant)
        throw new PlatformError("TARGET_MODIFIED_EXTERNALLY", "外部修改或删除");
    }
  }

  private async writeAndReceipt(
    path: string,
    bytes: Uint8Array,
    handle: string,
  ): Promise<CommitReceipt> {
    this.files.set(path, bytes);
    return {
      documentTargetHandle: handle,
      versionToken: (await sha256Hex(bytes)) as CommitReceipt["versionToken"],
      displayPath: path,
      rebindState: "finalized",
    };
  }
}

export class FakePreferencesPort implements PreferencesPort {
  constructor(readonly data: PreferencesSnapshot = {}) {}
  async load(): Promise<PreferencesSnapshot> {
    return { ...this.data };
  }
  async store(delta: PreferencesSnapshot): Promise<void> {
    Object.assign(this.data as Record<string, unknown>, delta);
  }
}

/** Fake 原生关闭协议端口（MRT-003）：记录 disposition，测试注入请求。 */
export class FakeCloseLifecyclePort implements CloseLifecyclePort {
  /** 按序记录的应答（断言"恰好 resolve 什么"）。 */
  readonly resolutions: Array<{ requestId: string; disposition: CloseDisposition }> = [];
  startCalls = 0;
  stopCalls = 0;
  nextResolveError: Error | null = null;
  private handler: ((request: CloseRequestPayload) => void) | null = null;

  async start(onRequest: (request: CloseRequestPayload) => void): Promise<void> {
    this.startCalls += 1;
    this.handler = onRequest;
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    this.handler = null;
  }

  async resolve(requestId: string, disposition: CloseDisposition): Promise<void> {
    if (this.nextResolveError !== null) {
      const error = this.nextResolveError;
      this.nextResolveError = null;
      throw error;
    }
    this.resolutions.push({ requestId, disposition });
  }

  /** 测试注入：模拟 host 定向 close-requested（或快照补投）。 */
  emit(requestId: string): void {
    this.handler?.({ requestId });
  }
}

/** Fake host launch 通道（MRT-004 Wave 2；浏览器 dev 无 host intent）。 */
export class FakeLaunchPort implements LaunchPort {
  readonly openRequests: string[][] = [];
  readonly blankRequests: string[][] = [];
  async requestOpenIntent() {
    this.openRequests.push([]);
  }
  async requestBlankWindow() {
    this.blankRequests.push([]);
  }
  async launchErrors(): Promise<LaunchRetryableError[]> {
    return [];
  }
  async retryLaunchIntent(_intentId: string): Promise<void> {
    // 浏览器 dev 无 host intent 队列；no-op
  }
  async dismissLaunchIntent(_intentId: string): Promise<void> {
    // 同上
  }
  async pendingRecovery(): Promise<PendingRecovery | null> {
    return null;
  }
  async resolvePendingRecovery(): Promise<void> {
    // 同上
  }
}

/** Fake 导出 renderer（接口对齐 @mindmap/export ExportRenderer 子集）。 */
export class FakeExportRenderer {
  private metricsState: FontMetricsState = "ready";
  private deferredResolver: {
    resolve: (fonts: FontResolver) => void;
    reject: (error: unknown) => void;
    promise: Promise<FontResolver>;
  } | null = null;
  readonly rendered: Array<{ format: string; sceneNodes: number }> = [];

  constructor(
    private readonly results: {
      svg?: Uint8Array;
      png?: Uint8Array;
      pdf?: Uint8Array;
    } = {},
    private readonly customFonts?: FontResolver,
  ) {}

  fontMetricsState(): FontMetricsState {
    return this.metricsState;
  }

  warmup(): void {}

  async whenReady(): Promise<void> {
    await this.whenMetricsReady();
  }

  whenMetricsReady(): Promise<FontResolver> {
    if (this.metricsState === "ready") return Promise.resolve(this.fonts());
    if (this.metricsState === "failed") return Promise.reject(new Error("假字体资源加载失败"));
    return this.deferredResolver?.promise ?? Promise.resolve(this.fonts());
  }

  /** 测试辅助：切换为 pending 模式，并提供 resolve/reject 控制句柄 */
  deferFontMetrics(): { resolve(fonts?: FontResolver): void; reject(error?: unknown): void } {
    this.metricsState = "pending";
    let res!: (f: FontResolver) => void;
    let rej!: (err: unknown) => void;
    const promise = new Promise<FontResolver>((r, j) => {
      res = r;
      rej = j;
    });
    promise.catch(() => {});
    this.deferredResolver = { resolve: res, reject: rej, promise };
    return {
      resolve: (fonts?: FontResolver) => {
        this.metricsState = "ready";
        res(fonts ?? this.fonts());
      },
      reject: (error?: unknown) => {
        this.metricsState = "failed";
        rej(error ?? new Error("假字体资源加载失败"));
      },
    };
  }

  /** 假字体度量（等宽近似）。 */
  fonts(): FontResolver {
    return (
      this.customFonts ?? {
        regular: () => ({ advance: (ch: string, size: number) => (ch.codePointAt(0)! > 0x2e7f ? size : size / 2), ascentRatio: 0.8 }),
        bold: () => ({ advance: (ch: string, size: number) => (ch.codePointAt(0)! > 0x2e7f ? size : size / 2), ascentRatio: 0.8 }),
      }
    );
  }
  async buildScene(doc: {
    document: { nodes: unknown[] };
  }): Promise<
    | { ok: true; scene: { nodeCount: number } }
    | { ok: false; error: { code: string; message: string } }
  > {
    if (doc.document.nodes.length === 0)
      return { ok: false, error: { code: "EXPORT_EMPTY_DOCUMENT", message: "空文档" } };
    return { ok: true, scene: { nodeCount: doc.document.nodes.length } };
  }
  async renderSvg(scene: { nodeCount: number }): Promise<Uint8Array> {
    this.rendered.push({ format: "svg", sceneNodes: scene.nodeCount });
    return this.results.svg ?? new TextEncoder().encode("<svg/>");
  }
  async renderPng(_svg: Uint8Array, scene: { nodeCount: number }): Promise<Uint8Array> {
    this.rendered.push({ format: "png", sceneNodes: scene.nodeCount });
    return this.results.png ?? new Uint8Array([0x89, 0x50]);
  }
  async renderPdf(scene: { nodeCount: number }): Promise<Uint8Array> {
    this.rendered.push({ format: "pdf", sceneNodes: scene.nodeCount });
    return this.results.pdf ?? new Uint8Array([0x25, 0x50]);
  }
}
