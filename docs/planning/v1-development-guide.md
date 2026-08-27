# V1 开发指导

> 状态：Ralplan 规划共识已完成；产品尚未实现，G0/G1/G2 均未批准。

## 1. 交付结论

第一版是 macOS 与 Windows 本地桌面自由脑图工具：打开即空白画布，节点可在任意位置创建、移动和自由连接，支持白板/黑板、交互式首次引导、本地原生文件与 SVG/2x PNG/PDF 导出。

第一版明确没有账号、云同步、协作、AI、富媒体、自动树形布局、服务器后端、远程 API、遥测或广告。规划也没有授权安装正式依赖、签名、公证、凭据访问、上传 GitHub 或公开发布。

详细基线：

- [产品规格](../product/v1-product-spec.md)
- [架构提案](./v1-architecture-proposal.md)
- [测试规格](../quality/v1-test-spec.md)
- [风险登记册](../quality/v1-risk-register.md)
- [任务卡](./v1-task-cards.md)
- [机器决策模板](../decisions/decision-register-template.json)
- [Ralplan 共识记录](../../.omx/plans/ralplan-consensus-minimal-mind-map-tool.json)

## 2. 技术方向，不是既定选型

当前优先验证 Tauri 2 + React/TypeScript + 获选 React 画布视图；Electron 是可真实胜出的降级候选。React Flow 只作为画布候选，不能绑定 core、文件或导出；TS/WASM 与 native export renderer 也必须独立比较。

四条轨道分别是 `desktopHost`、`canvasView`、`exportRenderer`、`font`。只有 PASS 且证据完整的候选可被推荐；某轨全部失败时必须 `blocked/recommended=null`，不得为了继续开发而选择“分数最高的失败项”。

## 3. 决策门

| Gate | 用户批准内容 | 允许进入 | 不包含 |
| --- | --- | --- | --- |
| G0 | 本地 Spike、macOS/Windows 设备与 OS、实验红线 | MM-010 | 正式技术选型、产品实现、发布 |
| G1 | 冻结 Spike 哈希、四轨 PASS 候选、ADR digest、schema/平台/预算/标识等 | MM-020 及实现卡 | 签名、发布或越界修改 |
| G2 | 法律/许可、获选安装器、unsigned 候选路径、安装目标、允许动作和删除边界 | MM-100 | test-signing、签名、公证、凭据、系统信任、上传、公开发布 |

验证器必须使用对应 profile：MM-010 用 `spike-result`，MM-020 用 `bootstrap`，MM-100 用 `packaging`。未来 Gate 的 pending 不得阻断前一阶段；当前 Gate 缺证据必须 fail-closed。

## 4. 执行顺序

```text
MM-000 G0
  -> MM-010 Spike -> MM-000 G1 -> MM-020 Bootstrap -> MM-030 Core
MM-030 -> MM-040 Export/Layout -> MM-050 Canvas -> MM-070 Theme/Onboarding --+
MM-030 -> MM-060 Platform/File/Lifecycle ------------------------------------+-> MM-080
MM-040 + MM-060 -> [native only] MM-045 ------------------------------------+
MM-080 -> MM-085 Organize -> MM-088 GlobalShortcut -> MM-089 Keyboard -> MM-090 QA -> MM-000 G2 -> MM-100 Unsigned Packaging -> MM-110 Review
```

MM-040 与 MM-060 可并行。MM-045 只有 native renderer 获选时激活；否则记 `NOT_ACTIVATED`，不算已执行任务。MM-090 发现缺陷后必须回到责任卡，修复后完整重跑，不允许只复跑失败用例。

## 5. 任务卡索引

| 卡片 | 职责 |
| --- | --- |
| MM-000 | 固化产品/ADR，并维护 G0/G1/G2 决策登记 |
| MM-010 | 双平台 host、画布、renderer、字体 Spike |
| MM-020 | 获批后的仓库工具链与空桌面骨架 |
| MM-030 | schema、canonical encoding、commands、history、DocumentSession |
| MM-040 | 共享布局、semantic SVG 与获选导出分支 |
| MM-045 | 条件卡：native PNG/PDF renderer |
| MM-050 | 获选 React 画布视图与编辑交互 |
| MM-060 | 原生文件、授权 capability、原子提交与 LaunchRouter |
| MM-070 | 白/黑主题与交互式首次引导 |
| MM-080 | 桌面应用组合、菜单、快捷键、保存/导出闭环 |
| MM-085 | 一键整理（垂直树布局，单条可撤销命令 + 过渡动画）[from-user 2026-08-27] |
| MM-088 | 全局唤醒热键（随手唤出画布）[from-user 2026-08-27] |
| MM-089 | 键盘操作完整性（全流程无鼠标）[from-user 2026-08-27] |
| MM-090 | 自动化 E2E、golden、性能与双平台证据 |
| MM-100 | 精确 G2 范围内的 unsigned 本地候选准备 |
| MM-110 | 独立只读审阅与最终验收 |

完整卡片必须原样分派，不要只复制标题或步骤。Agent 必须先读根 `AGENTS.md`、该卡依赖产物和风险登记册；触发 STOP/BLOCKED 时回报，不得自行扩权。

## 6. 后续交接

当前下一门是 G0。只有项目负责人明确批准 G0 后，才可派发 MM-010；共识完成本身不等于批准任何 Spike 或实现任务。全部实现完成后，应把所有 Agent 回报、双平台原始证据和聚合索引交回 MM-110 的独立审阅流程。
