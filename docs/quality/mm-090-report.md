# MM-090 聚合报告（自动化 E2E、golden 与双平台验收）

状态：**进行中**（E2E 基础设施与证据框架已落地；完整重跑等待 tauri-driver
用户授权安装——见「待用户动作」）。本文档在完整重跑后刷新为最终版。

## 执行架构（本卡落地）

三层证据，不以 mock 冒充任何一层：

| 层 | 范围 | 载体 |
| --- | --- | --- |
| 自动化 E2E（真实 app） | E2E-02/03/04/05/08/09（画布交互） | `tests/e2e/macos/` + `run-e2e-macos.sh`（tauri-driver + 零依赖 W3C WebDriver 客户端，驱动真实 debug bundle） |
| 系统级自动化（真实服务层） | E2E-01/06/07/10/11/12/13/14 的可自动化部分（launch 路由、文件安全、authorization 负向、golden、性能） | `run-platform-macos.sh --suite file-lifecycle`、`run-export-golden.mjs`、`run-performance.mjs`（路由：`run-e2e-macos.sh --case launch-router|file-open|file-safety`） |
| 人工矩阵（系统对话框/真机 IME/Dock/文件关联） | 规格 §7 步骤 1–11 + ⌥Space 前台截获 | `mm-090-manual-matrix.md` |

技术决策记录：

- **WebDriver 客户端自研（零依赖）**：selenium/webdriverio 依赖树重且须过
  license scan；W3C WebDriver 是 HTTP+JSON，本套件所需协议子集 200 行内
  实现，落在 `tests/**` 允许路径，零传递依赖。
- **交互双通道**：safaridriver 对 W3C actions 支持不全——键盘/指针原语
  actions API 优先、失败回落 execute/sync 合成事件；实际通道逐用例记入
  evidence JSON（透明，不隐瞒保真度边界）。
- **合成事件保真度边界**：合成键盘不产生浏览器默认行为（textarea 换行），
  该行为由 jsdom 单测覆盖；E2E 断言命令语义（DOM 状态、投影、dirty 位）。
- **E2E-08 用重放入口驱动完成路径**：不删用户偏好文件（红线），
  重放与首启共用 OnboardingFlow/reducer；真冷启动首启由首次实跑覆盖。

## 待用户动作（阻断完整重跑）

1. `cargo install --locked tauri-driver`（全局 cargo 二进制，需授权）
2. `sudo safaridriver --enable`（一次性，需管理员密码——建议在会话里以
   `! sudo safaridriver --enable` 执行）

## 完整重跑清单（授权后执行）

```
node scripts/quality/run-all.mjs
node scripts/quality/run-export-golden.mjs
node scripts/quality/run-performance.mjs
node scripts/quality/check-boundaries.mjs
node scripts/quality/scan-dependency-licenses.mjs
node scripts/quality/scan-network-endpoints.mjs
scripts/quality/run-e2e-macos.sh            # E2E-02/03/04/05/08/09
scripts/quality/run-e2e-macos.sh --case launch-router   # 路由 platform 套件
scripts/quality/run-e2e-macos.sh --case file-open
scripts/quality/run-e2e-macos.sh --case file-safety
cargo test && cargo clippy -D warnings
pnpm test:a11y
git diff --check
```

## Pass/Fail 总表（完整重跑后填）

| 命令 | 退出码 | 证据 |
| --- | --- | --- |
| run-all.mjs | pending |  |
| run-export-golden.mjs | pending |  |
| run-performance.mjs | pending |  |
| check-boundaries.mjs | pending |  |
| scan-dependency-licenses.mjs | pending |  |
| scan-network-endpoints.mjs | pending |  |
| run-e2e-macos.sh（交互子集） | pending | docs/quality/evidence/mm-090-macos-e2e.json |
| launch-router / file-open / file-safety | pending | docs/quality/evidence/mm-090-macos-*.json |
| cargo test / clippy | pending |  |

## Windows

无设备（R-013）：Windows 维度 BLOCKED（真实报告缺失），不产假报告、
不聚合格 PASS；macOS 证据构成 ADR 0001 G1 批准的先行验收基础。
Windows 移植就绪证据见 platform evidence windowsPortReadiness。

## 缺陷清单

| ID | owner | 复现 | 严重度 | 回归测试 | 状态 |
| --- | --- | --- | --- | --- | --- |
| （暂无——发现即开责任卡，修复后完整重跑本卡） | | | | | |

## 已知缺口（继承预检，非本卡阻断项）

- native 窗口级 dirty-close 拦截（on_window_event）——待项目负责人拍板
- Cargo license 扫描覆盖——人工核验兜底
- 多窗口 create-window 权限——host 缺口待议
