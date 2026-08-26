# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 语言约定

文档、规划、任务回报使用中文；代码、命令、路径、变量名和技术标识使用英文。

## 项目现状（首要约束）

仓库处于**产品发现阶段**：工程骨架与 Ralplan 规划共识已完成，但 G0/G1/G2 决策门均未获项目负责人批准，**产品代码尚未开始**。目前没有 `package.json`，不存在任何安装、构建、lint 或测试命令。

在此阶段以下操作一律未授权，遇到即停止并按任务卡 STOP/BLOCKED 规则回报，不得自行扩权：

- 安装正式产品依赖、创建占位实现或桌面骨架（G1 批准前禁止，见 MM-020）
- 派发 MM-010 Spike 或任何实现任务卡（需 G0 批准；规划共识完成≠批准）
- 签名、公证、凭据访问、上传 GitHub、公开发布（G2 范围也不包含这些）

当前唯一合法工作是文档与规划维护。收到"实现某功能"类请求时，先确认对应 Gate 状态，再决定执行还是回报 BLOCKED。

## 权威文档与阅读顺序

1. `AGENTS.md` — 工程规则总纲（目录职责、命名、修改流程、安全红线），本文件不重复其内容，冲突时以它为准
2. `docs/product/v1-product-spec.md` — 产品范围与验收标准（AC-01～AC-14）
3. `docs/planning/v1-development-guide.md` — Gate 定义与执行顺序
4. `docs/planning/v1-task-cards.md` — MM-000～MM-110 任务卡全集
5. `docs/decisions/` — ADR；技术选型只认 `Accepted` 状态

注意：`.omx/` 是深度访谈与规划共识的**审计来源**，不是决定本身；不得把其中未批准的建议冒充 Accepted 决定。`docs/planning/` 镜像与 `.omx/plans/ralplan-consensus-*.json` 指向的审定快照不一致时，停止派发并重新完成规划审阅，不得静默择一。

## 决策门与任务卡体系

执行链：`MM-000(G0) → MM-010 Spike → MM-000(G1) → MM-020 Bootstrap → MM-030 core → (MM-040 ∥ MM-060) → MM-050 → MM-070 → MM-080 → MM-090 → MM-000(G2) → MM-100 → MM-110`。MM-045 是条件卡，仅 export renderer 推荐为 `native-host` 且 G1 批准时激活，否则记 `NOT_ACTIVATED`。

任务卡纪律：

- 分派时必须原样分发整卡（含允许修改路径、STOP/BLOCKED、Risk IDs），不能只复制标题或步骤
- 每卡有明确的**允许修改路径**，越界需求先回报，不顺手改
- 统一回报格式：`状态；修改文件；关键决定；验证命令及结果；未运行项/原因；风险/阻塞；下一卡输入`
- MM-090 发现缺陷后回到责任卡修复，然后**完整重跑**，不允许只复跑失败用例

技术方向（Tauri 2 + React/TypeScript、React Flow 画布、TS/WASM 导出等）是**待验证候选，不是既定选型**。四条评估轨（desktopHost/canvasView/exportRenderer/font）只有 PASS 且证据完整的候选可被推荐；某轨全部失败时该轨与顶层必须 `blocked`、推荐为 `null`，不得选"分数最高的失败项"。decision register 初始即 fail-closed。

## 当前验证命令

技术栈未定，**文档结构与链接完整性是最低验证项**：

```bash
git diff --check   # 无空白错误
```

任务卡中出现的 `node scripts/runtime-spike/verify-decision.mjs`、`scripts/quality/*`、`pnpm lint/test/build` 等是 G1/MM-020 之后才创建的未来命令，当前不可运行也不要提前创建。规划包管理器预期为 pnpm workspace，同样尚未建立。

## 架构原则（约束未来实现）

- 依赖方向：`packages/core`（平台无关领域层，禁依赖窗口/OS API/UI 框架/React）← `packages/ui` 与 `packages/platform` ← `apps/desktop`（仅组合根，不承载领域规则）；导出布局进 `packages/export/`（由 MM-020 先登记再创建）
- 跨平台行为默认一致；macOS/Windows 差异只允许进 `packages/platform/`，且须显式记录
- 本地优先：无账号、云同步、遥测、广告、后端；新增运行时依赖须说明用途、包体影响、许可证和替代方案，并过 license scan
- 命名：目录与文件 kebab-case；禁止 `utils`/`common` 等无边界容器；共享代码出现两个真实消费者后才抽取
- 单元测试可与源码相邻，跨模块测试进 `tests/`（integration/e2e/fixtures，目录在首次使用时创建）
- 临时文件放被忽略的 `.tmp/`，任务结束前清理；生成文件不入库
- 示例数据必须为合成数据；密钥、真实用户脑图不入库；对外文件格式的破坏性变更须有迁移方案 + ADR

## 修改流程要点

1. 动手前先读 `AGENTS.md` 与目标目录的 `README.md`
2. 涉及产品范围先改 `docs/product/`；涉及关键架构取舍先新增/更新 ADR，再写代码
3. 最小必要修改，不夹带无关重构
4. macOS/Windows 行为可能分叉时，至少提供两平台验证说明；无法实机验证时明确标记缺口
