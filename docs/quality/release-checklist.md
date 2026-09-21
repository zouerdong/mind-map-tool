# 发布前检查清单（PRR-070 `.DS_Store` STOP 后）

2026-09-21 当前派发更新：`RELEASED_V1.0.0 / PUBLIC_RELEASE_OUT`。**v1.0.0 已于 2026-09-21 公开发布**（https://github.com/zouerdong/mind-map-tool/releases/tag/v1.0.0 ，负责人 G-FINAL 原话批准「批准批准，你赶紧的吧」）。发布证据链：候选源 commit `29111de`（= tag v1.0.0），v3 readiness manifest `.tmp/release-candidate/v1.0.0/release-readiness-manifest.json` 驱动 `pnpm quality -- --release-evidence` **20/20 门全绿**（含原生性能实测、install-gate 受控安装卸载、LaunchServices 实测、unsigned 确认）。entry JS 预算经 ADR 0021 重基线 500,000→550,000B；G2 approvedScope 版本对齐 1.0.0（decision-register 附审计修订记录）。macOS DMG sha256 `fd21164e…`、Windows exe（CI run 35594973589）sha256 `e65f69ec…`。签名/公证仍未授权（产物 unsigned，Gatekeeper/SmartScreen 提示已在 release notes 披露）；Windows 原生自动化证据链维持 DEFERRED（CI 构建 hash + 实机 dogfood 替代）。

2026-09-12 历史派发：`R2-F1_STAGE_B_ACCEPTED / PRR-070_STAGE_A_READY / G-FINAL_NOT_REQUESTED`。阶段 B frozen source `225923f12abac23db0a6605160477cd36c8ca93a` 的三轮真实 ULMO 预检已独立接受，见[阶段 B 独立审阅](./prr-069c-r2-f1-stage-b-independent-review-2026-09-12.md)。当前只放行[PRR-070 阶段 A](../planning/prr-070-native-candidate-stage-a-task-card-2026-09-12.md)，未放行 G-FINAL 记录、PRR-070 阶段 B、PRR-080/090。

状态：**RELEASED v1.0.0（2026-09-21，20/20 门全绿）**。

v1 的 required platform 是 macOS Apple Silicon；Windows 属于后续专门版本，记录为 `DEFERRED`，不阻断本次 v1。签名、公证、上传和公开发布仍为 `EXCLUDED`，且不因本清单转绿而自动获授权。

## 当前门禁

| 检查项 | 当前状态 | 事实与下一步 |
| --- | --- | --- |
| TypeScript / Rust 常规检查 | PASS ON R2-F1 STAGE B SOURCE `225923f` | 12 项门通过：release-runners 132、unit 654、integration 94、cargo 210 及 format/typecheck/lint/icon/build/clippy/diff-check；PRR-070 仍须从新 clean HEAD 全部重跑 |
| 初始 entry JS ≤ 550,000B（ADR 0021 v1.0.0 重基线；原 500,000B） | PASS ON INVALIDATED `b45dc0c` CANDIDATE | production entry 为 `486,089B`；PRR-070 新候选仍须同源复算 |
| `.dmg` ≤ 25,000,000B | PASS AT R2-F1 STAGE B PRECHECK / FINAL CANDIDATE PENDING | 三轮为 24,284,017/073/017B，均 ULMO + CRC32 VALID；仅作装配预检，PRR-070 必须生成唯一新 DMG |
| G2 授权来源 | PASS | ErDong Zou 于 2026-09-08 提供 `[from-user]` 原文、允许范围与明确排除动作 |
| LICENSE / notices | PASS AT SOURCE/BUNDLE REVIEW | 根法律文本、metadata 与诊断 bundle 内副本一致；PRR-070 复算唯一候选 hash |
| `.mindmap` bundle 文件关联 | PASS AT DIAGNOSTIC BUNDLE | `CFBundleDocumentTypes`、UTI、MIME 与 Editor 角色齐备；PRR-070 执行 LaunchServices 实测 |
| 最低 macOS 版本一致性 | PASS AT DIAGNOSTIC BUNDLE | Info.plist 与 Mach-O 均为 macOS 11.0；PRR-070 同源复算 |
| 原生启动 / RSS / dense canvas / edit / save / PNG | NOT RUN ON FINAL CANDIDATE | PRR-067 协议保持有效；由已派发 PRR-070 对唯一新 candidate 同源重测 |
| 原生安装、打开 `.mindmap` 与应用身份 | NOT YET RUN ON NEW CANDIDATE | G2 已授权受控安装和 LaunchServices；由 PRR-070 在唯一候选上执行并恢复状态 |
| 字体切换几何事务 | PASS AT SOURCE REVIEW | PRR-040/066 已覆盖原子重测、并发 join、失败回队和保存屏障；PRR-070 原生矩阵复核 |
| active document handle | PASS AT SOURCE REVIEW | PRR-050 已实现 handle 回收与生命周期测试；PRR-070 原生矩阵复核 |
| CSP / 网络端点 | PASS AT PRR-066 REVIEW | production CSP 只增加 `'wasm-unsafe-eval'`；network scan 为0 endpoint；PRR-070 同源复核 |
| 依赖漏洞数据库检查 | PASS ON INVALIDATED `b45dc0c` RUN | JS 为0漏洞；隔离 `cargo-audit 0.22.2` 为0漏洞、7条 warning；source 将变化，PRR-070 必须重跑 |
| DMG 装配可重复性 | R2-F1 STAGE B ACCEPTED ON `225923f` | 三轮真实 `hdiutil` 正常路径全部通过、cleanupMs=0、无残留；只解锁 PRR-070 阶段 A |
| source/evidence 时间拓扑 | PASS WITH NON-BLOCKING EVIDENCE NOTES | 三轮 source/inventory/report 次序成立；旧 manifest 混用两种路径基准且 attempt-01 验证文件曾后续追加，已在独立审阅披露；PRR-070 要求统一 repo-relative manifest 且文件生成后不追加 |
| G-FINAL | APPROVED 2026-09-21 | 负责人原话批准绑定候选 sha256 `28facab7…`，artifact `.tmp/release-candidate/v1.0.0/evidence/g-final-approval.json` |
| Windows 原生证据 | DEFERRED（发布形态） | CI release-build 唯一 Windows 路径 + hash 证据 + 实机 dogfood；原生自动化证据链后续版本补齐 |
| 签名 / 公证 / 凭据 | EXCLUDED（未授权） | 产物 unsigned（adhoc，无 Developer ID），已在 release notes 披露 |
| 上传 / 发布 | EXECUTED 2026-09-21（逐项授权） | GitHub Release v1.0.0 + 三资产上传 + latest 标记，负责人 G-FINAL 覆盖 |

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
