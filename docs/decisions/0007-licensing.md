# ADR 0007: 许可与商业化边界

- Status: Proposed
- Date: 2026-08-26
- Owners: Project maintainers（最终文本：项目负责人 + 法律审阅）

## Context

项目负责人已确认的商业边界 [from-user]：

1. 终端用户始终可免费使用，包括工作中使用和把导出脑图交付客户。
2. 第三方若通过软件本身收费、转售或包装商业产品，需要单独付费授权。

对外措辞必须为"源码可见"或"双重许可"；未满足 OSI 定义前不得声称"开源"。最终许可证与商业授权文本是 G2 用户确认门槛，不是工程 Agent 的决定。

## Decision Drivers

- 不误伤用户已允许的日常商业工作用途
- 阻止通过软件本身收费/转售
- 与全部运行时依赖（host、画布库、字体、导出依赖）兼容
- 法律上可执行、可审阅

## Considered Options

1. **source-available 双重许可**（推荐方向）：终端使用免费 + 软件本身商业化需另行授权；具体组合（如 Commons Clause 类附加条款）待法律审阅。
2. **PolyForm Noncommercial**：会把已允许的日常工作用途一并限制，不符合已确认边界，不建议。
3. **纯 MIT/Apache**：无法阻止通过软件本身收费，与边界冲突。

## Decision

Proposed 方向 1：source-available 双重许可。本 ADR 只定方向；最终文本、商业授权条款、第三方 notices 清单在 G2 前完成法律审阅并由项目负责人批准。从 MM-020 起每次新增运行时依赖立即运行 `scan-dependency-licenses.mjs`，发布前生成完整清单并验证 React Flow、host、字体与导出依赖兼容。

## Consequences

### Positive

- 与已确认的免费使用/付费商用边界对齐；依赖许可问题在引入时暴露而非发布前。

### Negative

- 双重许可文本需要法律成本；部分依赖可能与附加条款组合存在兼容性疑问，需逐一审阅。

## Validation

G2 前法律审阅记录 + `scan-dependency-licenses.mjs` 通过 + third-party notices 完整；MM-110 复核 R-011。
