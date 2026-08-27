import { describe, expect, it } from "vitest";
import { DocumentSession } from "./document-session.js";
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

describe("DocumentSession dirty/保存语义", () => {
  it("新会话 clean；编辑后 dirty", () => {
    const s = newSession();
    expect(s.isDirty).toBe(false);
    addNode(s, "n1");
    expect(s.isDirty).toBe(true);
  });

  it("无 handle 时普通保存返回 null（调用方转 Save As）", () => {
    const s = newSession();
    addNode(s, "n1");
    expect(s.requestOrdinarySave()).toBeNull();
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
    const snap = s.requestOrdinarySave();
    expect(snap).not.toBeNull();
    expect(snap!.documentTargetHandle).toBe("handle-open");
    expect(snap!.expectedVersionToken).toBe("token-open");
    expect(snap!.kind).toBe("ordinary");

    // load（新建文档）清空目标身份：ordinary save 转回 Save As，不写旧文件。
    const fresh = newSession();
    fresh.load(s.current.document);
    fresh.adoptOpenedTarget("h", "t", "/p");
    fresh.load(emptyDocument());
    expect(fresh.requestOrdinarySave()).toBeNull();
    expect(fresh.displayPath).toBeNull();
  });

  it("save → undo → 分叉编辑：dirty（分叉 identity ≠ 保存 identity）", () => {
    const s = newSession();
    addNode(s, "n1");
    const snap = s.requestSaveAs("auth-1")!;
    s.saveCompleted(snap, receipt(1));
    expect(s.isDirty).toBe(false);
    expect(s.displayPath).toBe("/tmp/doc-1.mmap");
    expect(s.documentTargetHandle).toBe("handle-1");

    s.undo(); // 回到空文档（clean 之前的状态）
    addNode(s, "n2"); // 分叉编辑
    expect(s.isDirty).toBe(true);

    // ordinary save 走 handle + token
    const snap2 = s.requestOrdinarySave();
    expect(snap2).not.toBeNull();
    expect(snap2!.documentTargetHandle).toBe("handle-1");
    expect(snap2!.expectedVersionToken).toBe("token-1");
    s.saveCompleted(snap2!, receipt(2));
    expect(s.isDirty).toBe(false);
    expect(s.documentTargetHandle).toBe("handle-2"); // host 轮换后的新 handle
  });

  it("save → edit → undo 回保存点：clean（回到原 identity）", () => {
    const s = newSession();
    addNode(s, "n1");
    const snap = s.requestSaveAs("auth-1")!;
    s.saveCompleted(snap, receipt(1));

    addNode(s, "n2");
    expect(s.isDirty).toBe(true);
    s.undo(); // 回到只含 n1 的保存点
    expect(s.isDirty).toBe(false);
  });

  it("in-flight save 期间继续编辑：完成只确认冻结快照，新编辑保持 dirty", () => {
    const s = newSession();
    addNode(s, "n1");
    const snap = s.requestSaveAs("auth-1")!;
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
    const snap1 = s.requestSaveAs("auth-1")!;
    s.saveCompleted(snap1, receipt(1));

    addNode(s, "n2");
    const snap2 = s.requestOrdinarySave()!;
    s.saveFailed(snap2);
    expect(s.isDirty).toBe(true);
    expect(s.documentTargetHandle).toBe("handle-1");
    expect(s.versionToken).toBe("token-1");
    expect(s.displayPath).toBe("/tmp/doc-1.mmap");
  });

  it("并发保存串行化：in-flight 期间的新请求排队，开始时重新捕获", () => {
    const s = newSession();
    addNode(s, "n1");
    const snap1 = s.requestSaveAs("auth-1")!;
    expect(s.hasInFlightSave).toBe(true);

    // in-flight 时再请求：排队，不返回快照
    expect(s.requestOrdinarySave()).toBeNull();
    expect(s.queuedSaveCount).toBe(1);

    // 完成第一条：快照基于完成时的当前状态（仍是 n1）
    s.saveCompleted(snap1, receipt(1));
    expect(s.hasInFlightSave).toBe(false);
    // 排队的那条此刻可以拉取（驱动方调用）
    const snap2 = s.requestOrdinarySave();
    expect(snap2).not.toBeNull();
    expect(snap2!.stateIdentity).toBe(s.current.identity);
  });

  it("load 后 clean 且历史清空", () => {
    const s = newSession();
    addNode(s, "n1");
    s.load(emptyDocument());
    expect(s.isDirty).toBe(false);
    expect(s.canUndo).toBe(false);
    expect(s.documentTargetHandle).toBeNull();
  });

  it("handle/token 不进入 canonical bytes（不序列化）", () => {
    const s = newSession();
    addNode(s, "n1");
    const snap = s.requestSaveAs("auth-1")!;
    s.saveCompleted(snap, receipt(1));
    const bytes = new TextDecoder().decode(snap.canonicalBytes);
    expect(bytes.includes("handle-1")).toBe(false);
    expect(bytes.includes("token-1")).toBe(false);
  });
});
