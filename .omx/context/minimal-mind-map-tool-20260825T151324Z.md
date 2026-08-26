# Deep Interview Context: Minimal Mind Map Tool

- Created (UTC): 2026-08-25T15:13:24Z
- Context type: Greenfield
- Prompt-safe initial-context summary status: `not_needed`

## Task Statement

在现有项目目录中先建立符合长期维护要求的工程骨架，然后通过标准深度访谈澄清一款极简桌面思维导图工具的最终形态。

## Desired Outcome

形成一份可以进入架构共识与实现规划的产品规格，明确意图、目标形态、范围、非目标、技术与业务约束、决策边界以及可测试验收标准。

## Stated Solution

工具应提供极简界面，在 macOS 与 Windows 上轻量运行；用户已经有部分产品想法，尚未展开。

## Probable Intent Hypothesis

用户可能希望消除传统脑图软件在界面、操作或运行负担上的摩擦，以更直接的方式完成思考整理；该判断只是待验证假设，不能作为产品决策。

## Known Facts and Evidence

- [from-code][auto-confirmed] 项目开始时为空目录，没有既有代码、依赖或技术债务。
- [from-code][auto-confirmed] 已建立框架无关的工程骨架，并初始化本地 Git `main` 分支。
- [from-code][auto-confirmed] 当前目录按桌面装配、领域核心、UI、平台适配、测试、产品文档、架构文档、质量标准、资源和脚本分责。
- [from-user] 目标运行平台为 macOS 与 Windows。
- [from-user] 用户明确要求“极简化界面”和“轻量运行”。

## Constraints

- 在需求澄清前，不预先锁定 Electron、Tauri 或其他桌面框架。
- 不预先决定数据格式、同步模型、发布渠道或商业模式。
- 后续实现必须遵守根级 `AGENTS.md`。
- 正式开发前需要获得明确的产品范围与验收标准。

## Unknowns and Open Questions

- 工具首先为谁服务，以及最核心的待解决问题是什么。
- “极简”和“轻量”分别指哪些可观察行为与指标。
- 核心用户旅程、编辑范式和信息结构。
- 首版必须包含与明确排除的能力。
- 本地文件、自动保存、导入导出、同步和协作边界。
- 性能、包体、兼容性、可访问性和发布验收标准。

## Decision-Boundary Unknowns

- 哪些产品和交互决定可由实现方自主完成。
- 哪些技术取舍、视觉变化、数据兼容承诺或范围变更必须再次确认。

## Likely Codebase Touchpoints

- `apps/desktop/`
- `packages/core/`
- `packages/ui/`
- `packages/platform/`
- `tests/`
- `docs/product/`
- `docs/architecture/`
- `docs/decisions/`
- `docs/quality/`
