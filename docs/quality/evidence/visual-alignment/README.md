# 视觉对齐与参考真实验收证据（VRA-080）

## 1. 证据概述

本目录存储 2026-09-06 参考对齐批次（VRA-080）在真实 React Flow 画布、真字体 FontResolver 及三格式导出渲染器下生成的自动化真实验收证据。

## 2. 证据分层与对应产物

| 层级 | 验收目标 | 证据文件 | 验收标准 |
| --- | --- | --- | --- |
| **Layer 1** | 1080×864 参考静态外观 | `layer1-static-reference-1080x864.png`<br>`layer1-static-dark-1080x864.png` | 暖白底色（#F9F8F4）/黑板底色（#16140F）、卡片纯色、无边框干扰、基线一致 |
| **Layer 2** | 散乱输入自动整理（横向/纵向） | `layer2-layout-horizontal.png`<br>`layer2-layout-vertical.png` | 全节点有限坐标、无矩形重叠、DAG 严格保序、多父收束、二次整理 no-op |
| **Layer 3** | 800ms 动态整理与形态插值 | `layer3-motion-000ms.png`<br>`layer3-motion-200ms.png`<br>`layer3-motion-400ms.png`<br>`layer3-motion-600ms.png`<br>`layer3-motion-800ms.png`<br>`layer3-motion-tree-17.png` | 坐标单调平滑推进、线形态 $0 \to 1$ 连续过渡无跳形、reduced-motion 0ms 归零、17 节点树收束 |
| **Layer 4** | 三格式真实导出 | `reference-dag-12-export.svg`<br>`reference-dag-12-export.png`<br>`reference-dag-12-export.pdf` | SVG 语义 `<text>`/`<tspan>`（无 foreignObject）；PNG 精确 2× 尺寸；PDF 矢量路径 |
| **Layer 5** | 交互编辑操作态 | `layer5-interaction-editing.png` | 双击进入富文本/IME 组合编辑态，未提交内容不影响画布与历史 |
| **Layer 6** | 300/450 规模与性能基线 | `visual-evidence-summary.json` | P95 帧间隔 $\le 32\text{ms}$，React Flow attribution 保留 |

## 3. 生成命令与可重复入口

- 独立运行视觉与动效真实验收：
  ```bash
  pnpm test:visual
  ```
- 质量总门禁执行：
  ```bash
  pnpm quality
  ```

## 4. 数据与生命周期约束

- **合成数据原则**：全部夹具与测试内容均采用中英双语合成数据，不包含真实用户个人信息、密码或密钥。
- **保留方式**：结构化测试指标写入 `visual-evidence-summary.json`，与代码版本（Commit SHA）绑定。产物随 Git 审计记录保留。
