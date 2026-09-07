// 几何提交屏障（ADR 0011 / PRC-025）：
// 在真实 bundled font resolver 就绪前，画布正常显示与输入，
// 但不向 session 提交依赖 DEV_FONTS fallback 度量的持久化 size；
// 字体 ready 后用真实 FontResolver 计算度量，恰好提交一次 command；
// 触发 Save/Close-Save/Export 时，等待真实字体就绪后 flush 提交；
// 失败时不产生部分 command/canonical save，fail-closed 保留输入。

import type {
  Command,
  DocumentSession,
  NodeShape,
  Point,
  TextRun,
} from "@mindmap/core";
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
    if (state === "failed") {
      const err = new Error("字体资源加载失败，无法提交几何变更");
      this.options.onError?.(err);
      return Promise.reject(err);
    }
    if (state === "ready") {
      return this.commitIntent(intent, this.options.getFallbackFonts());
    }

    // pending 态：入队（同节点 intent 归并更新，确保恰好提交一次）
    if (intent.kind === "create-node") {
      this.queue.push(intent);
    } else if (intent.kind === "edit-text") {
      const createIdx = this.queue.findIndex(
        (q) => q.kind === "create-node" && q.id === intent.id,
      );
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
        const editIdx = this.queue.findIndex(
          (q) => q.kind === "edit-text" && q.id === intent.id,
        );
        if (editIdx !== -1) {
          this.queue[editIdx] = intent;
        } else {
          this.queue.push(intent);
        }
      }
    } else if (intent.kind === "set-kicker") {
      const kickerIdx = this.queue.findIndex(
        (q) => q.kind === "set-kicker" && q.id === intent.id,
      );
      if (kickerIdx !== -1) {
        this.queue[kickerIdx] = intent;
      } else {
        this.queue.push(intent);
      }
    }

    return Promise.resolve();
  }

  cancelPendingNode(id: string): void {
    this.queue = this.queue.filter((q) => q.id !== id);
  }

  async flush(): Promise<void> {
    if (this.disposed || this.queue.length === 0) return;
    try {
      const fonts = await this.options.whenMetricsReady();
      if (this.disposed) return;
      const intents = [...this.queue];
      this.queue = [];
      for (const intent of intents) {
        await this.commitIntent(intent, fonts);
      }
      this.options.onCommitted?.();
    } catch (error) {
      this.options.onError?.(error);
      throw error;
    }
  }

  private commitIntent(intent: GeometryIntent, fonts: FontResolver): Promise<void> {
    if (this.disposed) return Promise.resolve();
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
      this.options.session.commit(cmd);
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
        this.options.session.commit(cmd);
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
        this.options.session.commit(cmd);
      }
    }
    return Promise.resolve();
  }

  dispose(): void {
    this.disposed = true;
    this.queue = [];
  }
}
