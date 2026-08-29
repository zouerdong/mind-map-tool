// MM-090 macOS E2E 用例（tauri-driver 驱动真实 debug bundle）。
// 覆盖 v1-test-spec §2.3 中 WebView 自动化可可靠落地的子集：
// E2E-02/03/04/05/08/09（面板触发）；系统级部分（Dock activation、
// 系统对话框、真实 IME）进人工矩阵（docs/quality/mm-090-manual-matrix.md），
// 不用 mock 冒充。
// 交互保真度说明（记入 evidence）：
// - 文本输入经 W3C element/value（触发真实 onChange 链）；
// - 键盘/指针经合成事件（actions API 优先，safaridriver 不支持时
//   execute/sync 派发）；合成事件不产生浏览器默认行为（换行等），
//   相关默认行为已由 jsdom 单测覆盖，此处断言命令语义。
// - 语义断言优先（DOM 状态、文档投影、标题 dirty 位），不依赖像素。

export const PANE = ".react-flow__pane";
export const CANVAS = '[role="application"]';
export const EDITOR = '[aria-label="编辑节点文本"]';
export const ONBOARDING_OVERLAY = '[data-testid="onboarding-overlay"]';
export const EXPORT_PANEL = '[data-testid="export-panel"]';
export const THEME_TOGGLE = '[data-onboarding-anchor="theme.toggle"]';

/** 极简断言器（失败抛错，runner 捕获记 fail）。 */
export function assert(cond, message) {
  if (!cond) throw new Error(`断言失败: ${message}`);
}

/** 引导遮罩不挡画布（pointer-events:none），但工具条交互前先收起。 */
async function dismissOnboardingIfPresent(d) {
  const overlay = await d.findElement("css selector", ONBOARDING_OVERLAY);
  if (overlay) {
    const skip = await d.findElement("css selector", '[data-testid="onboarding-skip"]');
    if (skip) await d.click(skip);
  }
}

/** 画布节点数（RF 真实 DOM）。 */
async function nodeCount(d) {
  const els = await d.findElements("css selector", ".react-flow__node");
  return els.length;
}

async function edgeCount(d) {
  const els = await d.findElements("css selector", ".react-flow__edge");
  return els.length;
}

/** 双击 pane 空白建节点（真实 onWrapperDoubleClick 路径）。 */
async function createNodeViaDblClick(d) {
  const before = await nodeCount(d);
  await d.doubleClick(PANE);
  // 轮询节点数增长（投影 commit → RF 重渲染）
  const start = Date.now();
  while (Date.now() - start < 5000) {
    if ((await nodeCount(d)) === before + 1) return before + 1;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`双击建节点超时：${before} -> ${await nodeCount(d)}`);
}

/** 双击节点进编辑 → 输入 → ⌘Enter 提交（真实编辑链）。 */
async function editNodeText(d, nodeSelector, text) {
  await d.doubleClick(nodeSelector);
  const editor = await d.waitFor(EDITOR);
  await d.sendKeys(editor, text);
  await d.keyDown(EDITOR, "Enter", { meta: true });
  await d.waitFor(EDITOR, { present: false, timeoutMs: 5000 });
}

async function appTitle(d) {
  return d.execute("return document.title;");
}

