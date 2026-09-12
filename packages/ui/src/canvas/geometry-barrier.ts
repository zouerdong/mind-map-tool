// 几何提交屏障（ADR 0011 / PRC-025 / PRR-066）：
// 在真实 bundled font resolver 就绪前，画布正常显示与输入，
// 但不向 session 提交依赖 DEV_FONTS fallback 度量的持久化 size；
// 字体 ready 后用真实 FontResolver 计算度量，恰好提交一次 command；
// pending 态首个依赖真实字体度量的意图会自动启动一次 in-flight flush
//（字体加载由真实需求触发——空白画布不预热导出资源，ADR 0011 动态
// 加载分支），成功后提交并触发 onCommitted，失败经 onError 呈现且保留
// 队列、不产生未处理拒绝；
// 触发 Save/Close-Save/Export 时，等待同一 in-flight 字体加载后 flush
// 提交，绝不持久化 fallback size；
// 字体加载失败时零提交；单条提交失败时保留失败意图并阻断 canonical save，
// 已成功提交的前序用户命令仍留在 session 历史中。

import type { Command, DocumentSession, FontToken, NodeShape, Point, TextRun } from "@mindmap/core";
import { documentDefaults } from "../projection/projection.js";
import type { FontResolver } from "@mindmap/export/src/layout.js";
import { measureNodeBox } from "@mindmap/export/src/layout.js";
import { measureNodeVisual } from "@mindmap/export/src/visual-style.js";

export type FontMetricsState = "pending" | "ready" | "failed";

export type GeometryIntent =
  | {
      kind: "create-node";
      id: string;
      position: Point;
      text: string;
      shape?: NodeShape;
      runs?: TextRun[];
    }
  | {
      kind: "edit-text";
      id: string;
      text: string;
      runs?: TextRun[];
    }
  | {
      kind: "set-kicker";
      id: string;
      kicker: string;
    }
  | {
      /** [PRR-040] 文档字体切换：度量 pending/failed 时保留意图（不得提交
       * 旧字体几何）；resolver ready 后用目标字体重测全部节点并作为单条
       * SetDocumentFontAndResizeNodes 原子提交。 */
      kind: "set-document-font";
      font: FontToken;
    };

export interface GeometryBarrierOptions {
  session: DocumentSession;
  getMetricsState(): FontMetricsState;
  whenMetricsReady(): Promise<FontResolver>;
  getFallbackFonts(): FontResolver;
  onCommitted?(): void;
  onError?(error: unknown): void;
}

export class GeometryBarrier {
  private queue: GeometryIntent[] = [];
  private disposed = false;
  private flushInFlight: Promise<void> | null = null;

  constructor(private readonly options: GeometryBarrierOptions) {}

  getMetricsState(): FontMetricsState {
    return this.options.getMetricsState();
  }

  hasPendingIntents(): boolean {
    return this.queue.length > 0;
  }

  getPendingIntents(): readonly GeometryIntent[] {
    return this.queue;
  }

  enqueue(intent: GeometryIntent): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const state = this.options.getMetricsState();
    if (state === "ready") {
      // ready 分支必须在同一调用栈内同时完成 core commit 与版本通知。
      // DocumentSession 是可变容器；若把 onCommitted 延迟到 Promise 微任务，
      // React Flow 可能先因 selection 等 UI state 重渲染，形成“core 已变、
      // projection version 未变”的短暂窗口并触发 projection drift。
      try {
        this.commitIntent(intent, this.options.getFallbackFonts());
        this.options.onCommitted?.();
        return Promise.resolve();
      } catch (error) {
        this.options.onError?.(error);
        return Promise.reject(error);
      }
    }

    // pending/failed 态：都只记录意图，不允许 fallback 几何进入 session。
    // failed 时由下一次显式 flush（保存/导出）重新触发字体加载；调用方大量使用
    // `void enqueue(...)`，因此这里不能返回 rejected promise 制造未处理拒绝。
    if (state === "failed") {
      this.options.onError?.(new Error("字体资源加载失败；变更已保留，将在下次保存时重试"));
    }

    // 同节点 intent 归并更新，确保字体恢复后恰好提交一次。
    if (intent.kind === "create-node") {
      this.queue.push(intent);
    } else if (intent.kind === "edit-text") {
      const createIdx = this.queue.findIndex((q) => q.kind === "create-node" && q.id === intent.id);
      if (createIdx !== -1) {
        const existing = this.queue[createIdx] as Extract<GeometryIntent, { kind: "create-node" }>;
        const merged: Extract<GeometryIntent, { kind: "create-node" }> = {
          kind: "create-node",
          id: existing.id,
          position: existing.position,
          text: intent.text,
          ...(existing.shape !== undefined ? { shape: existing.shape } : {}),
          ...(intent.runs !== undefined
            ? { runs: intent.runs }
            : existing.runs !== undefined
              ? { runs: existing.runs }
              : {}),
        };
        this.queue[createIdx] = merged;
      } else {
        const editIdx = this.queue.findIndex((q) => q.kind === "edit-text" && q.id === intent.id);
        if (editIdx !== -1) {
          this.queue[editIdx] = intent;
        } else {
          this.queue.push(intent);
        }
      }
    } else if (intent.kind === "set-kicker") {
      const kickerIdx = this.queue.findIndex((q) => q.kind === "set-kicker" && q.id === intent.id);
      if (kickerIdx !== -1) {
        this.queue[kickerIdx] = intent;
      } else {
        this.queue.push(intent);
      }
    } else if (intent.kind === "set-document-font") {
      // 用户字体意图只保留最新一次：未提交的旧切换意图被直接替换
      //（切换语义与中间字体无关，避免字体恢复后重放多次切换）。
      const fontIdx = this.queue.findIndex((q) => q.kind === "set-document-font");
      if (fontIdx !== -1) {
        this.queue[fontIdx] = intent;
      } else {
        this.queue.push(intent);
      }
    }

