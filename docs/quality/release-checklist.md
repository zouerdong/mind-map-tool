# 发布前检查清单（PRR-070 `.DS_Store` STOP 后）

2026-09-11 当前派发更新：`R2_REVISE / R2-F1_STAGE_A_READY / PRR-070_BLOCKED`。R2 独立审阅确认 EULA 异常分类、清理统一计时和历史任务目录隔离仍需返修；当前唯一入口为 [R2-F1 修复指南与任务卡](../planning/prr-069c-r2-f1-repair-guide-and-task-card-2026-09-11.md)。现在只执行阶段 A（代码与合成异常测试），交回 STOP_FOR_CODE_REVIEW；阶段 B 三轮原生预检暂不派发。下文 R2 执行报告与正常预检保留历史事实，不表示独立验收通过；旧路线与本更新冲突时，以本更新为准。

状态：**IN_PROGRESS / R2_REVISE / R2-F1_STAGE_A_READY / PRR-070_BLOCKED / NOT_READY_TO_RELEASE**。R2 已按页首任务卡完成实现与三轮预检，等待独立审阅；本清单仍未放行。

v1 的 required platform 是 macOS Apple Silicon；Windows 属于后续专门版本，记录为 `DEFERRED`，不阻断本次 v1。签名、公证、上传和公开发布仍为 `EXCLUDED`，且不因本清单转绿而自动获授权。

## 当前门禁

| 检查项 | 当前状态 | 事实与下一步 |
| --- | --- | --- |
| TypeScript / Rust 常规检查 | PASS ON PRR-069C-R2 SOURCE `885d877` / PENDING INDEPENDENT REVIEW | R2 全量门通过：format/typecheck/lint/unit 635/integration 94/icon/build/cargo test 210/clippy -D warnings/diff --check；PRR-070 仍须从独立审阅通过后的新 clean source 全部重跑 |
| 初始 entry JS ≤ 500,000B | PASS ON INVALIDATED `b45dc0c` CANDIDATE | production entry 为 `486,089B`；PRR-070 新候选仍须同源复算 |
| `.dmg` ≤ 25,000,000B | PASS ON PRR-069C-R2 SOURCE `885d877` / PENDING INDEPENDENT REVIEW | R2 三轮 DMG 为 24,284,033/017/025B（预算内，ULMO + CRC32 VALID）；R1 attempts 仅作历史事实 |
| G2 授权来源 | PASS | ErDong Zou 于 2026-09-08 提供 `[from-user]` 原文、允许范围与明确排除动作 |
| LICENSE / notices | PASS AT SOURCE/BUNDLE REVIEW | 根法律文本、metadata 与诊断 bundle 内副本一致；PRR-070 复算唯一候选 hash |
| `.mindmap` bundle 文件关联 | PASS AT DIAGNOSTIC BUNDLE | `CFBundleDocumentTypes`、UTI、MIME 与 Editor 角色齐备；PRR-070 执行 LaunchServices 实测 |
| 最低 macOS 版本一致性 | PASS AT DIAGNOSTIC BUNDLE | Info.plist 与 Mach-O 均为 macOS 11.0；PRR-070 同源复算 |
| 原生启动 / RSS / dense canvas / edit / save / PNG | NOT RUN ON VALID CANDIDATE | PRR-067 协议保持有效；待 PRR-069C-R2 独立审阅通过后由新 PRR-070 同源重测 |
| 原生安装、打开 `.mindmap` 与应用身份 | NOT YET RUN ON NEW CANDIDATE | G2 已授权受控安装和 LaunchServices；由 PRR-070 在唯一候选上执行并恢复状态 |
| 字体切换几何事务 | PASS AT SOURCE REVIEW | PRR-040/066 已覆盖原子重测、并发 join、失败回队和保存屏障；PRR-070 原生矩阵复核 |
| active document handle | PASS AT SOURCE REVIEW | PRR-050 已实现 handle 回收与生命周期测试；PRR-070 原生矩阵复核 |
| CSP / 网络端点 | PASS AT PRR-066 REVIEW | production CSP 只增加 `'wasm-unsafe-eval'`；network scan 为0 endpoint；PRR-070 同源复核 |
| 依赖漏洞数据库检查 | PASS ON INVALIDATED `b45dc0c` RUN | JS 为0漏洞；隔离 `cargo-audit 0.22.2` 为0漏洞、7条 warning；source 将变化，PRR-070 必须重跑 |
| DMG 装配可重复性 | REVISE / R2 REQUIRED | R1 正常路径成立，但 attach 异常、工具注入与中间 symlink 边界未闭合；须 R2 修复、三轮新预检并独立审阅 |
| source/evidence 时间拓扑 | PASS ON PRR-069C-R1 ATTEMPTS / HISTORICAL / R2 REQUIRED | R1 三轮证据为机器生成 UTC 且阈值未放宽（120000/180000 精确）；`b45dc0c` 与原 PRR-069C attempts 仍只读作废；PRR-070 从新 clean HEAD 重新取证 |
| G-FINAL | MISSING / EXPECTED | 本轮在步骤 4 STOP，未生成请求；只有新 PRR-070 阶段 A 全绿后才可请求负责人原文 |
| Windows 原生证据 | DEFERRED | 后续 Windows 专门版本，不能写成 PASS |
| 签名 / 公证 / 凭据 / 上传 / 发布 | EXCLUDED | 需要另行明确授权，本轮不执行 |

## 旧候选处置

- 旧 `.app` / `.dmg`、readiness manifest、性能报告、MM-110 和交接包仅保留审计用途。
- 不允许修改旧 JSON、补写批准或覆盖旧证据来恢复绿灯。
- 本次审阅已经修改源码，所以旧候选即使解决单项报告问题，也不再代表当前工作树。
- 新批次必须从 clean source commit 构建唯一候选，并把所有报告绑定到同一 `.app` / `.dmg` hash。

## 重新放行条件

只有以下条件全部满足，才能把状态改为 `READY_FOR_RELEASE_EXECUTION_REVIEW`：

1. [PRR-000～PRR-090](../planning/pre-release-remediation-task-cards-2026-09-07.md) 全部完成；000～080 由执行 Agent 完成，090 由独立验收者完成，P0/P1 为零，P2 有书面处置。
2. G2、原生平台报告、raw samples、安装/文件关联验收和 G-FINAL 均绑定同一新 candidate hash。
3. `.dmg`、entry、启动、RSS、画布、编辑、保存和 2x PNG 全部满足 Accepted ADR 预算。
4. LICENSE、THIRD_PARTY_NOTICES、bundle 身份、`.mindmap` UTI/MIME 与最低系统版本能从最终源码和产物复算。
5. `pnpm quality`、强化后的 `verify-evidence`、全量 TS/Rust 测试与新 MM-110 独立审阅均通过。

达到上述状态仍不等于授权签名、公证、Git push、上传或公开发布。
