import { describe, expect, it } from "vitest";
import { DocumentSession, type SaveRequestResult, type SaveSnapshot } from "./document-session.js";
import { emptyDocument } from "./schema.js";

function newSession(): DocumentSession {
  return new DocumentSession(emptyDocument());
}

function addNode(s: DocumentSession, id: string) {
  const r = s.commit({
    kind: "CreateNode",
    id,
    text: `T${id}`,
    position: { x: 0, y: 0 },
    size: { width: 10, height: 10 },
  });
  expect(r.ok).toBe(true);
}

const receipt = (i: number) => ({
  documentTargetHandle: `handle-${i}`,
  versionToken: `token-${i}`,
  displayPath: `/tmp/doc-${i}.mmap`,
});

/** 测试助手：断言请求得到 snapshot，否则失败（no-target/queued 均为显式失败）。 */
function snapshotOf(r: SaveRequestResult): SaveSnapshot {
  if (r.kind !== "snapshot") throw new Error(`期望 snapshot，实际 ${r.kind}`);
  return r.snapshot;
}

describe("DocumentSession dirty/保存语义", () => {
  it("新会话 clean；编辑后 dirty", () => {
    const s = newSession();
    expect(s.isDirty).toBe(false);
    addNode(s, "n1");
    expect(s.isDirty).toBe(true);
  });

  it("无 handle 时普通保存返回 no-target（可判别，调用方转 Save As）", () => {
    const s = newSession();
    addNode(s, "n1");
    expect(s.requestOrdinarySave()).toEqual({ kind: "no-target" });
  });

  it("adoptOpenedTarget（open → edit → ordinary save 不重开对话框，AC-06）", () => {
    const s = newSession();
    const opened = newSession(); // 模拟 open 的文档内容
    addNode(opened, "n1");
    s.load(opened.current.document);
    s.adoptOpenedTarget("handle-open", "token-open", "/tmp/opened.mm");
    expect(s.isDirty).toBe(false); // open 后 clean（load 已置保存点）
    expect(s.displayPath).toBe("/tmp/opened.mm");

    addNode(s, "n2");
    expect(s.isDirty).toBe(true);
    // ordinary save 直接可用（不弹选址对话框是 host 侧语义；此处验证协议就绪）
    const snap = snapshotOf(s.requestOrdinarySave());
    expect(snap.documentTargetHandle).toBe("handle-open");
    expect(snap.expectedVersionToken).toBe("token-open");
    expect(snap.kind).toBe("ordinary");

    // load（新建文档）清空目标身份：ordinary save 转回 Save As，不写旧文件。
    const fresh = newSession();
    fresh.load(s.current.document);
    fresh.adoptOpenedTarget("h", "t", "/p");
    fresh.load(emptyDocument());
    expect(fresh.requestOrdinarySave()).toEqual({ kind: "no-target" });
    expect(fresh.displayPath).toBeNull();
  });

  it("save → undo → 分叉编辑：dirty（分叉 identity ≠ 保存 identity）", () => {
    const s = newSession();
    addNode(s, "n1");
    const snap = snapshotOf(s.requestSaveAs("auth-1"));
    s.saveCompleted(snap, receipt(1));
    expect(s.isDirty).toBe(false);
    expect(s.displayPath).toBe("/tmp/doc-1.mmap");
    expect(s.documentTargetHandle).toBe("handle-1");

    s.undo(); // 回到空文档（clean 之前的状态）
    addNode(s, "n2"); // 分叉编辑
    expect(s.isDirty).toBe(true);

    // ordinary save 走 handle + token
    const snap2 = snapshotOf(s.requestOrdinarySave());
    expect(snap2.documentTargetHandle).toBe("handle-1");
    expect(snap2.expectedVersionToken).toBe("token-1");
    s.saveCompleted(snap2, receipt(2));
    expect(s.isDirty).toBe(false);
    expect(s.documentTargetHandle).toBe("handle-2"); // host 轮换后的新 handle
  });

  it("save → edit → undo 回保存点：clean（回到原 identity）", () => {
    const s = newSession();
    addNode(s, "n1");
    const snap = snapshotOf(s.requestSaveAs("auth-1"));
    s.saveCompleted(snap, receipt(1));

    addNode(s, "n2");
    expect(s.isDirty).toBe(true);
    s.undo(); // 回到只含 n1 的保存点
    expect(s.isDirty).toBe(false);
  });

  it("in-flight save 期间继续编辑：完成只确认冻结快照，新编辑保持 dirty", () => {
    const s = newSession();
    addNode(s, "n1");
    const snap = snapshotOf(s.requestSaveAs("auth-1"));
    // 保存进行中继续编辑
    addNode(s, "n2");
    expect(s.isDirty).toBe(true);
    s.saveCompleted(snap, receipt(1));
    // 冻结的是 n1 状态；当前是 n1+n2 → 仍 dirty
    expect(s.isDirty).toBe(true);
  });

  it("保存失败：保存点、handle、token、displayPath 完全不变", () => {
    const s = newSession();
    addNode(s, "n1");
    const snap1 = snapshotOf(s.requestSaveAs("auth-1"));
    s.saveCompleted(snap1, receipt(1));

    addNode(s, "n2");
    const snap2 = snapshotOf(s.requestOrdinarySave());
    s.saveFailed(snap2);
    expect(s.isDirty).toBe(true);
    expect(s.documentTargetHandle).toBe("handle-1");
    expect(s.versionToken).toBe("token-1");
    expect(s.displayPath).toBe("/tmp/doc-1.mmap");
  });

  it("load（无 pending）：替换文档、clean、历史清空、目标身份清空", () => {
    const s = newSession();
    addNode(s, "n1");
    const snap = snapshotOf(s.requestSaveAs("auth-1"));
    s.saveCompleted(snap, receipt(1)); // 保存链自然终态 → 无 pending
    expect(s.load(emptyDocument())).toEqual({ kind: "replaced" });
    expect(s.isDirty).toBe(false);
    expect(s.canUndo).toBe(false);
    expect(s.documentTargetHandle).toBeNull();
    expect(s.displayPath).toBeNull();
    expect(s.hasInFlightSave).toBe(false);
    expect(s.queuedSaveCount).toBe(0);
  });

  it("handle/token 不进入 canonical bytes（不序列化）", () => {
    const s = newSession();
    addNode(s, "n1");
    const snap = snapshotOf(s.requestSaveAs("auth-1"));
    s.saveCompleted(snap, receipt(1));
    const bytes = new TextDecoder().decode(snap.canonicalBytes);
    expect(bytes.includes("handle-1")).toBe(false);
    expect(bytes.includes("token-1")).toBe(false);
  });
});

