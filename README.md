# Mind Map Tool

一款极简、本地优先的自由脑图桌面工具。**v1 发布平台：macOS（Apple Silicon）**；Windows 为稳定后的专门版本（架构保留移植口，见 PRD §1.1）。

## 当前状态

技术选型已由 G1 批准（2026-08-26）：**Tauri 2 + React/TypeScript + React Flow + web-ts-wasm 导出（SVG/2x PNG/PDF）**；字体 Noto Sans SC（基础）+ 霞鹜文楷（手写可选）。Bootstrap（MM-020）已完成，正在按任务卡实现各模块。尚未公开发布。

## 标准命令（唯一来源）

```bash
# 前置：Node ≥24（.nvmrc）、pnpm 9（packageManager 固定）、Rust stable（rust-toolchain.toml）
pnpm install --frozen-lockfile   # 安装依赖

pnpm typecheck                   # 全包类型检查
pnpm lint                        # ESLint
pnpm format / format:check       # Prettier
pnpm test:unit                   # Vitest（含 decision-register 漂移负向测试）
pnpm build                       # apps/desktop 前端构建（vite）
pnpm icon:verify                 # 应用图标母版、桌面导出、manifest 与 Tauri 引用
pnpm quality                     # 质量总入口（类型/lint/单测/边界/许可/网络/golden/性能）

node scripts/quality/check-boundaries.mjs --scope selected-canvas   # 架构边界断言
node scripts/quality/scan-dependency-licenses.mjs                   # 依赖许可扫描
source ~/.cargo/env && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml  # Rust 侧

pnpm bundle:tauri                # 候选构建（由 bundle-gate 严格校验 G2 授权与 candidate-root 边界；检测到签名配置/凭据即 fail-closed，“unsigned”由签名提示门保证；--dmg-format ULMO 在盘点前把本轮唯一 DMG 转换为 ULMO 容器压缩，失败即整体失败不回退）
pnpm test:install:tauri         # 安装门（默认 --plan 零写入干运行；--execute 在 G2 批准的 deletionBoundaries 内沙箱验证）
```

性能采样入口（`run-performance.mjs`）在 `--scope release` 下由 G2 授权门保护，消费真实候选产物进行冷/热启动及 RSS 采样；无真实证据时不产假绿。

## 目录

```text
apps/desktop/            # Tauri 2 桌面组合根（src 前端 + src-tauri Rust host）
packages/core/           # 平台无关领域层（schema/命令/历史/DocumentSession，MM-030）
packages/export/         # 确定性导出：共享布局 + scene + SVG/PNG/PDF（MM-040）
packages/ui/             # 画布视图与交互（React Flow 获选，MM-050）
packages/platform/       # 平台 port 与适配（文件/生命周期，MM-060）
tests/                   # bootstrap 漂移测试；golden/fixtures 随卡建立
docs/                    # product/planning/architecture/decisions/quality
scripts/quality/         # 质量入口（唯一命令的实做层）
scripts/runtime-spike/   # MM-010 Spike harness（审计保留，非产品依赖）
```

完整约定见 [AGENTS.md](./AGENTS.md)；验收标准见 [PRD](./docs/product/v1-product-spec.md)；技术决定见 [ADR](./docs/decisions/) 与 decision register。
