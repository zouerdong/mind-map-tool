# ADR 0017：v1 双平台首发（macOS + Windows 同批）

- Status: Accepted
- ADR-Version: 1.0.0
- Date: 2026-09-17
- Deciders: 项目负责人（2026-09-17 定稿 [from-user]：「我想让 Windows 进首发」「选 A」）/ 主会话（评估与实现）
- Amends: `docs/product/v1-product-spec.md` §1/§1.1/§13.6（Windows = 后续专门版本）

## Context

v1 原范围（G1，2026-08-26）：macOS Apple Silicon 单平台，Windows 为"稳定后的专门版本"。
2026-09-17 负责人要求 Windows 进入首发，主会话按代码审计出具评估：

**架构准备度（已验证）**：Rust 仅 tauri + single-instance（零 macOS 专有 crate）；文件层
`cfg(unix)`/`cfg(not(unix))` 成对存在；快捷键 `CmdOrCtrl` + `metaKey||ctrlKey`；无平台嗅探；
`icon.ico` 早已备好；`fileAssociations` 为 Tauri 跨平台配置；平台适配层预留 Windows port。

**真实缺口**：Windows 文件身份 fallback（`cfg(not(unix))`）零测试覆盖；无 CI；
门禁工具（bundle-gate / verify-evidence / assemble-dmg）绑 macOS 产物形状；
未签名 Windows 有 SmartScreen 拦截（与未签名 DMG 同类，负责人已接受未签名路线）。

**有利条件**：负责人自有 Windows 设备（dogfood 可行）；公开仓库 GitHub Actions 免费。

## Decision

方案 **A（双平台正式首发，带降级阀门）**：

1. CI（GitHub Actions）构建双平台产物：`macos-latest`（aarch64-apple-darwin）与
   `windows-latest`（x86_64-pc-windows-msvc）；构建本身不签名（与既有未签名路线一致）；
2. macOS 正式发布产物仍走本地受控管线（bundle-gate + ULMO DMG 装配），CI macOS 构建作
   可复现性交叉验证；Windows 产物以 CI 为唯一构建路径，其证据链（workflow run id +
   产物 sha256）纳入发布证据；
3. **降级阀门**：第一个 Windows 安装包在负责人 Windows 设备冒烟 + dogfood 后定级——
   若问题为表层（菜单/文案/提示级），修复后按 A 同批发布；若暴露文件层深坑，当场降级为
   "macOS 正式 + Windows Beta"，不阻塞 macOS 首发；
4. `tauri.conf.json` bundle targets 增加 `nsis`（Windows 安装器；平台不适用目标自动跳过）；
5. Windows 门禁扩展（证据/哈希/平台验证说明）随首次 CI 产物落地后补齐，单独成卡；
6. ARM Windows 不覆盖（x64 仿真可用）；Intel Mac 维持不承诺。

## Consequences

- v1 维护面从单平台变双平台：平台差异继续只进 `packages/platform` port（工程原则 2 收紧为
  硬性验收项）；每次发布需双平台证据；
- SmartScreen 绕过说明写入 release notes 与 README；
- 仓库公开时间点提前（CI 依赖仓库存在）；公开发布动作仍逐项授权（红线不变）。