describe("DocumentSession 保存队列状态机（CR-001 / MRT-001）", () => {
  it("in-flight 期间的普通保存请求排队且可判别（queued ≠ no-target）", () => {
    const s = newSession();
    addNode(s, "n1");
    snapshotOf(s.requestSaveAs("auth-1")); // 占位 in-flight
    expect(s.requestOrdinarySave()).toEqual({ kind: "queued" });
    expect(s.requestOrdinarySave()).toEqual({ kind: "queued" });
    expect(s.queuedSaveCount).toBe(2);
  });

  it("takeNextSaveIntent 在 in-flight 时返回 empty，不出队", () => {
    const s = newSession();
    addNode(s, "n1");
    snapshotOf(s.requestSaveAs("auth-1"));
    s.requestOrdinarySave(); // 排队
    expect(s.takeNextSaveIntent()).toEqual({ kind: "empty" });
    expect(s.queuedSaveCount).toBe(1); // 队列未被消费
  });

  it("in-flight 结束后 takeNextSaveIntent 原子出队并按当前状态重捕获", () => {
    const s = newSession();
    addNode(s, "n1");
    const snap1 = snapshotOf(s.requestSaveAs("auth-1"));
    addNode(s, "n2"); // 排队之后、出队之前的新编辑
    expect(s.requestOrdinarySave()).toEqual({ kind: "queued" });
    s.saveCompleted(snap1, receipt(1));
    expect(s.hasInFlightSave).toBe(false);
    expect(s.queuedSaveCount).toBe(1); // 完成不自动开启下一个（由驱动方消费）

    const next = s.takeNextSaveIntent();
    expect(next.kind).toBe("snapshot");
    if (next.kind === "snapshot") {
      expect(next.snapshot.stateIdentity).toBe(s.current.identity); // 出队时重捕获
      expect(next.snapshot.kind).toBe("ordinary");
      expect(next.snapshot.documentTargetHandle).toBe("handle-1");
    }
    expect(s.queuedSaveCount).toBe(0); // 取出即出队
    expect(s.hasInFlightSave).toBe(true);
    expect(s.takeNextSaveIntent()).toEqual({ kind: "empty" });
  });

  it("排队的 save-as 保留语义，不降级为 ordinary", () => {
    const s = newSession();
    addNode(s, "n1");
    const snap1 = snapshotOf(s.requestSaveAs("auth-1"));
    s.saveCompleted(snap1, receipt(1)); // 此刻有 handle
    addNode(s, "n2");
    const snap2 = snapshotOf(s.requestOrdinarySave()); // ordinary in-flight
    expect(s.requestSaveAs("auth-2")).toEqual({ kind: "queued" });
    s.saveCompleted(snap2, receipt(2));

    const next = s.takeNextSaveIntent();
    expect(next.kind).toBe("snapshot");
    if (next.kind === "snapshot") {
      expect(next.snapshot.kind).toBe("save-as"); // ★ 不降级
      expect(next.snapshot.authorizationRef).toBe("auth-2");
      expect(next.snapshot.documentTargetHandle).toBeNull();
    }
    expect(s.queuedSaveCount).toBe(0);
  });

  it("saveFailed 清空剩余队列（失败策略：不残留不可消费的 intent）", () => {
    const s = newSession();
    addNode(s, "n1");
    const snap1 = snapshotOf(s.requestSaveAs("auth-1"));
    s.saveCompleted(snap1, receipt(1));
    addNode(s, "n2");
    const snap2 = snapshotOf(s.requestOrdinarySave()); // in-flight
    s.requestOrdinarySave(); // 排队
    s.requestSaveAs("auth-9"); // 排队
    expect(s.queuedSaveCount).toBe(2);
    s.saveFailed(snap2);
    expect(s.queuedSaveCount).toBe(0); // 失败策略：排队请求一并终止
    expect(s.takeNextSaveIntent()).toEqual({ kind: "empty" });
    expect(s.isDirty).toBe(true); // dirty 保持，重试由用户发起
  });

  it("空队列时 takeNextSaveIntent 返回 empty", () => {
    const s = newSession();
    expect(s.takeNextSaveIntent()).toEqual({ kind: "empty" });
  });
});

