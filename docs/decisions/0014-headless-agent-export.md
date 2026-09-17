# ADR 0014: Agent 无头导出接口（MCP stdio + 大纲契约）

- Status: Accepted
- ADR-Version: 1.2.0
- Date: 2026-09-17
- Owners: ErDong Zou（产品方向与范围决策）/ 主会话（工程实现）
- 任务来源: 负责人 2026-09-17 调整首发范围：公开发布推迟，先做 Agent 后台调用生成脑图文件；实时画布显式后置
- v1.1.0（2026-09-17，同日 dogfood 决定）：horizontal 默认曾改为中心根双侧镜像——**同日被负责人 dogfood 否决**：连线契约是"右缘发出、左缘进入"，左侧盒子的线只能反着走，视觉别扭。
- v1.2.0（2026-09-17，负责人定向："根放最左边，其余都在右边，依然宽而浅"）：**根置顶左 + 顶部布线通道 + 一级分支连续分栏并排**。全部保持左→右流向，根→各栏连线沿顶部通道直行后垂直进栏（恰好是边路由器 comb 直连路径，不穿盒、不反向）。栏数自适应：候选 1..6 栏连续切分（DP 最小化最高栏，超 64 支贪心兜底），按 |ln(实际宽高比/1.6)| 最小选定；1 栏 = 紧凑单栏（根垂直居中）。非单根树/坐标超限回退 organize 单侧层叠。实现位于 packages/headless（纯几何布局，不改 core、不改 GUI 整理契约）；wide 参数可关。

## Context

产品出发点预设了"给 Agent 用"。负责人明确的首发诉求：与 Agent 对话后，Agent 以参数调用方式在后台生成脑图文件（默认 PNG），不弹窗、不做实时画布。

Territory 事实（2026-09-17 核查）：

- `packages/core` 的命令层（`applyCommand`：CreateNode/CreateEdge/MoveNodes/SetDocumentStyle…）与 `organize` 布局平台无关；2026-09-12 事故的根因教训是任何路径不得绕过统一 commit/version 通道。
- `packages/export` 的文本度量（fontkit 纯 JS）、resvg WASM（字节注入 `initResvgWasm`）、pdf-lib 全部 Node 可用；`tests/golden/export/export-fixtures.ts` 已在 Node 无头环境跑通完整导出管线。
- net:scan 门（AC-13：无服务器/云/遥测）对产品代码 fail-closed；stdio 不是网络端点。
- 2026-09-16 冻结候选（MM-110 ACCEPT）不因此 ADR 作废为审计记录，但公开发布候选将换证（开源 LICENSE）且并入本功能后重建。

备选方案：① localhost HTTP/WebSocket 服务——引入网络端点与本地鉴权攻击面，违反本地优先承诺，否决；② 实时画布控制（socket + 统一 commit 通道 + 信任 UX）——负责人判定过大，显式后置；③ CLI 直调——保留为调试通道，但用户生态（pi/kimi/Claude/Codex）均以 MCP 为 Agent 接入标准，stdio MCP 是主入口。

## Decision

1. 新增 `packages/headless`（`@mindmap/headless`，private）：平台无关的无头渲染编排。输入树状大纲，经 core 统一命令层建文档（CreateNode/CreateEdge，节点 size 一律经 export `measureNodeVisual` 度量，不得手工估算），`organize` 布局后以 MoveNodes 落定，再走 export 渲染管线输出文件。依赖方向：`core` / `export` ← `headless`；headless 禁依赖 react/xyflow/tauri，纳入 check-boundaries。
2. 新增 `apps/mcp-bridge`（`@mindmap/mcp-bridge`，private）：MCP stdio 服务，宿主注入的唯一通道。工具面 v0 收敛为单个 `render_mindmap`（参数：outline、format、outPath、font、direction、saveSource）。零网络端点；`packages/headless/src` 与 `apps/mcp-bridge/src` 纳入 net:scan 扫描目录。
3. 大纲契约 v0：`{ text, children[] }` 树；id 由 bridge 确定性派生（`n-1…`）；节点数/文本长继承 core `LIMITS` fail-closed；自由交叉连线、runs 富文本、逐节点样式后置。
3a. （v1.2.0）布局默认：direction=horizontal 时默认应用宽而浅自适应分栏布局（wide 参数默认 true；根顶左 + 顶部布线通道 + 分支连续分栏，目标宽高比 1.6）；vertical 或守卫回退时使用 organize 单侧层叠。分栏布局在 headless 内实现，坐标上限守卫失败即整体回退，不产非法坐标。
4. 输出：默认 `png`（2x，与 GUI 导出一致）；可选 `svg`/`pdf`/`json`/`mindmap`；除显式关闭外同时写出 `.mindmap` 源文件。`outPath` 必须显式、指向文件路径、父目录已存在；格式与路径校验失败即错误返回，不猜测、不静默改路径。
5. 新运行时依赖仅 `@modelcontextprotocol/sdk`（bridge 使用）：用途= MCP stdio 协议实现；包体影响=仅 bridge 私包，不进桌面包；许可证 MIT；替代方案=手卷 stdio JSON-RPC（协议面小但需自维护能力协商/错误码，收益不抵成本）。
6. 桌面 app bundle 零改动；不弹窗、无 GUI 进程依赖；app 运行与否不影响无头导出。
7. 分发后置：本机 dogfood 直接注册仓库路径；npm/npx 公开分发另行授权。实时画布、localhost 传输、信任/配对 UX 均需独立 ADR，不得在本接口内渐进混入。
8. 首个公开发布版本并入本功能与开源换证（LICENSE 变更另行 ADR/登记）；版本号发布时再定。

## Consequences

- 正向：Agent 接入成为首发能力；渲染产物与 GUI 导出字节级同源（同一管线），无"两套渲染"维护负担；零网络面使 AC-13 承诺不变。
- 代价：新增两个 workspace 包与一条 MCP SDK 依赖链（license:scan 纳入）；大纲契约一旦随公开版对外使用即进入 schema 兼容承诺，破坏性变更需迁移方案 + 新 ADR。
- 既有冻结验收链（a87d7b3 / MM-110 ACCEPT）保留为审计历史；公开发布候选在本功能与换证完成后重建并重走收窄质量门 + 差额批准。
- 后置项的明确清单（实时画布、自由连线输入、公开分发、版本号）不得由实现侧提前收口。
