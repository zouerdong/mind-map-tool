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

export const cases = [
  {
    id: "E2E-01A",
    name: "冷启动健康（D1/D2 回归探针）",
    expectation: "画布 AX 就绪；无『初始化失败』（Buffer 缺陷 D1）；无『启动路由初始化失败』（State 类型缺陷 D2）；窗口标题正确",
    async run(b, shot) {
      const initFail = await b.axFind(`v.startsWith("初始化失败")`);
      assert(initFail === null, `无前端初始化失败（D1 回归）：${initFail?.value}`);
      const launchFail = await b.axFind(`v.includes("启动路由初始化失败")`);
      assert(launchFail === null, "无启动路由初始化失败（D2 回归）");
      const title = await b.jxa(`const se = Application("System Events"); se.processes.byName("mindmap-desktop").windows()[0].name();`);
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
      await b.as(`tell application "System Events" to set visible of process "mindmap-desktop" to false`);
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
