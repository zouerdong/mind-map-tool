# ADR 0016：开源发布许可（MIT），取代 ADR 0007 专有许可

- Status: Accepted
- ADR-Version: 1.0.0
- Date: 2026-09-17
- Deciders: 项目负责人（2026-09-17 定稿 [from-user]）/ 主会话（工程实现）
- Supersedes: ADR 0007（专有软件 / All Rights Reserved）

## Context

ADR 0007（2026-09-08）选定专有许可，动机是当时确认的商业边界："阻止第三方通过软件本身收费/转售"。
2026-09-17 负责人调整发布策略 [from-user]：

1. 不做 Apple 渠道发行（无开发者凭据，且不希望投入该渠道）；
2. 软件**完全开源免费**发布到负责人本人的 GitHub 仓库（账号 `ErdongZou-ai`）；
3. 公开发布推迟到 Agent 无头导出能力（ADR 0014）就绪之后，现已就绪。

开源许可证选型：依赖审计（`pnpm license:scan`）确认全部运行时依赖为宽松许可
（MIT/Apache-2.0/ISC/BSD 等，仅 2 个 MPL-2.0 文件级弱传染，与 MIT 分发兼容）；
仓库密钥扫描（HEAD + 全部 165 提交）干净，无发布障碍。

## Decision

- 根 `LICENSE` 改为 **MIT License**（Copyright (c) 2026 ErDong Zou），仓库与全部分发产物适用；
- workspace 全部 `package.json` 的 `license` 字段由 `UNLICENSED` 改为 `MIT`；
  `apps/desktop/src-tauri/Cargo.toml` 由 `LicenseRef-Proprietary` 改为 `MIT`；
- `tauri.conf.json` 的 `bundle.copyright` 去掉 "All rights reserved"，标注 MIT；
- 第三方归属机制不变：`THIRD_PARTY_NOTICES.md` 继续随包分发，`pnpm license:scan` 校验不放宽；
  notices 抬头由"专有软件"改为"MIT License"；
- 对外措辞从此可以合法声称"开源"（MIT 为 OSI 批准许可）；
- ADR 0007 状态置为 Superseded；其"商业边界"动机随负责人 2026-09-17 决定作废
  （MIT 下第三方商用/转售自由，负责人明确接受 [from-user]）。

## Consequences

- 任何人可自由使用/修改/再分发（含商用），保留版权声明即可；项目不再具备收费/转售排他性；
- 两个 MPL-2.0 依赖保持其文件级许可，notices 已覆盖，无行动项；
- 候选重建批次携带本变更；G2 证据中专有许可的相关记录保留为审计历史，以本 ADR 为现行口径。
