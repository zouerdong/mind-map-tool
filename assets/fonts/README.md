# Fonts

本目录存放随应用分发的字体资源（AGENTS.md 要求记录来源与许可证）。

| 文件 | 字体 | 用途 | 许可 | 来源 |
| --- | --- | --- | --- | --- |
| `noto-sans-sc-regular.otf` | Noto Sans SC Regular（SubsetOTF） | 基础排版（[from-user] G1 字体决定） | SIL OFL 1.1 | https://github.com/notofonts/noto-cjk (Sans/SubsetOTF/SC) |
| `noto-sans-sc-bold.otf` | Noto Sans SC Bold（SubsetOTF） | 富文本加粗（[from-user] 2026-08-26 需求） | SIL OFL 1.1 | 同上 |
| `lxgw-wenkai-regular.ttf` | 霞鹜文楷 LXGW WenKai Regular | 手写风格第二字体（[from-user]） | SIL OFL 1.1 | https://github.com/lxgw/LxgwWenKai (v1.520) |
| `OFL-1.1.txt` | SIL Open Font License 1.1 全文 | 许可文本（随包分发时保留） | — | notofonts/noto-cjk 仓库 |

注意事项：

- 霞鹜文楷**无真粗体字重**：富文本加粗在文楷模式下用描边模拟（视觉近似，导出确定性不受影响）。
- OFL 1.1 允许随应用再分发与嵌入（含导出物 PDF 内嵌子集）；**禁止单独出售字体本体**。
- 修改/子集化后的字体不得继续使用 Reserved Font Name（"Noto Sans SC" / "LXGW WenKai"）。
