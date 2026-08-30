// MM-090 macOS E2E 用例（osascript/System Events 路线，真实 app）。
//
// 【覆盖边界——如实声明（2026-08-29 实测本机）】
// 可自动化（本套件）：①AX 树 UI 状态断言（表单元素/landmark 可靠暴露）；
// ②AXPress 按钮点击（AX 通道）；③全局热键"唤醒"分支（hide→⌥Space→唤回）；
// ④app 生命周期（冷启动/错误 notice 回归探针）。
// 不可自动化（本机 TCC 输入注入限制，路由人工矩阵，不以 mock 冒充）：
// - 合成鼠标（CGEventPost HID/Session tap 均被系统过滤——实测点苹果菜单无效）
// - 键盘到 webview（合成 activate/set_focus 不设 key window，keystroke
//   不达 WKWebView；真实用户点击不受影响——单用户实测路径正常）
// - 因此键盘交互链（quick-create/编辑/连线/undo/删除）由 packages/ui 的
//   199 个 jsdom 测试覆盖逻辑 + 人工矩阵 #3 承接真机验证；
// - SVG edge/节点视觉（WebKit AX 懒暴露）→ 人工矩阵。
//
// 交互保真度：AX 通道（System Events）；截图=screencapture 窗口区域。

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function assert(cond, message) {
  if (!cond) throw new Error(`断言失败: ${message}`);
}

const mm090Cases = [
  {
    id: "E2E-01A",
    name: "冷启动健康（D1/D2 回归探针）",
    expectation:
      "画布 AX 就绪；无『初始化失败』（Buffer 缺陷 D1）；无『启动路由初始化失败』（State 类型缺陷 D2）；窗口标题正确",
    async run(b, shot) {
      const initFail = await b.axFind(`v.startsWith("初始化失败")`);
      assert(initFail === null, `无前端初始化失败（D1 回归）：${initFail?.value}`);
      const launchFail = await b.axFind(`v.includes("启动路由初始化失败")`);
      assert(launchFail === null, "无启动路由初始化失败（D2 回归）");
      const title = await b.jxa(
        `const se = Application("System Events"); se.processes.byName("mindmap-desktop").windows()[0].name();`,
      );
      assert(String(title).includes("Mind Map"), `窗口标题正确（${title}）`);
      await shot("e2e01a-healthy");
    },
  },
  {
    id: "E2E-16",
    name: "全局热键唤醒分支（AC-16）",
    expectation: "隐藏 app → ⌥Space（真实系统热键）→ 窗口唤回可见（dispatch 的 show+focus 分支）",
    async run(b, shot) {
      // 画布就绪已由 startAppFresh 保证（避免就绪后立即查询触发 AX 坏会话窗）
      await b.as(
        `tell application "System Events" to set visible of process "mindmap-desktop" to false`,
      );
      await sleep(1000);
      // 隐藏的 AX 可见性判定不稳定（隐藏窗口有时仍可读）；核心断言是唤回
      const hidden = await b.axFind(`d === "脑图画布"`);
      await b.keystroke(" ", { option: true }); // 真实全局热键（系统级截获，不依赖 key window）
      await sleep(1500);
      const back = await b.axFind(`d === "脑图画布"`);
      assert(back !== null, "⌥Space 唤醒画布（show+focus 分支）");
      await shot("e2e16-woken");
    },
  },
];

// ---- MRT-003：原生关闭三分支（真实 Tauri 窗口协议，非 jsdom/beforeunload） ----
// 触发通道：窗口红关闭按钮（System Events AXPress button 1 → 真实
// CloseRequested）与 ⌘Q（应用退出协调）。断言通道：AX 树（modal/按钮/
// 状态指示）+ pgrep 进程存活 + AX 窗口存在性。
// 人工矩阵承接（不可自动化，如实声明）：系统 Save As 对话框（S1/S2/S3/S4
// 的真实保存链）、只读卷/IO 故障注入。

/** 点击窗口红关闭按钮（真实 CloseRequested 事件源）。
 * 事件后 AX 会话有瞬态失败窗（-1708/-1728，close 拦截 + modal 挂载期间），
 * 预留稳定等待再由调用方断言。 */
async function clickCloseButton(b) {
  await b.as(
    'tell application "System Events" to tell process "mindmap-desktop" to click button 1 of window 1',
  );
  await sleep(900);
}

/** AX 窗口是否存在。进程退出 → false；瞬态 -1728 → 重试后仍失败视为
 * 查询不可用，抛错由用例的最终窗口/进程断言裁决（fail closed）。 */
async function windowAlive(b) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await b.as(
        'tell application "System Events" to (exists window 1 of process "mindmap-desktop")',
      );
      return String(r).toLowerCase() === "true";
    } catch {
      await sleep(700);
    }
  }
  throw new Error("windowAlive: AX 查询持续不可用");
}

