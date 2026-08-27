# MM-090 预检基线（2026-08-27 晚）

非正式 MM-090 执行（不产出验收 evidence），只摸清验收命令的当前基线，
为键位专项讨论与 MM-090 正式启动提供依据。原则：预检只修验收工具的
明确误报，不放宽任何断言、不动 golden。

## 命令基线（全部实跑）

| 命令 | 结果 | 备注 |
| --- | --- | --- |
| `run-all.mjs`（typecheck/lint/unit/boundaries/licenses/network/golden/performance） | **8/8 PASS** | 197 tests；network 误报已修（见下） |
| `run-export-golden.mjs` | PASS | MM-040 golden 链完整 |
| `run-performance.mjs`（canvas dense-300-450） | PASS | pan/nodeDrag/zoom p95 = 16.7ms（预算 32ms，2 倍余量）；attribution 保留；bundle 747KB |
| `check-boundaries.mjs --scope selected-canvas` | PASS | |
| `scan-dependency-licenses.mjs` | PASS | JS 侧全覆盖；Rust 侧 5+1 依赖人工核验均 Apache-2.0 OR MIT（扫描器不覆盖 Cargo，见缺口） |
| `scan-network-endpoints.mjs` | PASS（修复后） | 误报：MM-080 ports.ts 加载 vite `?url` 同源 dist 资产（字体/wasm）触发 fetch 检测；已加结构化窄豁免（单文件+单模式+理由），红线未放宽 |
| `cargo test && cargo clippy -D warnings` | PASS | 30 tests（含 MM-088 shortcuts） |
| `pnpm test:a11y` | PASS | axe（jsdom）+ 对比度数学断言 |
| `run-platform-macos.sh --suite file-lifecycle` | PASS（管线在位） | MM-060 evidence 通道 |
| `run-e2e-macos.sh` | **fail-closed 占位** | MM-090 最大遗留工作：需落地 E2E 套件（真实 Tauri app 驱动，非 mock） |

## MM-090 正式执行前的事项清单

1. **键位专项讨论定稿**（用户约 2026-08-28）：功能→占位键→冲突风险→备选
   逐项过；定稿只改 keyboard.ts / 画布 onKeyDown / 全局热键默认值 +
   shortcut-table.md + 测试（机制零改动）。
2. **E2E 套件落地**（`run-e2e-macos.sh`）：E2E-01～14 用真实 app 驱动
   （playwright/WKWebView 路线在 MM-090 决定），覆盖 AC-01～17 主链路。
3. **证据交付物**：`evidence-index.json`、`risk-evidence-index.json`、
   MM-090 聚合报告、截图/日志索引、AC-01～17 每行证据映射。
4. **Windows**：按 ADR 0001 G1 平台范围（macOS 先行）记录缺口与移植
   就绪证据，不产假报告。
5. **已知 host 缺口**（需项目负责人拍板补法）：native 窗口级 dirty-close
   拦截（`on_window_event(CloseRequested)`）、多窗口 create-window 权限。
6. **工具缺口**：license 扫描不覆盖 Cargo.toml 依赖（当前人工核验兜底，
   MM-090 可顺手补 Cargo 扫描或记录为长期人工项）。

## 结论

代码与质量链全绿（唯一 FAIL 为验收工具误报，已窄修复）；MM-090 的
实质工作集中在 E2E 套件落地与证据组织。无阻断缺陷。
