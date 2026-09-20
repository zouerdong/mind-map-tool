# Mind Map MCP 接入指南（给 Agent 看的版本）

> 本文档面向 AI Agent（Claude Code / Cursor / 其他 MCP 客户端）。读完本文档，你应能独立完成：找到并注册 mindmap MCP server → 调用工具生成脑图文件 → 正确处理返回结果。无需再查其他资料。
>
> 版本：2026-09-20 v3（v0.3.2：direction 新增 `balanced` 且为省略时默认；ADR 0018/0019）· 仓库 https://github.com/zouerdong/mind-map-tool（public）

---

## 1. 这个 MCP 是什么

Mind Map 的**无头导出通道**：把树状大纲渲染成脑图文件（PNG / SVG / PDF / JSON / .mindmap），**纯后台执行，不打开任何窗口**。渲染管线与 Mind Map 桌面应用同源，产物视觉一致。

典型用途：对话中整理出的计划 / 提纲 / 头脑风暴 → 直接产出一张脑图图片和一个可在桌面应用里继续编辑的 `.mindmap` 源文件。

---

## 2. 前提：同事已安装 Mind Map 桌面应用

安装包未签名，Windows 安装时会出现 SmartScreen 蓝色提示：点「更多信息」→「仍要运行」即可（一次性，内测阶段正常现象）。

MCP server 已经**随安装包内置**，不需要装 Node、pnpm 或克隆仓库。安装完成后，两个必需文件位于固定路径：

| 平台 | MCP 运行时 | MCP 程序 |
|---|---|---|
| **Windows**（默认每用户安装） | `%LOCALAPPDATA%\Mind Map\mcp\mindmap-mcp.exe` | `%LOCALAPPDATA%\Mind Map\mcp\mindmap-mcp.mjs` |
| **macOS** | `/Applications/Mind Map.app/Contents/Resources/mcp/mindmap-mcp` | `/Applications/Mind Map.app/Contents/Resources/mcp/mindmap-mcp.mjs` |

