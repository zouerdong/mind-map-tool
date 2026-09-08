# 发布前检查清单（PRC 终审后）

状态：**REJECT / INVALID_CANDIDATE / NOT_READY_TO_RELEASE**。PRC-000～PRC-090 虽已回报完成，但 2026-09-07 的独立复算推翻了旧 MM-110 `ACCEPT` 与 `READY_TO_RELEASE`。本清单以[全面代码审阅](./pre-release-code-review-2026-09-07.md)为准。

v1 的 required platform 是 macOS Apple Silicon；Windows 属于后续专门版本，记录为 `DEFERRED`，不阻断本次 v1。签名、公证、上传和公开发布仍为 `EXCLUDED`，且不因本清单转绿而自动获授权。

## 当前门禁

| 检查项 | 当前状态 | 事实与下一步 |
| --- | --- | --- |
| TypeScript / Rust 常规检查 | PASS AT REVIEW SNAPSHOT | 审阅前 TS unit 44 files / 419 tests、Rust 187 tests + doc tests 通过；审阅小修需按下方验证矩阵复跑 |
| 初始 entry JS ≤ 500,000B | PASS / HIGH RISK | 审阅小修后的最终隔离 production build 为 `499,804B`，仅余 196B；任何新候选都必须重测 |
| `.dmg` ≤ 25,000,000B | FAIL | 旧候选 `28,011,310B`；执行 PRR-020，不得提高 Accepted 预算 |
| G2 授权来源 | FAIL | 登记使用 `project-owner` 占位身份且没有 `[from-user]` 原文；PRR-000 补真实批准人、日期与精确范围 |
| LICENSE / notices | FAIL | 根 `LICENSE` 与 `THIRD_PARTY_NOTICES` 缺失，ADR 0007 仍为 Proposed；执行 PRR-060 |
| `.mindmap` bundle 文件关联 | FAIL | 旧候选 plist 没有 `CFBundleDocumentTypes` / `UTExportedTypeDeclarations`；执行 PRR-030 |
| 最低 macOS 版本一致性 | FAIL | plist 10.13、Mach-O 11.0、产品文档 11+、旧 handoff 12+；执行 PRR-030 |
| 原生启动 / RSS / dense canvas / edit / save / PNG | FAIL / INVALID EVIDENCE | 旧报告含固定替代值、空样本和 web harness 冒充 native；执行 PRR-010/070 |
| 原生安装、打开 `.mindmap` 与应用身份 | NOT MEASURED | 旧 install gate 只做临时复制/哈希，没有 LaunchServices、双击打开或真实生命周期验收；执行 PRR-030/070 |
| 字体切换几何事务 | FAIL | 切换文档字体不会原子重测现有节点持久化尺寸；执行 PRR-040 |
| active document handle | RESIDUAL P2 | 同窗 Save As/open 后旧 handle 仍有效到窗口关闭；执行 PRR-050 或由负责人书面接受 |
| CSP / 网络端点 | PASS AT REVIEW SNAPSHOT | 当前 CSP/allowlist 未发现放宽；新候选仍需同源复核 |
| 依赖漏洞数据库检查 | PARTIAL | JS production audit 当前无已知漏洞；Rust advisory scan 未执行，因为本机未安装 `cargo-audit` |
| G-FINAL | MISSING | 自动化视觉 runner 不得授予；PRR-070 由负责人绑定新 candidate hash 明确给出 |
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
