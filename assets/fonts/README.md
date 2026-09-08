# Fonts

本目录存放随应用分发的字体资源（AGENTS.md 要求记录来源与许可证）。

## 分发格式（PRR-020，2026-09-07）

随应用打包分发的字体为 **WOFF2 全字库**（三份 `.woff2`），由下表原版
TTF/OTF 经 fontTools `ttLib.woff2 compress`（4.64.0，Brotli）无损转换：
字形表（glyf/CFF/cmap/hmtx/name 等）逐字节一致，仅 `head` 表
checkSumAdjustment 重算、Noto 丢弃废弃 DSIG 表。已验证：

- fontkit 度量 advance / unitsPerEm / ascent 与原字体一致（逐字符零差异）；
- resvg（PNG）对同一 SVG 的渲染输出与 TTF 输入 **byte-identical**；
- @pdf-lib/fontkit（PDF 嵌入）直接消费 WOFF2；LXGW 全字库嵌入流因
  head 校验和重算产生不同 PDF bytes（golden 已按此更新，字形/布局等价）；
- 全字库无子集化：CJK 覆盖与缺字行为与原字体完全相同。

体积：41,618,004B（TTF/OTF）→ 20,770,972B（WOFF2）≈ 50%。这是应用
引用的字体源文件总量，不等于安装包中的字体贡献；对最终 DMG 的实际影响必须
由 PRR-070 对新候选实包测量，不得用源文件字节和替代 installer bytes。

原版 `.ttf`/`.otf` 保留在本目录作为审计与转换源，**不再被应用引用**
（vite `?url` 仅打包 `.woff2`）。

| 文件 | 字体 | 用途 | 许可 | 来源 |
| --- | --- | --- | --- | --- |
| `noto-sans-sc-regular.woff2` | Noto Sans SC Regular（SubsetOTF→WOFF2） | 分发用基础排版 | SIL OFL 1.1 | 由下表 `noto-sans-sc-regular.otf` 转换 |
| `noto-sans-sc-bold.woff2` | Noto Sans SC Bold（SubsetOTF→WOFF2） | 分发用富文本加粗 | SIL OFL 1.1 | 由下表 `noto-sans-sc-bold.otf` 转换 |
| `lxgw-wenkai-regular.woff2` | 霞鹜文楷 Regular（TTF→WOFF2） | 分发用手写风格字体 | SIL OFL 1.1 | 由下表 `lxgw-wenkai-regular.ttf` 转换 |
| `noto-sans-sc-regular.otf` | Noto Sans SC Regular（SubsetOTF） | 转换源（审计） | SIL OFL 1.1 | https://github.com/notofonts/noto-cjk (Sans/SubsetOTF/SC) |
| `noto-sans-sc-bold.otf` | Noto Sans SC Bold（SubsetOTF） | 转换源（审计） | SIL OFL 1.1 | 同上 |
| `lxgw-wenkai-regular.ttf` | 霞鹜文楷 LXGW WenKai Regular | 转换源（审计） | SIL OFL 1.1 | https://github.com/lxgw/LxgwWenKai (v1.520) |
| `OFL-1.1.txt` | SIL Open Font License 1.1 全文 | 许可文本（随包分发时保留） | — | notofonts/noto-cjk 仓库 |

转换命令（隔离环境，不入库）：

```bash
python3 -m venv .tmp/font-tools-venv
.tmp/font-tools-venv/bin/pip install fonttools brotli
.tmp/font-tools-venv/bin/fonttools ttLib.woff2 compress <source> -o <target>.woff2
```

注意事项：

- 霞鹜文楷**无真粗体字重**：富文本加粗在文楷模式下用描边模拟（视觉近似，导出确定性不受影响）。
- OFL 1.1 允许随应用再分发与嵌入（含导出物 PDF 内嵌子集）；**禁止单独出售字体本体**。
- 修改/子集化后的字体不得继续使用 Reserved Font Name（"Noto Sans SC" / "LXGW WenKai"）。
  WOFF2 为无损格式转换（名称表未改、无字形修改），OFL FAQ 允许的
  分发形态；任何后续子集化或字形修改都必须更换 RFN 并回到 PRR-020 评审。
