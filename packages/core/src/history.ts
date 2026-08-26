// 历史栈：undo/redo 返回"原历史节点及其原 identity"；
// 分叉编辑永远分配新 identity；新命令截断 redo 分支（ADR 0003）。
// history 不序列化、不进文件。

import { applyCommand, makeStateNode, type Command, type StateNode } from "./commands.js";
import type { MindMapDocumentV1 } from "./schema.js";

interface HistoryEntry {
  stateNode: StateNode;
  command: Command | null; // null = 初始状态
  inverse: Command | null;
}

export class History {
  private entries: HistoryEntry[];
  private cursor: number; // 指向当前状态在 entries 中的下标

  constructor(initialDocument: MindMapDocumentV1) {
    this.entries = [{ stateNode: makeStateNode(initialDocument), command: null, inverse: null }];
    this.cursor = 0;
  }

  get current(): StateNode {
    return this.entries[this.cursor]!.stateNode;
  }

  get canUndo(): boolean {
    return this.cursor > 0;
  }

  get canRedo(): boolean {
    return this.cursor < this.entries.length - 1;
  }

  /** 提交命令：新命令截断 redo；失败原样返回错误，不改变历史。 */
  commit(command: Command): ReturnType<typeof applyCommand> {
    const result = applyCommand(this.current, command);
    if (!result.ok) return result;
    this.entries = this.entries.slice(0, this.cursor + 1); // 截断 redo 分支
    this.entries.push({ stateNode: result.stateNode, command, inverse: result.inverse });
    this.cursor = this.entries.length - 1;
    return result;
  }

  /** undo：回到前一状态节点（identity 是当时分配的原值，绝不新发）。 */
  undo(): StateNode | null {
    if (!this.canUndo) return null;
    this.cursor -= 1;
    return this.current;
  }

  /** redo：重放被截断分支的下一条命令，产生全新 identity（新状态）。 */
  redo(): StateNode | null {
    if (!this.canRedo) return null;
    const entry = this.entries[this.cursor + 1]!;
    const result = applyCommand(this.current, entry.command!);
    if (!result.ok) return null; // 理论不可达（同链重放）；fail-closed
    this.cursor += 1;
    this.entries[this.cursor] = {
      stateNode: result.stateNode,
      command: entry.command,
      inverse: result.inverse,
    };
    return this.current;
  }

  /** load 专用：整体替换并清空历史（ReplaceDocument 不进入普通用户历史）。 */
  load(document: MindMapDocumentV1): StateNode {
    this.entries = [{ stateNode: makeStateNode(document), command: null, inverse: null }];
    this.cursor = 0;
    return this.current;
  }
}