> 展开环境变量后的 Windows 典型路径：`C:\Users\<用户名>\AppData\Local\Mind Map\mcp\mindmap-mcp.exe`。
>
> **用户安装时改了目录？用注册表定位（优先，可复制执行）**：
>
> ```cmd
> reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Mind Map" /v InstallLocation
> ```
>
> 或 PowerShell：
>
> ```powershell
> (Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Mind Map").InstallLocation
> ```
>
> 输出值即安装目录（可能带首尾引号，去掉即可），`mcp\` 就在它下面。HKCU 查不到说明是「为所有用户安装」，改查 `HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\Mind Map`。兜底方案：`dir /s /b "C:\Mind Map.exe" 2>nul` 或从开始菜单快捷方式右键「打开文件所在的位置」。

**Agent 自检**：注册前先确认上述两个文件存在（`dir` / `ls`），不存在说明同事没装应用或改了安装目录。

### macOS 专属一步（首次）

应用未签名，首次由外部进程拉起包内二进制可能被 Gatekeeper 拦截。让同事**先双击打开一次 Mind Map 应用**（右键 → 打开）即可；若注册后仍报「无法打开」，执行：

```bash
xattr -dr com.apple.quarantine "/Applications/Mind Map.app"
```

Windows 无此问题（安装包写出的文件不触发 SmartScreen）。

---

## 3. 注册 MCP server

MCP 是通用协议，**TUI / GUI 客户端都能接入**。区别只在配置这一步谁动手：

- **编码类 Agent（Claude Code / Cursor 等）**：能自己执行命令、改配置文件 → 让它按本节自助完成；
- **Claude Desktop（纯对话界面）**：里面的 Agent 没有文件写入能力，只能生成配置文本 → **由人手工三步**（见 3.2），Agent 负责生成内容和答疑。

### 3.1 各客户端配置文件位置

| 客户端 | 配置文件 |
|---|---|
| Claude Desktop（Windows） | `%APPDATA%\Claude\claude_desktop_config.json`（也可在应用内 Settings → Developer → Edit Config 直接打开，文件不存在会自动创建） |
| Claude Desktop（macOS） | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Cursor | 全局 `%USERPROFILE%\.cursor\mcp.json`（macOS `~/.cursor/mcp.json`）或项目 `.cursor/mcp.json` |
| Claude Code | 项目 `.mcp.json` 或命令 `claude mcp add` |

### 3.2 Claude Desktop：人工三步

1. **拿到真实路径**：按 `Win+R` 输入 `%LOCALAPPDATA%` 回车 → 进入 `Mind Map\mcp` → 地址栏复制路径，形如 `C:\Users\张三\AppData\Local\Mind Map\mcp`（macOS 同事跳过，路径固定见第 2 节）；
2. **粘贴配置**：Claude Desktop → Settings → Developer → Edit Config，把下面 3.3 的 JSON 片段合入（`mcpServers` 下加 `mindmap` 一项；已有其他 server 就并列添加），路径用第 1 步复制的值；
3. **完全退出再启动**：Windows 上关窗口不算退出——右键任务栏托盘区的 Claude 图标 → Quit，再重新打开。对话页出现工具（🔨）入口即成功，首次调用会弹授权确认，允许即可。

### 3.3 配置片段（所有客户端通用，按平台替换路径）

把下面片段加入客户端的 MCP 配置，路径按平台替换：

### Windows

```json
{
  "mcpServers": {
    "mindmap": {
      "command": "C:\\Users\\<用户名>\\AppData\\Local\\Mind Map\\mcp\\mindmap-mcp.exe",
      "args": ["C:\\Users\\<用户名>\\AppData\\Local\\Mind Map\\mcp\\mindmap-mcp.mjs"]
    }
  }
}
```

（JSON 里反斜杠必须双写；`<用户名>` 替换为实际用户名——编码 Agent 可自行跑 `echo %LOCALAPPDATA%` 展开，Claude Desktop 场景用 3.2 第 1 步人工复制的路径。）

### macOS

```json
{
  "mcpServers": {
    "mindmap": {
      "command": "/Applications/Mind Map.app/Contents/Resources/mcp/mindmap-mcp",
      "args": ["/Applications/Mind Map.app/Contents/Resources/mcp/mindmap-mcp.mjs"]
    }
  }
}
```

注册后重启/重连客户端生效。

### 备选：开发同事（仓库模式）

有 Node ≥24 + pnpm 的同事也可从源码跑（接口完全一致）：clone 仓库 → `pnpm install` → 客户端配置 `command: "pnpm"`，`args: ["-C", "<REPO>", "--filter", "@mindmap/mcp-bridge", "--silent", "start"]`。仓库内 Claude Code 会话零配置（自带 `.mcp.json`）。

---

## 4. 工具：`render_mindmap`（目前唯一工具）

把树状大纲渲染为脑图文件。部分客户端里工具名会带前缀显示（如 `mindmap.render_mindmap`）。

### 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `outline` | object | ✅ | — | 树状大纲，递归结构 `{ "text": "节点文字", "children": [ ... ] }`。根节点 = 脑图中心主题。`text` 至少 1 个字符 |
| `outPath` | string | ✅ | — | 输出文件**绝对路径**，扩展名必须与 format 一致（如 `/tmp/plan.png`）。父目录必须已存在 |
| `format` | enum | 否 | `"png"` | `png` / `svg` / `pdf` / `json` / `mindmap` |
| `font` | enum | 否 | `"lxgw-wenkai"` | `lxgw-wenkai`（手写体）/ `noto-sans-sc`（黑体） |
| `direction` | enum | 否 | `"balanced"` | 整理布局方向：`balanced`（发散：主根居中、子节点左右两支展开，v0.3.2 起跟随应用默认）/ `horizontal` / `vertical` |
| `wide` | boolean | 否 | `true` | horizontal 时启用宽而浅自适应分栏（根在最左、分支按宽高比分栏并排）。非单根树自动回退普通分层 |
| `saveSource` | boolean | 否 | `true` | 同时写出同名 `.mindmap` 源文件（可在 Mind Map 桌面应用中打开继续编辑） |
| `emphasisRoot` | boolean | 否 | `true` | 根节点使用强调样式（橙色卡片） |

### 调用示例（最小）

```json
{
  "outline": {
    "text": "新品发布计划",
    "children": [
      { "text": "市场", "children": [ { "text": "竞品分析" }, { "text": "投放节奏" } ] },
      { "text": "产品", "children": [ { "text": "功能冻结" }, { "text": "内测" } ] },
      { "text": "运营", "children": [ { "text": "文案" }, { "text": "渠道" } ] }
    ]
  },
  "outPath": "/tmp/launch-plan.png"
}
```

（Windows 上 `outPath` 示例：`C:\\Users\\<用户名>\\Desktop\\launch-plan.png`。）

### 调用示例（指定样式：黑体 + 竖向 + PDF）

```json
{
  "outline": { "text": "季度复盘", "children": [ { "text": "数据" }, { "text": "问题" }, { "text": "行动" } ] },
  "outPath": "/tmp/review.pdf",
  "format": "pdf",
  "font": "noto-sans-sc",
  "direction": "vertical",
  "wide": false
}
```

---

## 5. 返回契约（必须检查 `ok` 字段）

### 成功

```json
{
  "ok": true,
  "out": "/tmp/launch-plan.png",
  "source": "/tmp/launch-plan.mindmap",
  "format": "png",
  "bytes": 183422,
  "nodes": 10,
  "edges": 9,
  "layout": "wide",
  "columns": 3
}
```

- `out`：主产物路径；`source`：`.mindmap` 源文件路径（`format: "mindmap"` 或 `saveSource: false` 时为 `null`）。
- `layout`：`wide`（宽分栏）或 `layered`（普通分层，wide 回退时）。
- 收到后把文件路径告诉用户即可；PNG 是 2x 分辨率。

### 失败（`isError: true`，内容为 JSON）

```json
{ "ok": false, "error": { "code": "BAD_OUT_PATH", "message": "输出父目录不存在：/tmp/xxx" } }
```

| code | 含义 | 你的处理 |
|---|---|---|
| `BAD_ARGS` | 参数非法（如 format 拼错） | 按第 4 节参数表修正后重试 |
| `BAD_OUT_PATH` | 路径为空 / 扩展名与 format 不符 / 父目录不存在 | 创建目录或修正扩展名后重试 |
| `BAD_OUTLINE` | 大纲结构非法（空 text、非树形等） | 修正 outline 后重试 |
| `LIMIT_EXCEEDED` | 超上限（节点 >10000 / 边 >30000 / 单节点文字 >10000 字符） | 拆分大纲，不要绕限 |
| `COMMAND_FAILED` | 内部命令层拒绝（message 含细节） | 报告给用户，附 message |
| `ORGANIZE_FAILED` | 布局跨度超限 | 减少单层节点数或改用 `direction: "vertical"` |

**行为守则**：失败时按上表修参数重试（同一请求最多重试 2 次）；不要伪造成功结果；不要把错误静默吞掉。

---

## 6. 大纲规则速查

- 只支持**单根树**：一个根对象，`children` 数组递归嵌套；不支持跨连接/汇流节点（v0 契约）。
- 根节点文字 = 脑图中心主题。
- 节点文字会原样渲染，支持中英文混排；过长的句子建议拆成多个子节点（视觉更好）。
- 空数组 `children: []` 与省略 `children` 等价。

---

## 7. 与桌面应用的关系（内测同事留意）

- 本 MCP **不需要**桌面应用运行，两者互不影响（ MCP server 是安装包内的独立进程）。
- 每次调用默认同时产出 `.mindmap` 源文件 → 双击（或应用内"打开"）即可在 Mind Map 桌面应用（macOS / Windows）里继续编辑、整理、导出。
- 这条「Agent 生成 → 人工精修」链路正是内测重点之一；如发现产物视觉或源文件打开异常，请把 `.mindmap` 文件和调用参数一起反馈。

---

## 8. 常见问题

| 症状 | 原因与处理 |
|---|---|
| 客户端报「找不到命令 / spawn ENOENT」 | 第 2 节的文件不存在：应用未安装、安装目录被改、或路径中 `<用户名>` 没替换。安装目录被改时用第 2 节的注册表命令定位（`Uninstall\Mind Map` → `InstallLocation`） |
| Claude Desktop 改完配置看不到工具 | 多半是「关窗口 ≠ 退出」：托盘图标右键 Quit 后重开；仍无则检查 JSON 语法（逗号/反斜杠双写）与路径是否存在 |
| macOS 报「无法打开，无法验证开发者」 | 见第 2 节 macOS 专属一步（先开一次应用，或 `xattr -dr com.apple.quarantine`） |
| Windows 路径怎么写 | `outPath` 用绝对路径，JSON 里反斜杠双写：`C:\\Users\\you\\Desktop\\map.png` |
| 工具调用报 `BAD_OUT_PATH: 输出父目录不存在` | 先确保目录存在（Agent 可先 `mkdir -p`） |
| 桌面应用升级后 MCP 行为变了 | 重装/升级应用会同时更新 `mcp/` 内文件；重连客户端即可 |

---

*文档版本 2026-09-20 v3；接口以仓库 `apps/mcp-bridge/src/create-server.ts` 与 `packages/headless/src/request.ts` 为准（分发形态 ADR 0018）。反馈渠道：内测群或直接提给 Erdong。*