/** 进程是否存活（pgrep）。 */
async function processAlive(b) {
  const { execFileSync } = await import("node:child_process");
  try {
    execFileSync("pgrep", ["-x", "mindmap-desktop"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** 画布空白处真实双击建一个节点（dirty）。React Flow 节点在 WKWebView
 * 的 AX 树懒暴露（MM-090 已知边界），dirty 判定改用状态指示的 AX value。 */
async function createDirtyNode(b) {
  const frame = await b.windowFrame();
  // 画布区域右下象限空白点（避开中心种子/引导提示）
  const x = Math.round(frame.x + frame.w * 0.72);
  const y = Math.round(frame.y + frame.h * 0.68);
  // 双击位置受窗口实际布局影响（引导层/种子位置），失败换点重试一次
  for (const [fx, fy] of [
    [0.72, 0.68],
    [0.3, 0.75],
  ]) {
    await b.doubleClickAt(Math.round(frame.x + frame.w * fx), Math.round(frame.y + frame.h * fy));
    const dirty = await b
      .axWaitFor(`v.includes("未保存")`, {
        label: "状态指示转为未保存（双击建点 → dirty）",
        timeoutMs: 5000,
      })
      .catch(() => null);
    if (dirty !== null) return;
  }
  throw new Error("双击建点失败：状态指示未转为未保存");
}

const closeCases = [
  {
    id: "E2E-CL1",
    name: "clean 文档原生关闭：无 modal，直接放行（C1）",
    expectation: "点红关闭按钮 → 不出现三分支 modal → 窗口关闭",
    async run(b, shot) {
      await clickCloseButton(b);
      await sleep(1200);
      // 进程随最后窗口退出后 AX 查询抛 -1728——等价于"无 modal"
      let modal = null;
      try {
        modal = await b.axFind(`d === "关闭确认"`);
      } catch {
        modal = null;
      }
      assert(modal === null, "clean 关闭不得弹三分支 modal");
      const alive = await windowAlive(b);
      assert(!alive, "窗口必须真实关闭（无 permit 的放行即二次 close 消费）");
      await shot("e2ecl1-closed");
    },
  },
  {
    id: "E2E-CL2",
    name: "dirty 原生关闭 Cancel：modal 出现，取消后窗口与 dirty 保持（X1）",
    expectation:
      "双击建点（dirty）→ 关闭 → 三分支 modal（三按钮）→ 取消 → 窗口保持、modal 消失、状态仍未保存",
    async run(b, shot) {
      await createDirtyNode(b);
      await clickCloseButton(b);
      const modal = await b.axWaitFor(`d === "关闭确认"`, {
        label: "三分支 modal",
        timeoutMs: 10000,
      });
      assert(modal !== null, "dirty 关闭必须弹三分支 modal");
      for (const label of ["保存并关闭", "不保存并关闭", "取消关闭"]) {
        const btn = await b.axFind(`d === "${label}"`);
        assert(btn !== null, `三分支按钮存在：${label}`);
      }
      await shot("e2ecl2-modal");
      await b.axPress("取消关闭");
      await sleep(800);
      assert(await windowAlive(b), "取消后窗口保持");
      const modalGone = await b.axFind(`d === "关闭确认"`);
      assert(modalGone === null, "取消后 modal 清除");
      const status = await b.axFind(`v.includes("未保存")`);
      assert(status !== null, "dirty 状态保持（零副作用）");
    },
  },
  {
    id: "E2E-CL3",
    name: "dirty 原生关闭 Discard：不写盘，host 撤销 capability 后窗口关闭（D1）",
    expectation: "dirty → 关闭 → modal → 不保存 → 窗口真实关闭（进程随最后窗口退出）",
    async run(b, shot) {
      await createDirtyNode(b);
      await clickCloseButton(b);
      await b.axWaitFor(`d === "关闭确认"`, { label: "三分支 modal", timeoutMs: 10000 });
      await shot("e2ecl3-before-discard");
      await b.axPress("不保存并关闭");
      await sleep(1500);
      const alive = await windowAlive(b);
      assert(!alive, "Discard 后窗口必须真实关闭");
      await shot("e2ecl3-closed");
    },
  },
  {
    id: "E2E-CL4",
    name: "重复点击关闭复用同一请求：不叠第二个 modal（R2 前端）",
    expectation: "dirty → 关闭（modal）→ 再次点关闭按钮 → 仍只有一个 modal → 取消后窗口保持",
    async run(b) {
      await createDirtyNode(b);
      await clickCloseButton(b);
      await b.axWaitFor(`d === "关闭确认"`, { label: "三分支 modal", timeoutMs: 10000 });
      await clickCloseButton(b); // pending 未决时重复 close（host 复用 requestId 不重发）
      await sleep(800);
      const modals = await b.axFindAll(`d === "关闭确认"`);
      assert(modals.length === 1, `重复关闭只保留一个流程（实际 ${modals.length}）`);
      await b.axPress("取消关闭");
      await sleep(800);
      assert(await windowAlive(b), "取消后窗口保持");
    },
  },
  {
    id: "E2E-CL5",
    name: "⌘Q 应用退出协调：Cancel 阻止整次退出，Discard 后完成退出（X2）",
    expectation:
      "dirty → ⌘Q → modal（exit 协调的 close-requested）→ 取消 → app 存活；再 ⌘Q → 不保存 → app 退出",
    async run(b, shot) {
      await createDirtyNode(b);
      await b.keystroke("q", { cmd: true }); // 真实应用退出快捷键 → ExitRequested
      await sleep(900);
      await b.axWaitFor(`d === "关闭确认"`, { label: "退出协调 modal" });
      await shot("e2ecl5-exit-modal");
      await b.axPress("取消关闭");
      await sleep(1200);
      assert(await processAlive(b), "任一窗口取消必须阻止整次应用退出");
      assert(await windowAlive(b), "取消后窗口保持");
      await b.keystroke("q", { cmd: true });
      await sleep(900);
      await b.axWaitFor(`d === "关闭确认"`, { label: "再次退出协调 modal", timeoutMs: 10000 });
      await b.axPress("不保存并关闭");
      await sleep(1800);
      assert(!(await processAlive(b)), "全部窗口许可后应用必须完成退出");
      await shot("e2ecl5-exited");
    },
  },
];

export const closeLifecycleCases = closeCases;

export const cases = [...mm090Cases, ...closeCases];
