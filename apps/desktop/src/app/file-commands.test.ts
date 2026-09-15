// MRT-001（CR-001）文件流集成测试：保存队列状态机的跨层回归。
// 用可门闩/可失败注入的 FilePort 包装控制提交时序，断言提交次数、
// 对话框次数、最终 handle/token、saved identity（经 dirty/displayPath）、
// 队列长度——不只断言函数返回值。

import { describe, expect, it, vi } from "vitest";
import { DocumentSession, emptyDocument, encodeDocument } from "@mindmap/core";
import { PlatformError } from "@mindmap/platform";
import type { CommitDocumentRequest, CommitReceipt, FilePort } from "@mindmap/platform";
import { FakeFilePort } from "./fake-ports.js";
import { okRenderer } from "./export-commands.test-helpers.js";
import {
  newDocumentFlow,
  openDocumentFlow,
  openPathFlow,
  saveAsFlow,
  saveFlow,
  suggestedName,
  unifiedSaveFlow,
  whenSavesSettled,
} from "./file-commands.js";

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** 记录每次提交/打开请求；下一次 commit 或 openPath 可挂起在门闩上，也可注入一次性失败。 */
class GatedFilePort implements FilePort {
  readonly commits: CommitDocumentRequest[] = [];
  openPathCalls = 0;
  private gate: Promise<void> | null = null;
  private openGate: Promise<void> | null = null;
  private failure: PlatformError | null = null;

  constructor(private readonly inner: FakeFilePort) {}

  requestUnifiedSaveAuthorization(
    suggestedName: string,
    documentSaved: boolean,
  ): ReturnType<FilePort["requestUnifiedSaveAuthorization"]> {
    return this.inner.requestUnifiedSaveAuthorization(suggestedName, documentSaved);
  }

  /** 下一次 commitDocument 挂起，直到 release。 */
  holdNextCommit(promise: Promise<void>): void {
    this.gate = promise;
  }

  /** 下一次 openPath 挂起，直到 release（构造"读取中保存进入 pending"的时序）。 */
  holdNextOpenPath(promise: Promise<void>): void {
    this.openGate = promise;
  }

  failNextCommitWith(e: PlatformError): void {
    this.failure = e;
  }

  async openDocument() {
    return this.inner.openDocument();
  }

  async openPath(path: string) {
    this.openPathCalls += 1;
    if (this.openGate) {
      const gate = this.openGate;
      this.openGate = null;
      await gate;
    }
    return this.inner.openPath(path);
  }

  async requestTargetAuthorization(kind: "document" | "export", suggestedName: string) {
    return this.inner.requestTargetAuthorization(kind, suggestedName);
  }

  async commitExport(...args: Parameters<FilePort["commitExport"]>) {
    return this.inner.commitExport(...args);
  }

  async commitDocument(request: CommitDocumentRequest): Promise<CommitReceipt> {
    this.commits.push(request);
    if (this.gate) {
      const gate = this.gate;
      this.gate = null;
      await gate;
    }
    if (this.failure) {
      const e = this.failure;
      this.failure = null;
      throw e;
    }
    return this.inner.commitDocument(request);
  }
}

async function openedSession(fake: FakeFilePort, path = "/docs/a.json"): Promise<DocumentSession> {
  fake.writeFile(path, encodeDocument(emptyDocument()));
  const session = new DocumentSession(emptyDocument());
  const result = await openPathFlow(session, { filePort: fake }, path);
  if (result.kind !== "ok") throw new Error(`setup: openPathFlow 失败 ${result.kind}`);
  return session;
}

function edit(session: DocumentSession, id: string): void {
  const r = session.commit({
    kind: "CreateNode",
    id,
    text: `T${id}`,
    position: { x: 0, y: 0 },
    size: { width: 10, height: 10 },
  });
  expect(r.ok).toBe(true);
}