describe("文档替换 pending gate（MRT-001A）", () => {
  it("hasPendingSaves 覆盖 in-flight、排队未消费、自然终态后归零", () => {
    const s = newSession();
    expect(s.hasPendingSaves).toBe(false);
    addNode(s, "n1");
    const snap = snapshotOf(s.requestSaveAs("auth-1")); // 占位 in-flight
    expect(s.hasPendingSaves).toBe(true);
    s.requestOrdinarySave(); // 排队
    expect(s.hasPendingSaves).toBe(true);

    s.saveCompleted(snap, receipt(1)); // in-flight 终态、队列尚未被驱动消费
    expect(s.hasPendingSaves).toBe(true); // ★ 排队请求仍是 pending

    const next = s.takeNextSaveIntent();
    if (next.kind !== "snapshot") throw new Error(`期望 snapshot，实际 ${next.kind}`);
    s.saveCompleted(next.snapshot, receipt(2));
    expect(s.hasPendingSaves).toBe(false); // 保存链自然终态 → 替换解锁
  });

  it("pending 时 load 返回 save-pending 且一切字段逐项不变；拒绝不影响保存链终态", () => {
    const s = newSession();
    const opened = newSession();
    addNode(opened, "o1");
    expect(s.load(opened.current.document)).toEqual({ kind: "replaced" });
    s.adoptOpenedTarget("h-open", "t-open", "/p/open.mm");
    addNode(s, "n1");
    const identityBefore = s.current.identity;
    const snap = snapshotOf(s.requestOrdinarySave()); // in-flight（handle 就绪）
    s.requestOrdinarySave(); // 排队

    // ★ 替换被拒绝：document/identity/handle/token/displayPath/dirty/queue/inFlight 逐项不变
    expect(s.load(emptyDocument())).toEqual({ kind: "save-pending" });
    expect(s.current.identity).toBe(identityBefore);
    expect(s.document.document.nodes.length).toBe(2); // 仍是 o1+n1 的原文档
    expect(s.documentTargetHandle).toBe("h-open");
    expect(s.versionToken).toBe("t-open");
    expect(s.displayPath).toBe("/p/open.mm");
    expect(s.isDirty).toBe(true);
    expect(s.hasInFlightSave).toBe(true);
    expect(s.queuedSaveCount).toBe(1);
    expect(s.canUndo).toBe(true); // 历史未被清空

    // ★ 拒绝不是任何保存请求的终态：保存链照常自然终态
    s.saveCompleted(snap, receipt(9));
    expect(s.isDirty).toBe(false);
    expect(s.documentTargetHandle).toBe("handle-9");
    expect(s.queuedSaveCount).toBe(1); // 队列留给驱动方消费

    const next = s.takeNextSaveIntent();
    if (next.kind !== "snapshot") throw new Error(`期望 snapshot，实际 ${next.kind}`);
    expect(s.load(emptyDocument())).toEqual({ kind: "save-pending" }); // 出队即重占 in-flight
    s.saveFailed(next.snapshot); // 失败清队 → pending 归零
    expect(s.hasPendingSaves).toBe(false);
    expect(s.load(emptyDocument())).toEqual({ kind: "replaced" }); // 替换解锁
    expect(s.documentTargetHandle).toBeNull();
  });
});

