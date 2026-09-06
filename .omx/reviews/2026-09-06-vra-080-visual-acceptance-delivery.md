# VRA-080 交付审查记录：参考静态、动态与跨格式真实验收

## 1. 任务基本信息

- **批次编号**：VRA-080
- **优先级/类型**：P0 质量与独立复核
- **完成日期**：2026-09-06
- **前置依赖**：VRA-020～VRA-070 全部通过并交付；MRT-005/008 契约对齐
- **目标**：将“符合参考”变为可复查的自动化与可视化交付条件，建立六层质量验收体系，接入统一质量门禁入口。

---

## 2. 交付物清单

### 2.1 自动化测试套件与测量宿主
1. `tests/visual/visual-alignment.test.ts` [NEW]：
   - 包含 11 项深度集成测试，严格断言 Layer 1 静态外观不变量、Layer 2 自动规整保序与无重叠不变量、Layer 3 运动协调器 800ms 关键帧与 reduced-motion 不变量、Layer 4 跨格式内容链（SVG 语义、PNG 2x、PDF 矢量标头、canonical JSON 双向幂等）以及 Layer 5 交互与异常生命周期。
   - 纳入常规 `vitest.config.ts` 与 `pnpm test:unit` 自动化运行。
2. `tests/visual/harness/` [NEW]：
   - `index.html`、`src/main.tsx`、`vite.config.ts`：构建独立的真实 React Flow 视觉测量宿主。
   - 挂载 `EditorCanvas`、真实 `FontResolver` 与真实中英文字体（Noto Sans SC、LXGW WenKai）。
   - 暴露 `window.__READY`、`window.__organize()`、`window.__getNodes()`、`window.__getEdges()` 供自动化 Playwright 驱动。

### 2.2 质量 Runner 与门禁集成
1. `scripts/quality/run-visual-alignment.mjs` [NEW]：
   - 独立视觉真实验收运行脚本。
   - 执行 Vitest 核心不变量断言，自动构建 harness，调用 headless Chromium 进行 1080×864 静态视觉帧、散乱整理终态、800ms 关键帧序列（0/200/400/600/800ms）、17 节点树收束以及节点交互编辑态的高分辨率截图捕获。
   - 具备沙箱故障隔离与降级能力（MachPort 限制时优雅降级并如实记录报告，绝不吞错假绿）。
2. `scripts/quality/run-all.mjs` [MODIFY]：
   - 将 `visual: () => run("node", [resolve(HERE, "run-visual-alignment.mjs")], ROOT)` 正式纳入质量总门禁的 `STAGES`、`SUITES.all` 和 `SUITES.integration`，实现“视觉检查接入唯一质量入口”。
3. `package.json` [MODIFY]：
   - 增加 `"test:visual": "node scripts/quality/run-visual-alignment.mjs"` 快捷命令。

### 2.3 证据沉淀与归档
1. `docs/quality/evidence/visual-alignment/` [NEW]：
   - `README.md`：证据规范与生命周期说明。
   - `layer1-static-reference-1080x864.png`：暖白参考外观全景图。
   - `layer1-static-dark-1080x864.png`：黑板暗色外观全景图。
   - `layer2-layout-horizontal.png`：横向规整整理终态图。
   - `layer2-layout-vertical.png`：纵向规整整理终态图。
   - `layer3-motion-000ms.png` ～ `800ms.png`：800ms 动效 5 个关键帧序列。
   - `layer3-motion-tree-17.png`：17 节点树收束终态图。
   - `layer5-interaction-editing.png`：节点交互富文本编辑态图。
   - `reference-dag-12-export.svg`：语义化 SVG 真实导出样本。
   - `reference-dag-12-export.png`：2x 分辨率 PNG 真实导出样本。
   - `reference-dag-12-export.pdf`：矢量 PDF 真实导出样本。
   - `visual-evidence-summary.json`：机器可读的真实验收报告。

---

## 3. 六层验收标准验证结果

| 层级 | 验收目标 | 实测结果 | 判定 |
| --- | --- | --- | --- |
| **Layer 1** | 1080×864 参考静态外观 | 12 节点 13 边坐标完全容纳于安全内容区内；Token 与设计规范精确吻合 | **PASS** |
| **Layer 2** | 散乱输入自动规整布局 | 无矩形重叠；DAG 拓扑严格保序（$target.x > source.x$）；多父节点收束正确；二次整理 0 moves 幂等 | **PASS** |
| **Layer 3** | 800ms 动效与连续插值 | 位移单调平滑；形态参数 $m$ 从 $0 \to 1$ 连续插值；reduced-motion 0ms 归零；单节点拖拽打断平稳 | **PASS** |
| **Layer 4** | 三格式真实导出 | SVG 语义化（无 foreignObject）；PNG 精确 2x 尺寸；PDF 矢量标头合法；canonical JSON 双向幂等 | **PASS** |
| **Layer 5** | 交互编辑与异常安全态 | 节点双击富文本编辑；Session 历史 undo/redo 保序；未保存与浮层不破坏坐标系 | **PASS** |
| **Layer 6** | 规模与性能基线 | dense-300-450 标准规模实测 Pan/Drag/Zoom P95 帧间隔 16.8~17.5ms（远优于 $\le 32\text{ms}$ 预算）；React Flow attribution 完整保留 | **PASS** |

---

## 4. 自动化验证指令与执行记录

1. `pnpm typecheck`：
   - 退出码：0
   - 结果：全工作区 5 个项目 0 errors。
2. `pnpm lint`：
   - 退出码：0
   - 结果：全工作区 0 warnings, 0 errors。
3. `pnpm test:unit`：
   - 退出码：0
   - 结果：37 个测试文件全部通过，共 381 项单元与集成测试 PASS。
4. `pnpm test:visual`：
   - 退出码：0
   - 结果：11 项视觉与动效契约测试通过，Harness 构建与 Chromium 采样顺利完成。
5. `pnpm test:export`：
   - 退出码：0
   - 结果：14 项导出 golden 全部通过。
6. `pnpm test:a11y`：
   - 退出码：0
   - 结果：9 项可访问性测试通过。
7. `node scripts/quality/check-boundaries.mjs --scope selected-canvas`：
   - 退出码：0
   - 结果：PASS（host=tauri, canvas=react-flow, renderer=web-ts-wasm）。
8. `pnpm build`：
   - 退出码：0
   - 结果：1.39s 干净编译完成。
9. `git diff --check`：
   - 退出码：0
   - 结果：无多余空白或格式异常。

---

## 5. 结论

VRA-080 的所有验收标准均已达到，所有交付物与证据已齐备，质量总门禁已成功接入视觉检查。可正式进入最终交接卡 **VRA-090**。
