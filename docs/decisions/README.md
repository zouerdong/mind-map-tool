# Architecture Decision Records

对框架、数据格式、渲染方案、状态模型、插件边界、更新机制等高成本决策使用 ADR。

## 命名

使用四位序号与简短标题，例如 `0001-desktop-runtime.md`。序号只增不复用。

## 状态

- `Proposed`：待确认。
- `Accepted`：已采纳并约束实现。
- `Superseded`：被更新 ADR 替代，保留历史。
- `Rejected`：已评估但未采纳。

从 [0000-template.md](./0000-template.md) 复制开始；一条 ADR 只处理一个关键决定。

G0/G1/G2 的机器登记应从 [decision-register-template.json](./decision-register-template.json) 初始化。模板初始为 fail-closed 的 `blocked/pending`，不代表任何技术选型已获批准。