describe("redo identity 与 dirty 契约（MRT-002 / CR-002，ADR 0003）", () => {
  it("D1：保存 S2 → undo S1（dirty）→ redo 原 S2（clean）", () => {
    const s = newSession();
    addNode(s, "n1"); // S1
    addNode(s, "n2"); // S2
    const snap = snapshotOf(s.requestSaveAs("auth-1"));
    const s2Identity = s.current.identity;
    s.saveCompleted(snap, receipt(1)); // 真实回执建立保存点 = S2
    expect(s.isDirty).toBe(false);

    s.undo(); // 回 S1
    expect(s.isDirty).toBe(true);
    const redone = s.redo(); // 回原 S2
    expect(redone).not.toBeNull();
    expect(redone!.identity).toBe(s2Identity); // ★ 原 identity（不是新发）
    expect(s.isDirty).toBe(false); // ★ 旧实现 redo 新发 identity → dirty 误报
  });

  it("D2：保存 S1 → 编辑 S2 → undo S1 → redo S2：dirty false→true→false→true", () => {
    const s = newSession();
    addNode(s, "n1"); // S1
    const snap = snapshotOf(s.requestSaveAs("auth-1"));
    s.saveCompleted(snap, receipt(1)); // 保存点 = S1
    expect(s.isDirty).toBe(false);

    addNode(s, "n2"); // S2（分叉前进）
    expect(s.isDirty).toBe(true);
    s.undo(); // 回 S1
    expect(s.isDirty).toBe(false);
    s.redo(); // 回 S2
    expect(s.isDirty).toBe(true); // ★ 分叉状态仍正确判 dirty
  });

  it("D3：in-flight 保存 S2 → undo S1 → 回执完成（仍 dirty）→ redo S2（clean）", () => {
    const s = newSession();
    addNode(s, "n1"); // S1
    addNode(s, "n2"); // S2
    const snap = snapshotOf(s.requestSaveAs("auth-1")); // 冻结 S2 的 identity
    s.undo(); // S1
    expect(s.isDirty).toBe(true);

    s.saveCompleted(snap, receipt(1)); // 回执：保存点 = 冻结的 S2
    expect(s.isDirty).toBe(true); // ★ 当前 S1 ≠ 保存点 S2 → 仍 dirty
    s.redo(); // 回原 S2
    expect(s.isDirty).toBe(false); // ★ 原 S2 identity = 保存点 → clean
  });

  it("D4：in-flight 保存 S2 → undo S1 → redo S2 → 回执完成（clean）", () => {
    const s = newSession();
    addNode(s, "n1");
    addNode(s, "n2");
    const snap = snapshotOf(s.requestSaveAs("auth-1")); // 冻结 S2
    const s2Identity = s.current.identity;
    s.undo(); // S1
    s.redo(); // 回原 S2
    expect(s.current.identity).toBe(s2Identity);
    expect(s.isDirty).toBe(true); // 回执未到

    s.saveCompleted(snap, receipt(1)); // 回执：保存点 = 冻结的 S2
    expect(s.isDirty).toBe(false); // ★ 当前（原 S2）= 保存点 → clean
  });

  it("S1：排队保存期间 undo/redo 不改变排队语义；队列照常消费且终态一致", () => {
    const s = newSession();
    addNode(s, "n1"); // S1
    const s1Node = s.current;
    addNode(s, "n2"); // S2
    const snap1 = snapshotOf(s.requestSaveAs("auth-1")); // in-flight 冻结 S2
    expect(s.requestOrdinarySave()).toEqual({ kind: "queued" }); // 排队
    expect(s.queuedSaveCount).toBe(1);

    s.undo(); // 排队期间 undo：S1
    expect(s.current).toBe(s1Node);
    s.redo(); // 回原 S2
    expect(s.current.identity).toBe(snap1.stateIdentity); // ★ 原 identity 回来，与冻结快照一致

    s.saveCompleted(snap1, receipt(1)); // in-flight 终态（当前原 S2 = 保存点）
    expect(s.isDirty).toBe(false);

    const next = s.takeNextSaveIntent(); // 队列照常原子消费
    if (next.kind !== "snapshot") throw new Error(`期望 snapshot，实际 ${next.kind}`);
    expect(next.snapshot.stateIdentity).toBe(s.current.identity); // 出队时重捕获（S2）
    expect(s.queuedSaveCount).toBe(0);

    s.saveCompleted(next.snapshot, receipt(2)); // 排队项终态
    expect(s.isDirty).toBe(false); // 每个请求都有终态且 clean 落定
  });
});