describe("保存队列状态机（CR-001 回归）", () => {
  it("新文档默认建议正式 .mindmap 扩展名", () => {
    expect(suggestedName(new DocumentSession(emptyDocument()))).toBe("未命名.mindmap");
  });

  it("关闭等待会持续追踪调用后才加入的保存请求，直到整条保存链归零", async () => {
    const fake = new FakeFilePort();
    const session = await openedSession(fake);
    edit(session, "n1");
    const port = new GatedFilePort(fake);
    const firstGate = deferred();
    port.holdNextCommit(firstGate.promise);

    const first = saveFlow(session, { filePort: port });
    await vi.waitFor(() => expect(port.commits.length).toBe(1));
    const settled = whenSavesSettled(session); // 此时只看得到 first

    const secondGate = deferred();
    port.holdNextCommit(secondGate.promise);
    const second = saveFlow(session, { filePort: port }); // 等待开始后才加入
    firstGate.release();
    await vi.waitFor(() => expect(port.commits.length).toBe(2));

    let didSettle = false;
    void settled.then(() => {
      didSettle = true;
    });
    await Promise.resolve();
    expect(didSettle).toBe(false); // 第二次仍挂起，关闭等待不得提前返回

    secondGate.release();
    await settled;
    expect((await first).kind).toBe("ok");
    expect((await second).kind).toBe("ok");
    expect(session.hasPendingSaves).toBe(false);
  });

  it("已有 target 时快速保存两次：不弹 Save As，恰好提交 2 次，队列归零", async () => {
    const fake = new FakeFilePort();
    const session = await openedSession(fake);
    edit(session, "n1");
    const port = new GatedFilePort(fake);
    const gate = deferred();
    port.holdNextCommit(gate.promise);

    const first = saveFlow(session, { filePort: port });
    await vi.waitFor(() => expect(port.commits.length).toBe(1)); // 第一次已提交、挂起中
    const second = saveFlow(session, { filePort: port }); // 提交未完成时到达
    expect(session.queuedSaveCount).toBe(1); // 第二次只排队，未提交
    expect(session.hasInFlightSave).toBe(true);

    gate.release();
    const r1 = await first;
    const r2 = await second;
    expect(r1.kind).toBe("ok");
    expect(r2.kind).toBe("ok"); // ★ 排队请求得到成功终态（不是取消/错误）
    expect(fake.saveDialogCalls).toBe(0); // ★ 不弹 Save As
    expect(port.commits.length).toBe(2); // ★ 恰好 2 次，不自旋
    expect(port.commits.every((c) => c.kind === "ordinary")).toBe(true);
    expect(session.queuedSaveCount).toBe(0);
    expect(session.hasInFlightSave).toBe(false);
    expect(session.isDirty).toBe(false);
    if (r2.kind === "ok") {
      expect(session.documentTargetHandle).toBe(r2.value.receipt.documentTargetHandle);
      expect(session.versionToken).toBe(r2.value.receipt.versionToken);
    }
  }, 10_000);

  it("第一次保存进行中继续编辑再保存：第二次提交最新内容；第一次完成不误清 dirty", async () => {
    const fake = new FakeFilePort();
    const session = await openedSession(fake);
    edit(session, "n1");
    const port = new GatedFilePort(fake);
    const gate = deferred();
    port.holdNextCommit(gate.promise);

    const first = saveFlow(session, { filePort: port });
    await vi.waitFor(() => expect(port.commits.length).toBe(1));
    edit(session, "n2"); // 保存进行中继续编辑
    const second = saveFlow(session, { filePort: port });
    expect(session.queuedSaveCount).toBe(1);

    gate.release();
    const r1 = await first;
    expect(r1.kind).toBe("ok");
    expect(session.isDirty).toBe(true); // ★ 第一次完成只确认冻结快照，不清 dirty
    const r2 = await second;
    expect(r2.kind).toBe("ok");
    expect(port.commits.length).toBe(2);
    expect(new TextDecoder().decode(port.commits[1]!.contentBytes)).toContain("Tn2"); // ★ 第二次 bytes 是最新状态
    expect(session.isDirty).toBe(false);
    expect(session.queuedSaveCount).toBe(0);
  }, 10_000);

  it("首次 Save As 进行中按保存：排队 ordinary 在授权完成后执行，不弹第二次对话框", async () => {
    const fake = new FakeFilePort();
    const session = new DocumentSession(emptyDocument());
    edit(session, "n1");
    fake.nextSaveDialog = "/docs/first.json";
    const port = new GatedFilePort(fake);
    const gate = deferred();
    port.holdNextCommit(gate.promise);

    const first = saveAsFlow(session, { filePort: port }, "未命名.json");
    await vi.waitFor(() => expect(port.commits.length).toBe(1)); // 授权完成，提交挂起
    const second = saveFlow(session, { filePort: port }); // 无 handle 时排队（不是弹 Save As）
    expect(session.queuedSaveCount).toBe(1);

    gate.release();
    const r1 = await first;
    const r2 = await second;
    expect(r1.kind).toBe("ok");
    expect(r2.kind).toBe("ok");
    expect(fake.saveDialogCalls).toBe(1); // ★ 只有第一次 Save As 弹过
    expect(port.commits.length).toBe(2);
    expect(port.commits[1]!.kind).toBe("ordinary"); // handle 已就绪 → ordinary 语义
    expect(session.displayPath).toBe("/docs/first.json");
    expect(session.queuedSaveCount).toBe(0);
    expect(session.isDirty).toBe(false);
  }, 10_000);

  it("Save As 排队保留语义：第二个 Save As 不降级为 ordinary，按各自授权提交", async () => {
    const fake = new FakeFilePort();
    const session = new DocumentSession(emptyDocument());
    edit(session, "n1");
    fake.nextSaveDialog = "/docs/one.json";
    const port = new GatedFilePort(fake);
    const gate = deferred();
    port.holdNextCommit(gate.promise);

    const first = saveAsFlow(session, { filePort: port }, "未命名.json");
    await vi.waitFor(() => expect(port.commits.length).toBe(1));
    fake.nextSaveDialog = "/docs/two.json";
    const second = saveAsFlow(session, { filePort: port }, "未命名.json"); // 取得授权₂ → 排队
    await vi.waitFor(() => expect(session.queuedSaveCount).toBe(1));

    gate.release();
    const r1 = await first;
    const r2 = await second;
    expect(r1.kind).toBe("ok");
    expect(r2.kind).toBe("ok"); // 旧实现这里返回 SAVE_IN_FLIGHT 错误
    expect(fake.saveDialogCalls).toBe(2);
    expect(port.commits.length).toBe(2);
    expect(port.commits[0]!.kind).toBe("save-as");
    expect(port.commits[1]!.kind).toBe("save-as"); // ★ 不降级 ordinary
    expect(new TextDecoder().decode(fake.files.get("/docs/two.json")!)).toContain("Tn1");
    expect(session.displayPath).toBe("/docs/two.json");
    expect(session.queuedSaveCount).toBe(0);
    expect(session.isDirty).toBe(false);
  }, 10_000);

  it("取消 Save As 授权：不产生提交、不残留队列", async () => {
    const fake = new FakeFilePort();
    const session = new DocumentSession(emptyDocument());
    edit(session, "n1");
    fake.nextSaveDialog = null; // 对话框取消
    const port = new GatedFilePort(fake);

    const r = await saveAsFlow(session, { filePort: port }, "未命名.json");
    expect(r.kind).toBe("cancelled");
    expect(fake.saveDialogCalls).toBe(1);
    expect(port.commits.length).toBe(0);
    expect(session.queuedSaveCount).toBe(0);
    expect(session.hasInFlightSave).toBe(false);
    expect(session.isDirty).toBe(true);
  });

  it("冲突：失败得到 conflict 终态，不写盘、不自旋；排队请求收到同一失败终态", async () => {
    const fake = new FakeFilePort();
    const session = await openedSession(fake);
    edit(session, "n1");
    // 外部改写同一文件（ordinary token 复核失配）
    fake.writeFile("/docs/a.json", new TextEncoder().encode('{"schemaVersion":1,"external":true}'));
    const port = new GatedFilePort(fake);
    const gate = deferred();
    port.holdNextCommit(gate.promise);

    const first = saveFlow(session, { filePort: port });
    await vi.waitFor(() => expect(port.commits.length).toBe(1));
    const second = saveFlow(session, { filePort: port }); // 排队
    expect(session.queuedSaveCount).toBe(1);

    gate.release();
    const r1 = await first;
    const r2 = await second;
    expect(r1.kind).toBe("conflict");
    expect(r2.kind).toBe("conflict"); // ★ 排队请求也得到终态，不悬挂
    expect(port.commits.length).toBe(1); // ★ 只尝试一次，不自旋
    expect(session.queuedSaveCount).toBe(0);
    expect(session.hasInFlightSave).toBe(false);
    expect(session.isDirty).toBe(true);
    expect(session.documentTargetHandle).not.toBeNull(); // 保存身份不变
    expect(session.displayPath).toBe("/docs/a.json");
    expect(new TextDecoder().decode(fake.files.get("/docs/a.json")!)).toContain("external"); // 未覆盖外部内容
  }, 10_000);

  it("失败后用户重试：新请求成功提交且队列干净", async () => {
    const fake = new FakeFilePort();
    const session = await openedSession(fake);
    edit(session, "n1");
    const port = new GatedFilePort(fake);
    port.failNextCommitWith(new PlatformError("FILE_IO_ERROR", "磁盘暂不可用"));

    const r1 = await saveFlow(session, { filePort: port });
    expect(r1.kind).toBe("error");
    expect(port.commits.length).toBe(1);
    expect(session.isDirty).toBe(true);
    expect(session.queuedSaveCount).toBe(0);

    const r2 = await saveFlow(session, { filePort: port }); // 用户重试（全新请求）
    expect(r2.kind).toBe("ok");
    expect(port.commits.length).toBe(2);
    expect(session.isDirty).toBe(false);
    expect(session.queuedSaveCount).toBe(0);
    expect(new TextDecoder().decode(fake.files.get("/docs/a.json")!)).toContain("Tn1");
  }, 10_000);

  it("连续三次保存请求：串行执行恰好 3 次提交，全部终态成功且队列归零", async () => {
    const fake = new FakeFilePort();
    const session = await openedSession(fake);
    edit(session, "n1");
    const port = new GatedFilePort(fake);
    const gate = deferred();
    port.holdNextCommit(gate.promise);

    const p1 = saveFlow(session, { filePort: port });
    await vi.waitFor(() => expect(port.commits.length).toBe(1));
    const p2 = saveFlow(session, { filePort: port });
    const p3 = saveFlow(session, { filePort: port });
    expect(session.queuedSaveCount).toBe(2);

    gate.release();
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1.kind).toBe("ok");
    expect(r2.kind).toBe("ok");
    expect(r3.kind).toBe("ok");
    expect(fake.saveDialogCalls).toBe(0); // ★ 全程无选址对话框
    expect(port.commits.length).toBe(3); // ★ 恰好 3 次，成功也不自旋
    expect(session.queuedSaveCount).toBe(0);
    expect(session.hasInFlightSave).toBe(false);
    expect(session.isDirty).toBe(false);
  }, 10_000);
});

