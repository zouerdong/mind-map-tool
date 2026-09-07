# 发布前检查清单（MRT-011 / MRT-012）

状态：**CONDITIONAL / BLOCKED**。本清单收口可在当前工作树完成的工程准备，
不会把缺少 G2、Windows 实机或法律审阅的项目标记为发布候选。

## MRT-011：包体与启动加载

| 检查项 | 当前状态 | 证据/命令 | 备注 |
| --- | --- | --- | --- |
| 初始 HTML 只有一个 module entry | PASS | `node scripts/quality/measure-release-assets.mjs` | 首屏不直接枚举导出实现 |
| 初始 entry JS ≤ 500,000 bytes | PASS（当前构建约 496KB） | 同上 | 以构建产物的实际字节数为准 |
| PNG/PDF 实现按需 chunk | IMPLEMENTED | `packages/export/src/index.ts`、`pnpm build` | 首次导出承担动态加载成本 |
| 字体/WASM 不阻塞首帧 | IMPLEMENTED | `apps/desktop/src/app/ports.ts`、`mindmap-app.tsx` | warmup 在首帧后触发，导出仍可按需等待 |
| 资源上限与失败路径 | PASS | `packages/export/test/resource-limits.test.ts` | 每字体 32MiB、总计 64MiB |
| Tauri `.app`/`.dmg` 大小 | BLOCKED | `pnpm bundle:tauri -- --unsigned` | 需要 G2 精确 candidate scope；当前不主动打包 |
| 冷/热启动、稳定 RSS、原生 dense canvas | BLOCKED | `node scripts/quality/run-performance.mjs --scope release` | 需要获批 candidate 与原生平台报告 |
| Windows 原生包体与性能 | DEFERRED | `docs/product/v1-product-spec.md` | 顺延至 Windows 专门版本，不阻断 v1 |

资产测量只读取已生成的 `apps/desktop/dist`，不会代替 Tauri 安装器测量，也不会
触发安装、卸载或系统改动。可复算输出：
`.tmp/quality/release-assets.json`。

## MRT-012：文件安全、许可证与安装准备

| 检查项 | 当前状态 | 证据/命令 | 备注 |
| --- | --- | --- | --- |
| 文件系统 durability / 原子替换 | IMPLEMENTED | `apps/desktop/src-tauri/src/file/commit.rs`、Rust tests | 不改变既有失败语义 |
| 不可信文档 50MiB bounded read | PASS | `apps/desktop/src-tauri/src/file/mod.rs`、Rust tests | 超限前拒绝且不签发 handle |
| JS + Cargo 依赖许可证扫描 | PASS（最近一次） | `node scripts/quality/scan-dependency-licenses.mjs` | 结果绑定到最终证据批次 |
| CSP / 本地资源 / IPC 审阅 | REVIEW REQUIRED | `apps/desktop/src-tauri/tauri.conf.json`、capabilities | 需在 G2 前完成逐项审阅；不在本清单中放宽 CSP |
| 最终项目许可证与 notices | BLOCKED | `docs/product/licensing.md`、ADR 0007 | 仍需项目负责人/法律确认 |
| unsigned macOS candidate | BLOCKED | `scripts/quality/bundle-gate.mjs` | G2 未批准输出路径和删除边界 |
| unsigned Windows candidate | DEFERRED | `docs/product/v1-product-spec.md` | 顺延至 Windows 专门版本 |
| 签名 / 公证 / 凭据 / 上传 / 发布 | EXCLUDED | 需另行授权 | 本阶段不执行 |

## 放行条件

只有在以下条件全部满足后，才能把清单从 `BLOCKED` 改为可发布前审阅：G2 已批准
精确本地范围、最终身份与许可证已确认、macOS unsigned candidate 和原始报告
齐全（Windows 明确列为 deferred/not-run）、MRT-010/PRC 总门禁为零失败，并由 MM-110 给出 `ACCEPT`。这不自动授权签名、公证
或公开发布。
