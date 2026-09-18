# ADR 0018：安装包内嵌 MCP 独立运行时（Agent 免仓库接入）

- Status: Accepted
- ADR-Version: 1.0.0
- Date: 2026-09-18
- Deciders: 项目负责人（2026-09-18 定稿 [from-user]：同事内测流程「装 .exe → Agent 读文档 → 接入 MCP」，四选项中「选 A」）/ 主会话（评估与实现）
- Amends: ADR 0014（无头导出分发形态：新增「随安装包分发」，stdio 唯一通道不变）

## Context

ADR 0014 交付的 MCP 服务以 `pnpm --filter @mindmap/mcp-bridge start` 启动，前提：
clone 仓库 + Node ≥24 + pnpm install。该形态只服务负责人本机。

2026-09-18 负责人提出内测分发要求：同事（非开发者）只安装桌面应用安装包，
打开自己的 Agent 读接入文档即可使用 MCP——不 clone、不装 Node、不装 pnpm。

约束：不引入新网络通道（ADR 0014 零网络端点红线不变）；不触碰公开发布红线
（npm publish / GitHub Release 上传均未授权）；新增构建依赖须符合工程原则 #4。

## Decision

**把 MCP bridge 编译为零依赖单文件，随安装包分发一个 pinned Node 独立运行时：**

1. **产物形态**（安装包内 `mcp/` 目录，两文件）：
   - `mindmap-mcp(.exe)`：Node.js v24.21.0 官方独立二进制重命名（版本写死于
     `scripts/fetch-node-standalone.mjs`，下载时对照官方 SHASUMS256.txt 校验）；
   - `mindmap-mcp.mjs`：esbuild 打包的单文件 ESM，字体（woff2 ×3）与 resvg
     WASM 经 binary loader 内嵌，运行时零文件系统/node_modules 依赖。
2. **接入方式**（写进 Agent 指南，标准安装路径）：
   - Windows：`%LOCALAPPDATA%\Mind Map\mcp\mindmap-mcp.exe`，args `["%LOCALAPPDATA%\Mind Map\mcp\mindmap-mcp.mjs"]`；
   - macOS：`/Applications/Mind Map.app/Contents/Resources/mcp/mindmap-mcp` + 同名 `.mjs`。
   - 仍以 stdio 通信；工具面、参数、返回契约与仓库开发态完全一致
     （`createMindmapMcpServer` 单一共用装配，差异仅资产字节来源）。
3. **构建链路**：`scripts/stage-mcp-runtime.mjs`（build → fetch → **真实 MCP
   握手冒烟**：initialize/tools/list/render 落盘断言）在 CI 两平台 job 与本地
   `pnpm bundle:tauri` 前强制执行，冒烟失败即阻断打包。
   `apps/desktop/src-tauri/resources/` gitignored，构建前必须 staging。
4. **工具链选择**：esbuild（^0.25.12，devDependency，纯构建期，不进运行时）+
   官方 Node 独立二进制。否决项：
   - Bun `--compile`：单文件更简，但引入未验证的新运行时执行 MCP SDK/WASM（风险）；
   - Node SEA：资产须改 `sea.getAsset` API + postject 注入，代码搅动大、收益等同；
   - npm publish + npx：公开发布红线，内测阶段不授权。
5. **许可证**：Node.js（MIT）纳入 THIRD_PARTY_NOTICES 新增「Bundled runtimes」
   一节；版本与 fetch 脚本 pinned 常量解析同源，防漂移；license:scan 门不变。

## Consequences

- 正面：同事零开发环境接入 MCP；运行时与测试环境同为 Node 24；冒烟在 CI 双平台
  每次构建强制执行，资产内嵌回归可被发现；macOS 本地候选管线自动携带同一形态。
- 代价：安装包体积增加约 50MB（Node 二进制 + 内嵌资产；NSIS 压缩后约 +45MB）。
- 已知摩擦（内测接受，写进指南）：macOS 首次由外部进程拉起包内未签名二进制
  可能触发 Gatekeeper，指南给出 `xattr -dr com.apple.quarantine` 一行修复；
  Windows 侧 NSIS 写出的文件不带 MOTW，Agent 拉起不触发 SmartScreen。
- 版本演进：Node 版本升级 = 改 fetch 脚本常量 + 重生成 notices；server 版本升至
  0.2.0 标记分发形态变化。
