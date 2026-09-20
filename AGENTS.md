# Mind Map Tool 工程规则

2026-09-20 当前派发更新：`BETA_V032_CANDIDATE_R3 / AWAITING_OWNER_DOGFOOD / G-FINAL_NOT_REQUESTED`。v0.3.2 R2 dogfood 第三批收口（ADR 0019 v1.2.0 续）：① **端口槽位序改为对端锚沿轴坐标升序**（R2 只修了转折 rank，端口仍按边文档序——真实文档创建序≠高度序时中间槽位被占，麻花复现；负责人实机指出「越高的目标出发点逐一往上排」）。端口序+转折序同向配合，扇出零交叉与输入顺序完全解耦（乱序不变性测试锁定）；② **连线拖拽预览改主题主墨色**（RF 默认连接线冷灰蓝 #b1b1b7 在暖色画布上观感为「蓝闪」）。dense-300-450 等 golden 再 REGEN（原因：端口序变更）。验证：test:unit 823、export golden 18/18、edge-geometry 35/35、typecheck/lint/format 全绿。v0.3.2 R1 dogfood 第二批观感反馈收口（ADR 0019 v1.2.0）：① **整理完成后自适应取景**（fitView padding 0.2 duration 400，整理动画 onComplete 触发，治「内容聚左上角、缩放不匹配」）；② **同缝布线 rank 规则改为垂直行程升序**——v1.1.0 根垂直居中暴露 VRA-040 潜伏缺陷：上方组长行程垂直段必穿短程边进入横段（实机复现 4 处「麻花」交叉），新规则扇出默认零交叉；纯横向/纵向行程序与目标锚序一致，行为不变。dense-300-450 / visual-style-v2 / balanced-fanout 三例 golden REGEN 重基线（原因：本规则变更）。验证：test:unit 823、export golden 18/18、edge-geometry 35/35（新增零交叉锁定测试）、typecheck/lint/format 全绿。下一步：重打 macOS 包 → 负责人 dogfood（整理后自动取景 + 扇出线缆观感）→ 通过后 tag v0.3.2 + CI 双平台 → 同事内测。

2026-09-20 历史批次（v0.3.2 R1）：v0.3.1 macOS dogfood 反馈收口：同级 idea 卡多时点整理仍挤成一列（发散方向从未被发现）。负责人批准三项并修（ADR 0019 v1.1.0）：① 整理默认方向横向→**发散**（横向/纵向保留可选，原生菜单初始勾选同步）；② 发散布局**主根垂直居中**（主根列与左右支块对总高度整块居中）；③ 方向选择**应用级偏好持久化**（MM-060 PreferencesPort `layoutDirection` 键，更正 v1.0.0「随文档记忆」与 ADR 0003 的冲突——偏好不入文档）。实现：`organize.ts` 缺省方向与居中偏移、editor-canvas/mindmap-app 默认值、`layout-direction-preferences.ts` 新模块、Rust 菜单初始勾选。验证：typecheck/lint/format/cargo fmt 全绿、test:unit 821+、export golden 18/18（**修复 balanced-fanout 从未入 CASES 的覆盖缺口**并 REGEN 重基线，原因：ADR 0019 v1.1.0 垂直居中改变发散坐标）、integration/visual PASS。版本号 bump 0.3.2（tauri.conf.json）。另修复 v0.3.1 引入的 2 处 pre-existing prettier 漂移（event-command-map.md、rf-stub.tsx）。下一步：重打 macOS 包 → 负责人 dogfood（重点：整理默认发散观感、垂直居中、方向记忆跨重启）→ 通过后 tag v0.3.2 + CI 双平台包 → 同事内测。