describe("文档替换 pending gate（MRT-001A / CR-001 收尾）", () => {
  /**
   * 悬挂哨兵：仅用于在【旧实现】下证明 Promise 永不 resolve。绿态下终态
   * 总是先于 timeout 到达，race 不依赖 timeout——生产代码禁止任何
   * Promise.race(timeout)（任务卡 §5-D）。
   */
  const HUNG = Symbol("hung");
  async function hangDetection<T>(p: Promise<T>, ms = 1_000): Promise<T | typeof HUNG> {
    return Promise.race([p, new Promise<typeof HUNG>((r) => setTimeout(() => r(HUNG), ms))]);
  }

  it("T1：保存挂起+第二次排队时 New 返回 SAVE_IN_PROGRESS；两个保存请求最终都有终态，此后 New 可重试", async () => {
    const fake = new FakeFilePort();
    const session = await openedSession(fake);
    edit(session, "n1");
    const port = new GatedFilePort(fake);
    const gate = deferred();
    port.holdNextCommit(gate.promise);

    const first = saveFlow(session, { filePort: port });
    await vi.waitFor(() => expect(port.commits.length).toBe(1)); // 第一次提交挂起
    const second = saveFlow(session, { filePort: port }); // 排队
    expect(session.queuedSaveCount).toBe(1);

    let discardCalls = 0;
    const newResult = await newDocumentFlow(session, async () => {
      discardCalls += 1;
      return true;
    });
    // ★ New 必须 fail closed，不静默替换
    expect(newResult).toMatchObject({ kind: "error", code: "SAVE_IN_PROGRESS" });
    expect(discardCalls).toBe(0); // ★ 不执行 discard callback
    // ★ session 全部状态逐项不变（场景 8）
    expect(session.displayPath).toBe("/docs/a.json");
    expect(session.documentTargetHandle).not.toBeNull();
    expect(session.versionToken).not.toBeNull();
    expect(session.isDirty).toBe(true);
    expect(session.hasInFlightSave).toBe(true);
    expect(session.queuedSaveCount).toBe(1);
    expect(session.document.document.nodes.length).toBe(1); // 文档未被替换

    gate.release();
    expect(await hangDetection(first)).toMatchObject({ kind: "ok" });
    // ★ 排队请求必须拿到终态（旧实现：load 清队 → waiter 永久悬挂）
    const secondResult = await hangDetection(second);
    expect(secondResult).not.toBe(HUNG);
    expect(secondResult).toMatchObject({ kind: "ok" });
    expect(port.commits.length).toBe(2);
    expect(session.queuedSaveCount).toBe(0);
    expect(session.hasInFlightSave).toBe(false);
    expect(session.isDirty).toBe(false);

    // 终态落定后 New 可重试并成功（保存已完成 → 不再弹 discard）
    const retry = await newDocumentFlow(session, async () => {
      discardCalls += 1;
      return true;
    });
    expect(retry).toEqual({ kind: "ok" });
    expect(discardCalls).toBe(0);
  }, 10_000);

  it("T2：openPath 读取中保存进入 pending → adopt 前二次 gate 阻止替换，原 session 逐项不变", async () => {
    const fake = new FakeFilePort();
    const session = await openedSession(fake, "/docs/a.json");
    edit(session, "n1");
    fake.writeFile("/docs/b.json", encodeDocument(emptyDocument()));
    const port = new GatedFilePort(fake);
    const openGate = deferred();
    port.holdNextOpenPath(openGate.promise);

    const opening = openPathFlow(session, { filePort: port }, "/docs/b.json"); // 前置无 pending → 开始读取
    await vi.waitFor(() => expect(port.openPathCalls).toBe(1)); // 读取挂起中

    const commitGate = deferred();
    port.holdNextCommit(commitGate.promise);
    const saving = saveFlow(session, { filePort: port }); // 读取中保存进入 in-flight
    await vi.waitFor(() => expect(port.commits.length).toBe(1));
    const handleBefore = session.documentTargetHandle;
    const tokenBefore = session.versionToken;

    openGate.release(); // 读取完成 → adopt 前的原子二次 gate
    const r = await opening;
    // ★ 不得 adopt（旧实现：直接 load 替换并返回 ok）
    expect(r).toMatchObject({ kind: "error", code: "SAVE_IN_PROGRESS" });
    // ★ 原 session 逐项不变（场景 8：document/identity/handle/token/displayPath/dirty/queue/inFlight）
    expect(session.displayPath).toBe("/docs/a.json");
    expect(session.documentTargetHandle).toBe(handleBefore);
    expect(session.versionToken).toBe(tokenBefore);
    expect(session.isDirty).toBe(true);
    expect(session.hasInFlightSave).toBe(true);
    expect(session.queuedSaveCount).toBe(0);
    expect(session.document.document.nodes.length).toBe(1); // 仍是旧文档（含 Tn1）

    commitGate.release(); // 保存链自然终态
    expect(await hangDetection(saving)).toMatchObject({ kind: "ok" });
    expect(session.isDirty).toBe(false);
    expect(session.displayPath).toBe("/docs/a.json"); // 保存身份不被 open 干扰
  }, 10_000);

  it("T3：首提交冲突失败 → 两个保存请求同获失败终态；终态后 New 可重试（含正常 discard 确认）", async () => {
    const fake = new FakeFilePort();
    const session = await openedSession(fake);
    edit(session, "n1");
    fake.writeFile("/docs/a.json", new TextEncoder().encode('{"schemaVersion":1,"external":true}'));
    const port = new GatedFilePort(fake);
    const gate = deferred();
    port.holdNextCommit(gate.promise);

    const first = saveFlow(session, { filePort: port });
    await vi.waitFor(() => expect(port.commits.length).toBe(1));
    const second = saveFlow(session, { filePort: port }); // 排队
    expect(session.queuedSaveCount).toBe(1);

    const duringPending = await newDocumentFlow(session, async () => true);
    expect(duringPending).toMatchObject({ kind: "error", code: "SAVE_IN_PROGRESS" });

    gate.release(); // 冲突：saveFailed 清队 + 排队 waiter 同失败收尾
    expect(await first).toMatchObject({ kind: "conflict" });
    expect(await hangDetection(second)).toMatchObject({ kind: "conflict" }); // ★ 不悬挂
    expect(session.queuedSaveCount).toBe(0);
    expect(session.hasInFlightSave).toBe(false);
    expect(session.isDirty).toBe(true); // dirty 保持，无数据损失

    // 终态落定 → New 可重试；无 pending 时 dirty 确认照常进行
    let discardCalls = 0;
    const retry = await newDocumentFlow(session, async () => {
      discardCalls += 1;
      return true;
    });
    expect(retry).toEqual({ kind: "ok" });
    expect(discardCalls).toBe(1);
    expect(session.document.document.nodes.length).toBe(0); // 已替换为空文档
  }, 10_000);

  it("T4：Save As 提交挂起 + ordinary 排队：New 同样被 gate（pending 覆盖 save-as 链）", async () => {
    const fake = new FakeFilePort();
    const session = new DocumentSession(emptyDocument());
    edit(session, "n1");
    fake.nextSaveDialog = "/docs/first.json";
    const port = new GatedFilePort(fake);
    const gate = deferred();
    port.holdNextCommit(gate.promise);

    const first = saveAsFlow(session, { filePort: port }, "未命名.json");
    await vi.waitFor(() => expect(port.commits.length).toBe(1));
    const second = saveFlow(session, { filePort: port }); // 无 handle → 排队（非弹 Save As）
    expect(session.queuedSaveCount).toBe(1);

    const newResult = await newDocumentFlow(session, async () => true);
    expect(newResult).toMatchObject({ kind: "error", code: "SAVE_IN_PROGRESS" });
    expect(session.hasInFlightSave).toBe(true);

    gate.release();
    expect(await first).toMatchObject({ kind: "ok" });
    expect(await hangDetection(second)).toMatchObject({ kind: "ok" });
    expect(session.queuedSaveCount).toBe(0);
    expect(session.isDirty).toBe(false);
  }, 10_000);

  it("T5：pending 时 Open 不打开文件对话框（前置 gate）", async () => {
    const fake = new FakeFilePort();
    const session = await openedSession(fake);
    edit(session, "n1");
    const port = new GatedFilePort(fake);
    const gate = deferred();
    port.holdNextCommit(gate.promise);
    const saving = saveFlow(session, { filePort: port });
    await vi.waitFor(() => expect(port.commits.length).toBe(1)); // in-flight pending

    fake.nextOpenDialog = "/docs/other.json";
    const r = await openDocumentFlow(session, { filePort: port });
    expect(r).toMatchObject({ kind: "error", code: "SAVE_IN_PROGRESS" });
    expect(fake.openDialogCalls).toBe(0); // ★ 对话框未弹出
    expect(session.displayPath).toBe("/docs/a.json");

    gate.release();
    expect(await saving).toMatchObject({ kind: "ok" });
  }, 10_000);

  it("T7：launch openPathFlow 在 pending 时 fail closed：不发起读取、不替换文档", async () => {
    const fake = new FakeFilePort();
    const session = await openedSession(fake, "/docs/a.json");
    edit(session, "n1");
    fake.writeFile("/docs/b.json", encodeDocument(emptyDocument()));
    const port = new GatedFilePort(fake);
    const gate = deferred();
    port.holdNextCommit(gate.promise);
    const saving = saveFlow(session, { filePort: port });
    await vi.waitFor(() => expect(port.commits.length).toBe(1)); // in-flight pending

    const r = await openPathFlow(session, { filePort: port }, "/docs/b.json");
    expect(r).toMatchObject({ kind: "error", code: "SAVE_IN_PROGRESS" });
    expect(port.openPathCalls).toBe(0); // ★ 读取未发起
    expect(session.displayPath).toBe("/docs/a.json");
    expect(session.isDirty).toBe(true);

    gate.release();
    expect(await saving).toMatchObject({ kind: "ok" });
    expect(session.displayPath).toBe("/docs/a.json");
  }, 10_000);
});

