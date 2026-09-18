# Agent 无头导出产品规格（2026-09-17）

状态：已由负责人口头确认实施（2026-09-17）；技术取舍以 [ADR 0014](../decisions/0014-headless-agent-export.md) 为准。

## 用户问题

用户的出发点是"给 Agent 用的脑图工具"。真实工作流：用户与 Agent 长篇对话讨论思路，希望 Agent 在后台直接调用本程序，**以参数调用的方式生成一张脑图文件**——不弹出程序界面，不要求用户盯着画布。产物默认 PNG 图片（可直接预览/分享），同时保留可在 GUI 中继续编辑的源文件。

## 范围（v0）

- Agent 宿主（pi / kimi / Claude Code / Codex 等任何 MCP 宿主）经 **MCP stdio** 调用本仓库提供的 `mcp-bridge`。
- 输入为 **LLM 友好的树状大纲**（`{text, children[]}`），bridge 转成 core 命令建图并自动整理布局（horizontal 默认**宽而浅分栏**：根在顶左、分支按宽高比自适应分栏并排；ADR 0014 v1.2.0）。
- 输出格式：默认 **PNG 2x**；可指定 `svg` / `pdf` / `json`（Graph JSON）/ `mindmap`（源文件）。
- **每次调用同时写出 `.mindmap` 源文件**（可关闭），用户想继续编辑时在 GUI 打开即可。
- 本机分发：直接把仓库内 bridge 路径注册进 Agent 宿主的 MCP 配置。

## 非目标（显式后置）

- **不做**实时画布（边说边生长）、不弹窗、无 GUI 联动——后置到独立版本，另行 ADR。
- **不做** localhost socket / HTTP 服务 / 任何网络端点；stdio 是唯一通道。
- **不做**自由交叉连线输入、富文本 runs、逐节点样式参数（v0 只收树状大纲 + 文档级字体/方向选项）。
- **不做**信任/配对 UX（bridge 只写文件，不控制运行中的 app，无此攻击面）。
- npm/npx 公开发行方式后置，另行授权。

## 验收标准（可观察、可复现）

1. dogfood：用户与 Agent 对话 → Agent 调 MCP 工具 → 指定路径出现 PNG，观感与 GUI 内导出一致（与 `test:export` golden 同源渲染管线保证）。
2. 同次调用生成的 `.mindmap` 可在 GUI 正常打开、继续编辑、撤销。
3. 大纲 → 文档转换经 core 统一命令层（CreateNode/CreateEdge/MoveNodes），不直接拼装文档对象。
4. 全部既有质量门保持绿（typecheck/lint/test:unit/test:export/boundaries/net:scan/license:scan）；新增包纳入 boundaries 与 net:scan 扫描范围。
5. 输出路径与输入体量有 fail-closed 校验（路径必须显式给出且为文件路径；节点数/文本长继承 core `LIMITS`）。

## 分发形态增补（2026-09-18，ADR 0018）

内测分发要求「同事只装安装包即可接入 MCP」。落地：MCP 编译为 esbuild 单文件
（字体/WASM 内嵌），随安装包分发 pinned Node 24.21.0 独立运行时（`mcp/` 目录：
Windows `%LOCALAPPDATA%\Mind Map\mcp\`，macOS `…/Contents/Resources/mcp/`）。
stdio 唯一通道与工具契约不变；构建期冒烟（initialize/tools/list/render 落盘）
在 CI 双平台与本地 `bundle:tauri` 前强制执行。Agent 接入指南已收入版本库
`docs/guides/agent-mcp-integration.md`（随发布分发；内测包副本随安装包一起发出）。
