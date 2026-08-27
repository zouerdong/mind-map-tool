# 快捷键表（MM-080 交付物；单一事实源 `src/app/keyboard.ts`）

macOS 用 ⌘，Windows 移植用 Ctrl（同一归一化）。

| 快捷键 | 动作 | 说明 |
| --- | --- | --- |
| ⌘S | 保存 | ordinary save（handle+token，不弹选址对话框）；从未保存过 → 自动转另存为 |
| ⌘⇧S | 另存为… | 一次性选址授权（TargetAuthorization） |
| ⌘O | 打开… | dirty 时先确认丢弃 |
| ⌘N | 新建 | dirty 时先确认丢弃（浏览器 dev 中 ⌘N 被浏览器占用，用工具条） |
| ⌘E | 导出面板 | SVG / PNG / PDF 三格式（唯一 owner：web-ts-wasm） |
| ⌘⇧L | 一键整理 | 自由画布 → 垂直树（单条可撤销命令；丝滑动画，reduced-motion 关闭）[MM-085] |
| ⌘⇧H | 重放首次引导 | 同"帮助/设置"入口语义 |
| ⌘Z / ⌘⇧Z | 撤销 / 重做 | 画布层处理（画布 focus、非编辑态；见 ui/event-command-map.md） |
| Delete/Backspace | 删除选择 | 画布层处理 |
| 方向键 ↑↓←→ | 节点间导航 | 60° 方向锥最近节点；无焦点时从首个节点起 [MM-089] |
| Enter | 进入编辑 / 视口中心建节点 | 焦点节点→编辑；无焦点→建新节点 [MM-089] |
| ⌘L | 键盘连线（发起） | 焦点/选中为 source → 方向键换候选 → Enter 确认 / Esc 取消 [MM-089] |
| ⌘A | 全选 | 全部节点进入选择（Delete 删除）[MM-089] |
| ⌘+ / ⌘- / ⌘0 | 放大 / 缩小 / 适应内容 | 画布缩放 [MM-089] |

> **注（占位键位）**：以上键位为机制先行阶段的占位默认——最终键位将在
> MM-090 前的键位专项讨论中与项目负责人逐项定稿（AC-17：键位与快捷键表一致）。

## 隔离规则（PRD §6 / AC-02）

- 输入控件（textarea/input/contenteditable）内：应用级快捷键全部不派发（编辑自身处理 Enter/Escape）；
- IME 组合期间（isComposing / keyCode 229）：应用级与画布级快捷键均不派发；
- ⌘Z/⌘Z 重做在画布层而非应用层，避免与文本编辑 undo 冲突。