2026-09-18 当前派发更新：`BETA_MCP_IN_INSTALLER / DUAL_PLATFORM_V1 / G-FINAL_NOT_REQUESTED`。负责人决定：放弃 Apple 渠道发行（无凭据且不愿投入），软件以 **MIT 完全开源免费**发布到本人 GitHub（ADR 0016）；**Windows 进入首发**（ADR 0017，双平台同批，含降级阀门）；公开发布推迟到 Agent 无头导出就绪后（ADR 0014 已落地 + ADR 0015）。2026-09-18 新增：同事内测要求「装安装包 → Agent 读文档即可接入 MCP」，**ADR 0018 落地**——MCP 编译为 esbuild 单文件（字体/WASM 内嵌）+ pinned Node 24.21.0 独立运行时随安装包分发（`mcp/` 目录，staging 含真实握手冒烟，CI 双平台与本地 `bundle:tauri` 前强制执行）；Windows 快捷键显示已平台化（6d61d33，负责人 Windows dogfood 修复项）。**2026-09-18 晚内测批次（已 tag `v0.3.0`）**：框选修复（左键拖空白=框选、滚轮=平移、⌘/Ctrl+滚轮=缩放；Windows 左键平移已评估否决，见 event-command-map 已否决项）+ 双侧连线与发散整理方向（ADR 0019）+ 层级深度调色板与四级镜像描边卡（ADR 0020，两轮原型定稿）+ 选中橙色高亮 + 来路能量脉冲；安装包预算 25MB→100MB（ADR 0006 v1.2.0，对齐 ADR 0018 MCP 运行时实测 75.3MB）。下一步：负责人/同事内测 v0.3.0 包 → 反馈收口 → 双平台候选冻结 + 窄门重验 → GitHub Release（签名/公证/上传/push/公开发布仍为逐项授权红线）。注意：`tauri.conf.json` version 字段未随 tag 递增（v0.3.0 包内仍显示 0.1.0），下次发版先把版本号 bump 纳入发布流程。

## 项目阶段

当前处于发布前首次实用返修阶段：G0/G1 已于 2026-08-26、G2 已于 2026-09-08 由项目负责人批准；G-FINAL 尚未申请。技术栈与四格式导出不变，但 2026-09-12 dogfood 已由负责人以确定性运行时崩溃和命令可发现性/视觉偏差为由拒绝。运行时根因修复已提交；下一步先收口“启动干净”与“整理可发现”的产品界面，再构建新的本机试用件。不得把自动测试通过等同于 dogfood 完成。

会影响体积、性能、数据兼容性或长期维护成本的决策，必须先写入 `docs/decisions/`，再进入实现。当前任务派发以 2026-09-07 PRR 批次为准，见 `docs/planning/README.md`、[终审整改开发指南](./docs/planning/pre-release-remediation-development-guide-2026-09-07.md) 与 [终审整改任务卡](./docs/planning/pre-release-remediation-task-cards-2026-09-07.md)。

## 执行与验收补充

- 文档、计划与回报使用中文；代码、命令、路径及技术标识使用英文。
- 阅读顺序：本文件 → `docs/product/v1-product-spec.md` → `docs/planning/README.md` 及当前 PRR 指南/整卡 → Accepted ADR。历史 MM/VRA 卡不能代替当前派发入口。
- 派发必须包含整卡的允许修改路径、STOP/BLOCKED 与 Risk IDs；越界先回报，不自行扩权。
- 回报格式：`状态；修改文件；关键决定；验证命令及结果；未运行项/原因；风险/阻塞；下一卡输入`。
- 质量门发现缺陷后修复责任模块并完整重跑受影响的验收门，不只重跑失败用例。
- 依赖方向：平台无关 `packages/core` ← `packages/ui` / `packages/platform` ← `apps/desktop`；core 禁依赖 React、窗口和 OS API，桌面入口只做组合。
- schema/文件格式、生产 UI 重构、新运行时依赖须遵守当前卡 Gate；签名、公证、上传及公开发布须另行授权。现行 Gate 状态以本文件页首及决定登记为准。

## 工程原则

1. 领域逻辑与桌面框架隔离：脑图数据、编辑命令、布局规则不得依赖窗口或操作系统 API。
2. 跨平台行为默认一致：macOS 与 Windows 的差异只允许进入平台适配层。
3. 本地优先：除非产品规格明确要求，不引入账号、云服务、遥测或联网依赖。
4. 最小必要依赖：新增运行时依赖必须说明用途、包体影响、许可证和替代方案。
5. 先修根因：不得通过关闭校验、跳过测试或吞掉错误来换取表面可运行。
6. 规格先于实现：产品边界写入 `docs/product/`，架构决策写入 `docs/decisions/`，代码必须与两者一致。

## 目录约定