describe("统一「存储为…」流程（OFR-2026-09-15 出口合并，PRD §8.2）", () => {
  it("选 .mindmap：文档另存提交并签发新 handle", async () => {
    const port = new FakeFilePort();
    port.nextSaveDialog = "/out/方案v2.mindmap";
    const session = new DocumentSession(emptyDocument());
    session.commit({
      kind: "CreateNode",
      id: "n1",
      text: "根",
      position: { x: 0, y: 0 },
      size: { width: 10, height: 10 },
    });
    const result = await unifiedSaveFlow(session, { filePort: port, renderer: okRenderer() });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok" || result.format !== "mindmap") throw new Error("应走文档路由");
    expect(result.receipt.displayPath).toBe("/out/方案v2.mindmap");
    expect(port.files.has("/out/方案v2.mindmap")).toBe(true);
    expect(session.displayPath).toBe("/out/方案v2.mindmap"); // 绑定新目标
  });

  it("选导出格式且文档从未保存：导出落盘 + 自动补写同名 .mindmap 并绑定", async () => {
    const port = new FakeFilePort();
    port.nextSaveDialog = "/out/分享.svg";
    const session = new DocumentSession(emptyDocument());
    const result = await unifiedSaveFlow(session, { filePort: port, renderer: okRenderer() });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok" || result.format === "mindmap") throw new Error("应走导出路由");
    expect(result.exportPath).toBe("/out/分享.svg");
    expect(result.backupPath).toBe("/out/分享.mindmap");
    expect(port.files.has("/out/分享.mindmap")).toBe(true); // 源文件兜底
    // 绑定后 ⌘S 原地保存到该源文件（ordinary，不再弹对话框）
    const callsBefore = port.saveDialogCalls;
    const again = await saveFlow(session, { filePort: port });
    expect(again.kind).toBe("ok");
    expect(port.saveDialogCalls).toBe(callsBefore);
  });

  it("选导出格式且文档已保存：仅导出，不产生兜底文件", async () => {
    const port = new FakeFilePort();
    const session = new DocumentSession(emptyDocument());
    port.nextSaveDialog = "/out/源.mindmap";
    await saveAsFlow(session, { filePort: port }, "源.mindmap"); // 先保存过
    port.nextSaveDialog = "/out/图.pdf";
    const result = await unifiedSaveFlow(session, { filePort: port, renderer: okRenderer() });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok" || result.format === "mindmap") throw new Error("应走导出路由");
    expect(result.backupPath).toBeUndefined();
    expect(port.files.has("/out/图.mindmap")).toBe(false);
    expect(port.files.has("/out/图.pdf")).toBe(true);
  });

  it("Graph JSON（.json）：兜底剥离正确（分享.json → 分享.mindmap）", async () => {
    const port = new FakeFilePort();
    port.nextSaveDialog = "/out/分享.json";
    const session = new DocumentSession(emptyDocument());
    const result = await unifiedSaveFlow(session, { filePort: port, renderer: okRenderer() });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok" || result.format === "mindmap") throw new Error("应走导出路由");
    expect(result.backupPath).toBe("/out/分享.mindmap");
  });

  it("取消：零提交零文件", async () => {
    const port = new FakeFilePort();
    port.nextSaveDialog = null;
    const session = new DocumentSession(emptyDocument());
    const result = await unifiedSaveFlow(session, { filePort: port, renderer: okRenderer() });
    expect(result.kind).toBe("cancelled");
    expect(port.files.size).toBe(0);
  });
});
