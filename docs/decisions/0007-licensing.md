# ADR 0007: 许可与商业化边界

- Status: Accepted
- ADR-Version: 1.0.0
- Date: 2026-08-26（Proposed）→ 2026-09-08（Accepted）
- Owners: ErDong Zou（项目负责人；最终文本以法律审阅为准）

## Context

项目负责人已确认的商业边界 [from-user]（2026-08-26）：

1. 终端用户始终可免费使用，包括工作中使用和把导出脑图交付客户。
2. 第三方若通过软件本身收费、转售或包装商业产品，需要单独付费授权。

对外措辞必须为"源码可见"或"双重许可"；未满足 OSI 定义前不得声称"开源"。最终许可证与商业授权文本是 G2 用户确认门槛，不是工程 Agent 的决定。

2026-09-08，项目负责人在 PRR 批次四组输入中给出最终法律决定 [from-user]：

> 【法律文本】
> 许可：A，专有软件 / All Rights Reserved
> 授权生成根 LICENSE 和 THIRD_PARTY_NOTICES：是

## Decision Drivers

- 不误伤用户已允许的日常商业工作用途
- 阻止通过软件本身收费/转售
- 与全部运行时依赖（host、画布库、字体、导出依赖）兼容
- 法律上可执行、可审阅

## Considered Options

1. **source-available 双重许可**（原推荐方向）：终端使用免费 + 软件本身商业化需另行授权；具体组合（如 Commons Clause 类附加条款）待法律审阅。
2. **PolyForm Noncommercial**：会把已允许的日常工作用途一并限制，不符合已确认边界，不建议。
3. **纯 MIT/Apache**：无法阻止通过软件本身收费，与边界冲突。
4. **专有软件 / All Rights Reserved**：仓库与分发产物整体采用专有许可，一切未明确授予的权利保留；商业授权与个人使用政策由权利主体另行书面授予。

## Decision

**Accepted 方案 4（专有软件 / All Rights Reserved）**，取代原 Proposed 方向 1。2026-09-08 负责人 [from-user] 输入选定该方案，并授权工程侧生成根 `LICENSE` 与 `THIRD_PARTY_NOTICES`：

- 根 `LICENSE` 为专有软件 / All Rights Reserved 文本（© 2026 ErDong Zou）；对外正式发布前仍建议由法律审阅最终措辞。
- 随包分发的全部第三方组件（JS、Cargo、字体等）按各自原始许可在 `THIRD_PARTY_NOTICES.md` 完整归属，不得声明为专有。
- workspace `package.json` 使用 `UNLICENSED`、`Cargo.toml` 使用 `LicenseRef-Proprietary` 表达非 SPDX 专有许可。
- 从 MM-020 起每次新增运行时依赖立即运行 `scan-dependency-licenses.mjs`；发布前 notices 必须覆盖每个实际分发 package/font。

## Consequences

### Positive

- 权利保留最大化：转售、闭源包装与再分发默认禁止，与已确认商业边界一致。
- 专有许可与全部宽松第三方许可（MIT/Apache/ISC/OFL 等）兼容，无组合疑问。
- 依赖许可问题在引入时暴露而非发布前。

### Negative

- 不满足"源码可见"分发预期；外部贡献与再分发需要个案书面授权。
- 正式对外发布（发布执行任务）前，最终文本仍需法律审阅确认。

## Validation

2026-09-08 负责人 [from-user] 法律输入记录（见 `docs/decisions/decision-register.json` G2 evidence）+ `scan-dependency-licenses.mjs` 通过（含 notices 覆盖校验）+ 根 `LICENSE` 与 `THIRD_PARTY_NOTICES.md` 随候选分发；MM-110 复核 R-011。