| 路径                 | 职责                                                                              | 维护要求                                              |
| -------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `apps/desktop/`      | 桌面应用入口、窗口生命周期、打包装配                                              | 只负责组合，不承载可复用领域规则                      |
| `packages/core/`     | 脑图模型、编辑命令、布局与序列化契约                                              | 保持平台无关，并优先覆盖单元测试                      |
| `packages/export/`   | 共享文本布局、ExportScene、语义 SVG 与获选 renderer（web-ts-wasm 唯一拥有三格式） | 不读取 React DOM；MM-040 起承载导出实现与 golden 契约 |
| `packages/ui/`       | 视觉组件、交互状态和画布呈现                                                      | 不直接调用操作系统 API                                |
| `packages/platform/` | 文件系统、剪贴板、快捷键、窗口等平台适配                                          | 显式记录 macOS/Windows 差异                           |
| `tests/`             | 跨模块集成、端到端和验收测试                                                      | 测试结构随正式技术栈细化                              |
| `docs/product/`      | 用户问题、范围、非目标和验收标准                                                  | 产品边界变化时先更新                                  |
| `docs/planning/`     | 尚待 Gate 决定的架构提案、开发指导和可分派任务卡                                  | 只镜像已审定规划；技术决定仍以 Accepted ADR 为准      |
| `docs/architecture/` | 当前系统结构和数据流说明                                                          | 只描述已经采纳的架构                                  |
| `docs/decisions/`    | 不可轻易逆转的技术决策记录                                                        | 使用 ADR 模板，状态清晰可追溯                         |
| `docs/quality/`      | 性能、可访问性、兼容性与发布门槛                                                  | 指标确定后写成可验证标准                              |
| `docs/guides/`       | 随产品分发的用户/集成指南（如 Agent MCP 接入）                                    | 面向最终读者；与代码契约同步更新，发布前复核          |
| `assets/`            | 受版本控制的图标、字体和示例资源                                                  | 必须记录来源和许可证                                  |
| `scripts/`           | 构建、检查和开发辅助脚本                                                          | 脚本应可重复执行且不藏业务逻辑                        |
| `.omx/`              | 深度访谈、规划共识、审查与哈希记录                                                | 作为审计来源保留；不把未批准建议冒充 Accepted 决定    |

## 命名与放置

- 目录和普通文件使用 `kebab-case`；语言或框架强制约定优先。
- 源文件名表达单一职责，避免 `utils`、`common` 等无边界容器。
- 测试与被测模块同名；单元测试可与源码相邻，跨模块测试进入 `tests/`。
- 共享代码只有在出现两个真实消费者后才抽取，禁止提前建立杂项公共层。
- 生成文件只进入工具约定的输出目录，不手工修改，也不提交到版本库，除非发布流程明确要求。
- `docs/` 中的规划交付镜像与 `.omx/plans/ralplan-consensus-*.json` 所指向的审定快照不一致时，必须停止派发并先重新完成规划审阅；不得静默择一。

## 修改流程

1. 先阅读本文件及目标目录的 `README.md`。
2. 涉及产品范围时，先更新 `docs/product/`；涉及关键架构取舍时，先新增或更新 ADR。
3. 做最小必要修改，不夹带无关重构。
4. 添加与风险相称的测试，并运行项目定义的格式化、静态检查、测试和构建命令。
5. macOS/Windows 行为可能分叉时，至少提供两个平台的验证说明；无法实机验证时明确标记缺口。

技术栈已确定（G1，2026-08-26）。标准命令以根 `README.md` 为唯一来源（`pnpm typecheck` / `lint` / `test:unit` / `build` / `quality` 等）；文档类任务的最低验证项仍是文档结构与链接完整性（`git diff --check`）。

## 清理周期与责任

- 每次变更的作者负责同步相关文档、测试与 ADR。
- 临时文件放在被忽略的 `.tmp/`，当前任务结束前清理；不得散落在源码目录。
- 构建产物、覆盖率报告和日志由脚本生成并保持未跟踪；发布完成后即可重新生成，不作为知识源。
- **清理禁区**：`.tmp/runtime-spike/` 被 `docs/decisions/decision-register.json` 的 G1 冻结哈希按字节引用，删除即破坏 verify-decision 验收门（2026-09-15 事故）；任何 `.tmp` 清理前先 `grep -rn "\.tmp/" docs/decisions/ tests/` 确认无引用。
- 每个里程碑结束时由项目维护者审查过期 ADR、无主资源、废弃依赖和失效文档链接。
- 项目负责人决定产品范围、数据兼容承诺和发布策略；实现者可自主处理不改变这些边界的局部技术细节。

## 安全与数据

- 密钥、token、密码、个人数据和真实用户脑图不得进入仓库、日志或测试夹具。
- 示例数据必须为合成数据。
- 文件格式一旦对外使用，其破坏性变更必须有迁移方案和 ADR。
- 任何遥测、崩溃上报或云同步能力都必须在产品规格中显式获批，并默认尊重最小数据原则。
