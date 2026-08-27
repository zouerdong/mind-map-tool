// 观察包装（MM-080 ⑥）：把画布命令 / undo / redo / 保存 / 导出转发给
// OnboardingFlow 的观察通道（MM-070 的 observeCommands 契约）。
// 组合根专属：core/ui 不感知 onboarding。

import { DocumentSession, type Command, type MindMapDocumentV1 } from "@mindmap/core";
import type { OnboardingObservation } from "@mindmap/ui";

export type ObservationSink = (o: OnboardingObservation) => void;

export class ObservedDocumentSession extends DocumentSession {
  constructor(initial: MindMapDocumentV1, private readonly sink: ObservationSink) {
    super(initial);
  }

  override commit(command: Command): ReturnType<DocumentSession["commit"]> {
    const result = super.commit(command);
    if (result.ok) this.sink({ kind: "command", command });
    return result;
  }

  override undo(): ReturnType<DocumentSession["undo"]> {
    const node = super.undo();
    if (node) this.sink({ kind: "history", action: "undo" });
    return node;
  }

  override redo(): ReturnType<DocumentSession["redo"]> {
    const node = super.redo();
    if (node) this.sink({ kind: "history", action: "redo" });
    return node;
  }

  notifySaved(): void {
    this.sink({ kind: "external", action: "save" });
  }

  notifyExported(): void {
    this.sink({ kind: "external", action: "export" });
  }
}