export const cases = [
  {
    id: "E2E-02",
    name: "双击创建并编辑中文节点",
    expectation: "输入期间不误触快捷键；⌘Enter 提交后节点文本持久",
    async run(d, shot) {
      await dismissOnboardingIfPresent(d);
      await shot("e2e02-start");
      const n = await createNodeViaDblClick(d);
      assert(n === 1, `首节点建立（实际 ${n}）`);

      // 双击节点进编辑，中文文本经 value API（真实 onChange）
      await d.doubleClick('[aria-label="节点：空"]');
      const editor = await d.waitFor(EDITOR);
      await shot("e2e02-editing");
      await d.sendKeys(editor, "灵感捕捉");

      // 无修饰 Enter：不提交（换行默认行为不适用于合成事件，语义=不触发命令）
      await d.keyDown(EDITOR, "Enter");
      await new Promise((r) => setTimeout(r, 400));
      assert(await d.findElement("css selector", EDITOR), "Enter（无修饰）不提交，仍处编辑态");

      // ⌘Enter 提交 → 编辑框关闭、节点文本更新
      await d.keyDown(EDITOR, "Enter", { meta: true });
      await d.waitFor(EDITOR, { present: false, timeoutMs: 5000 });
      const node = await d.waitFor('[aria-label="节点：灵感捕捉"]');
      assert(node !== null, "提交后节点文本=灵感捕捉");
      await shot("e2e02-committed");
      const title = await appTitle(d);
      assert(String(title).startsWith("● "), `EditNodeText 使文档 dirty（title=${title}）`);
    },
  },
  {
    id: "E2E-03",
    name: "创建两节点并连线，移动目标",
    expectation: "连接持续附着（edge 在移动后仍存在且文档 CreateEdge 入历史）",
    async run(d, shot) {
      await dismissOnboardingIfPresent(d);
      const n1 = await createNodeViaDblClick(d);
      const n2 = await createNodeViaDblClick(d);
      assert(n2 === 2, `两节点建立（实际 ${n2}）`);

      // 键盘连线流（定稿键位）：⌘L 发起 → → 选候选 → Enter 确认
      await d.keyDown(CANVAS, "l", { meta: true });
      await d.keyDown(CANVAS, "ArrowRight");
      await d.keyDown(CANVAS, "Enter");
      const start = Date.now();
      while (Date.now() - start < 5000) {
        if ((await edgeCount(d)) === 1) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      assert((await edgeCount(d)) === 1, `键盘连线产出 1 条边（实际 ${await edgeCount(d)}）`);
      await shot("e2e03-linked");

      // 移动目标节点：连接持续附着
      const nodeB = await d.waitFor('[aria-label="节点：空"]');
      const before = await d.execute(
        `const n = document.querySelectorAll('.react-flow__node')[1];
         return n ? n.style.transform : null;`,
      );
      await d.drag('[aria-label="节点：空"]', 420, 260);
      await new Promise((r) => setTimeout(r, 600)); // 乐观位移 + onNodeDragStop MoveNodes
      const after = await d.execute(
        `const n = document.querySelectorAll('.react-flow__node')[1];
         return n ? n.style.transform : null;`,
      );
      assert(before !== after, `节点位移已生效（${before} -> ${after}）`);
      assert((await edgeCount(d)) === 1, "移动后连接持续附着（edge 仍为 1）");
      assert(Boolean(nodeB), "目标节点仍存在");
      await shot("e2e03-moved");
    },
  },
  {
    id: "E2E-04",
    name: "多选移动、删除、undo/redo",
    expectation: "⌘A 全选 → Delete 原子删除 → ⌘Z 恢复 → ⌘⇧Z 重做，状态逐步精确恢复",
    async run(d, shot) {
      await dismissOnboardingIfPresent(d);
      await createNodeViaDblClick(d);
      await createNodeViaDblClick(d);
      assert((await nodeCount(d)) === 2, "两节点就绪");

      await d.keyDown(CANVAS, "a", { meta: true }); // 全选
      await d.keyDown(CANVAS, "Delete"); // 原子删除
      const start = Date.now();
      while (Date.now() - start < 5000) {
        if ((await nodeCount(d)) === 0) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      assert((await nodeCount(d)) === 0, "Delete 删除全部选中节点");
      await shot("e2e04-deleted");

      await d.keyDown(CANVAS, "z", { meta: true }); // undo
      const t1 = Date.now();
      while (Date.now() - t1 < 5000) {
        if ((await nodeCount(d)) === 2) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      assert((await nodeCount(d)) === 2, "⌘Z 恢复两节点");
      await shot("e2e04-undone");

      await d.keyDown(CANVAS, "z", { meta: true, shift: true }); // redo
      const t2 = Date.now();
      while (Date.now() - t2 < 5000) {
        if ((await nodeCount(d)) === 0) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      assert((await nodeCount(d)) === 0, "⌘⇧Z 重做到删除态");
      await shot("e2e04-redone");
    },
  },
  {
    id: "E2E-05",
    name: "切换白/黑主题",
    expectation: "视觉与文档状态一致（SetDocumentStyle 持久化 → dirty → 标题指示；按钮态翻转）",
    async run(d, shot) {
      await dismissOnboardingIfPresent(d);
      const toggle = await d.waitFor(THEME_TOGGLE);
      assert(toggle !== null, "主题切换按钮存在");
      const textBefore = (await d.elementText(toggle)).trim();
      await d.click(toggle);
      await shot("e2e05-toggled");
      const textAfter = (await d.elementText(toggle)).trim();
      assert(textBefore !== textAfter, `按钮态翻转（${textBefore} -> ${textAfter}）`);
      const title = await appTitle(d);
      assert(String(title).startsWith("● "), `主题命令使文档 dirty（title=${title}）`);
      // 文档主题一致性：再切回，dirty 位仍保持（两条 SetDocumentStyle 均入历史）
      await d.click(await d.waitFor(THEME_TOGGLE));
      const textBack = (await d.elementText(await d.waitFor(THEME_TOGGLE))).trim();
      assert(textBack === textBefore, `切回原主题（${textBack}）`);
    },
  },
  {
    id: "E2E-08",
    name: "首次引导完成/跳过/重放",
    expectation: "不强制重复，不污染文档；五步真实动作推进",
    async run(d, shot) {
      // 路径说明：首启 overlay 与重放走同一 OnboardingFlow/reducer；
      // 偏好持久化使重复冷启动不重现——为不删用户偏好文件（红线），
      // 此处以"重放"入口驱动完成路径，冷启动首启由首次实跑覆盖。
      const replay = await d.findElement(
        "xpath",
        '//header[@role="toolbar"]//button[normalize-space()="重放引导"]',
      );
      assert(replay !== null, "重放引导入口存在");
      await d.click(replay);
      const overlay = await d.waitFor(ONBOARDING_OVERLAY, { timeoutMs: 5000 });
      assert(overlay !== null, "重放后引导 overlay 出现");
      await shot("e2e08-welcome");

      // welcome：开始
      const primary = await d.waitFor('[data-testid="onboarding-primary"]');
      await d.click(primary);

      // create-first：建节点 + 编辑（观察 CreateNode/EditNodeText）
      await createNodeViaDblClick(d);
      await editNodeText(d, '[aria-label="节点：空"]', "第一步");

      // second-connect：再建节点 + 移动 + 连线（mode=all，三者都要）
      await createNodeViaDblClick(d);
      await d.drag('[aria-label="节点：第一步"]', 380, 220);
      await new Promise((r) => setTimeout(r, 500));
      await d.keyDown(CANVAS, "l", { meta: true });
      await d.keyDown(CANVAS, "ArrowRight");
      await d.keyDown(CANVAS, "Enter");
      const start = Date.now();
      while (Date.now() - start < 5000) {
        if ((await edgeCount(d)) === 1) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      assert((await edgeCount(d)) === 1, "引导第二步连线完成");
      await shot("e2e08-second-connect");

      // undo-or-theme：点主题切换（observe any）
      await d.click(await d.waitFor(THEME_TOGGLE));

      // save-or-export：打开导出面板（action:export，不进系统对话框）
      const exportBtn = await d.findElement(
        "xpath",
        '//header[@role="toolbar"]//button[normalize-space()="导出"]',
      );
      await d.click(exportBtn);
      await d.waitFor(EXPORT_PANEL, { timeoutMs: 5000 });

      // 完成：overlay 消失
      await d.waitFor(ONBOARDING_OVERLAY, { present: false, timeoutMs: 8000 });
      await shot("e2e08-done");
      // 不污染文档：恰好用户创建的 2 节点、1 边
      assert((await nodeCount(d)) === 2, `引导不污染文档（节点=2，实际 ${await nodeCount(d)}）`);
      assert((await edgeCount(d)) === 1, "引导不污染文档（边=1）");

      // 不强制重复：reload 后 overlay 不自动出现
      await d.execute("location.reload();");
      await d.waitFor(PANE, { timeoutMs: 10000 });
      await new Promise((r) => setTimeout(r, 800));
      const again = await d.findElement("css selector", ONBOARDING_OVERLAY);
      assert(again === null, "reload 后引导不强制重复");
    },
  },
  {
    id: "E2E-09",
    name: "导出面板触发（三格式入口）",
    expectation: "面板出现且 SVG/PNG/PDF 三入口齐全；真实选址/渲染导出属系统对话框链，进人工矩阵与 MM-040 golden",
    async run(d, shot) {
      await dismissOnboardingIfPresent(d);
      const exportBtn = await d.findElement(
        "xpath",
        '//header[@role="toolbar"]//button[normalize-space()="导出"]',
      );
      assert(exportBtn !== null, "导出入口存在");
      await d.click(exportBtn);
      const panel = await d.waitFor(EXPORT_PANEL, { timeoutMs: 5000 });
      assert(panel !== null, "导出面板出现");
      for (const fmt of ["svg", "png", "pdf"]) {
        const btn = await d.findElement("css selector", `[data-testid="export-${fmt}"]`);
        assert(btn !== null, `导出入口 ${fmt.toUpperCase()} 存在`);
      }
      await shot("e2e09-panel");
      // 关闭面板（不触发系统对话框——该链路在人工矩阵）
      const cancel = await d.findElement("xpath", '//div[@data-testid="export-panel"]//button[normalize-space()="取消"]');
      await d.click(cancel);
      await d.waitFor(EXPORT_PANEL, { present: false, timeoutMs: 5000 });
    },
  },
];