    // PRR-066：pending 态首个依赖真实字体度量的意图自动启动一次
    // in-flight flush——字体/导出资源由真实需求触发加载（空白画布 mount
    // 不预热）。failed 态不自动重试：错误已由 onError 呈现，重试留给
    // 下次显式 flush（保存/关闭保存/导出），与上方提示承诺一致。
    if (state === "pending") this.scheduleBackgroundFlush();

    return Promise.resolve();
  }

  /**
   * 后台自动 flush：与显式 flush() 共享同一 in-flight promise（Save/
   * Close-Save/Export 等待的是同一次字体加载，绝不持久化 fallback
   * size）。失败已由 drainQueue → onError 呈现且队列保留；这里吞掉
   * rejection，避免无人 await 的 promise 制造未处理拒绝。
   */
  private scheduleBackgroundFlush(): void {
    if (this.disposed || this.flushInFlight) return;
    this.flushInFlight = this.drainQueue().finally(() => {
      this.flushInFlight = null;
    });
    this.flushInFlight.catch(() => {
      // 仅消化 rejection；onError 呈现与队列保留均在 drainQueue 内完成。
    });
  }

  cancelPendingNode(id: string): void {
    // 文档级意图（set-document-font）没有节点 id，不受单节点取消影响。
    this.queue = this.queue.filter((q) => q.kind !== "set-document-font" && q.id !== id);
  }

  async flush(): Promise<void> {
    // 先并入 in-flight（含 PRR-066 后台自动 flush）：drain 消费队列的瞬间
    // queue 可能为空，若先查空队列会绕过正在提交的意图（Save 拍快照落后
    // 于刚落地的 commit）。空队列且无 in-flight 时直接返回——clean 文档的
    // Save 不触发字体资源加载。
    if (this.flushInFlight) return this.flushInFlight;
    if (this.disposed || this.queue.length === 0) return;

    this.flushInFlight = this.drainQueue().finally(() => {
      this.flushInFlight = null;
    });
    return this.flushInFlight;
  }

  private async drainQueue(): Promise<void> {
    try {
      const fonts = await this.options.whenMetricsReady();
      if (this.disposed) return;
      let committedAny = false;
      // 先把当前 intent 从队列中取出再提交：若提交期间同节点继续编辑，新的
      // edit 会作为后续 intent 入队，不会把已提交的 create 合并后重复创建。
      // 提交失败则把原 intent 放回队首，保证用户输入不丢失。
      while (!this.disposed && this.queue.length > 0) {
        const intent = this.queue.shift();
        if (!intent) break;
        try {
          this.commitIntent(intent, fonts);
          committedAny = true;
        } catch (error) {
          if (!this.disposed) this.queue.unshift(intent);
          throw error;
        }
      }
      if (committedAny) this.options.onCommitted?.();
    } catch (error) {
      this.options.onError?.(error);
      throw error;
    }
  }

  private commitIntent(intent: GeometryIntent, fonts: FontResolver): void {
    if (this.disposed) return;
    const doc = this.options.session.current.document;
    const fontId = documentDefaults(doc).font;

    if (intent.kind === "create-node") {
      const box = measureNodeBox(intent.text, intent.runs, fontId, fonts);
      const cmd: Command = {
        kind: "CreateNode",
        id: intent.id,
        text: intent.text,
        position: intent.position,
        size: { width: box.width, height: box.height },
        ...(intent.shape !== undefined ? { shape: intent.shape } : {}),
        ...(intent.runs !== undefined ? { runs: intent.runs } : {}),
      };
      this.commitOrThrow(cmd);
    } else if (intent.kind === "edit-text") {
      const node = doc.document.nodes.find((n) => n.id === intent.id);
      if (node && (node.text !== intent.text || intent.runs !== undefined)) {
        const box = measureNodeBox(intent.text, intent.runs, fontId, fonts);
        const cmd: Command = {
          kind: "EditNodeText",
          id: intent.id,
          text: intent.text,
          size: { width: box.width, height: box.height },
          ...(intent.runs !== undefined ? { runs: intent.runs } : {}),
        };
        this.commitOrThrow(cmd);
      }
    } else if (intent.kind === "set-kicker") {
      const node = doc.document.nodes.find((n) => n.id === intent.id);
      if (node) {
        const measured = measureNodeVisual({ ...node, kicker: intent.kicker }, fontId, fonts);
        const cmd: Command = {
          kind: "SetNodeKicker",
          id: intent.id,
          kicker: intent.kicker,
          measured,
        };
        this.commitOrThrow(cmd);
      }
    } else if (intent.kind === "set-document-font") {
      // [PRR-040] 用目标字体的真实 resolver 度量全部节点（不是当前文档
      // 字体）并构造单条原子命令；core 从当前 state 派生 inverse，一个
      // undo step 同时恢复旧字体与全部旧 size。文档无节点时仅切换字体。
      if (fontId === intent.font) return;
      const sizes = doc.document.nodes.map((node) => ({
        id: node.id,
        size: measureNodeVisual(node, intent.font, fonts),
      }));
      this.commitOrThrow({
        kind: "SetDocumentFontAndResizeNodes",
        font: intent.font,
        previousFont: fontId,
        sizes,
      });
    }
  }

  private commitOrThrow(command: Command): void {
    const result = this.options.session.commit(command);
    if (!result.ok) {
      throw new Error(`几何意图提交失败: ${result.error.code}`);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.queue = [];
  }
}
