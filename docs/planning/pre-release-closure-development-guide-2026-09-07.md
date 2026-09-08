# 发布前收口开发指南（PRC 批次）

日期：2026-09-07  
状态：`HISTORICAL / EXECUTED / FINAL_REVIEW_REJECTED / SUPERSEDED_BY_PRR`
适用范围：Mind Map Tool v1、macOS Apple Silicon、公开发布前的工程收口  
输入：[发布前终审](../../.omx/reviews/2026-09-07-mrt-post-vra-final-review.md)、[v1 产品规格](../product/v1-product-spec.md)、[发布检查表](../quality/release-checklist.md)、已落地代码与测试  
配套任务卡：[pre-release-closure-task-cards-2026-09-07.md](./pre-release-closure-task-cards-2026-09-07.md)

> 本文把“代码基本完成”与“可公开发布”拆开处理。本文及任务卡的形成已获用户要求；它们不构成修改 CI/发布配置、删除文件、签名、公证、上传或公开发布的授权。
>
> 2026-09-07 复核：PRC 执行虽已回报完成，但候选、性能、许可、G2/G-FINAL 与证据链未通过独立审阅。后续以[全面代码审阅](../quality/pre-release-code-review-2026-09-07.md)和 [PRR 整改指南](./pre-release-remediation-development-guide-2026-09-07.md)为准；本文不再作为派发入口。

## 1. 结论与最短路径

当前实现已经具备主要产品能力，通用类型检查、Lint、单元测试、集成测试、可访问性测试与构建均可通过；但还不能称为“发布完成”。真正剩余的是五类收口工作：

1. 纠正发布门对平台范围的误读：v1 的唯一发布平台是 macOS Apple Silicon，Windows 是后续专门版本，不应继续阻断本次 v1。
2. 关闭三个仍有真实风险面的可靠性问题：文件打开必须把读取内容与文件身份绑定到同一底层对象；全局快捷键必须在聚焦窗口前取得原始焦点事实；字体未就绪时不能把 fallback 度量提交为持久化权威尺寸。
3. 完成生产安全、候选 runner 与产品身份：非空 CSP、最小权限、可实际执行的 bundle/install/performance gate、产品名、bundle identifier、扩展名/UTI、许可证与第三方 notices。
4. 把当前大规模脏工作树整理成可追溯、可复现的干净源码基线。
5. 在 G2 明确授权范围内产出 unsigned macOS 候选包，完成原生性能、安装/生命周期与最终视觉验收，再做 MM-110 独立终审。

推荐执行顺序是：

`基线清点 → 平台门纠偏 + 两项可靠性修复 + CSP/身份决策 + 候选 runner 实装 → 干净源码基线 → unsigned 候选包 → 原生证据 → 最终终审 → 发布交接`

这条路径不要求 Windows 实机证据，也不会把“无法访问 Windows 设备”伪装成 macOS v1 的发布阻塞项。

## 2. 当前事实基线

以下是 2026-09-07 终审时的事实，不是后续任务可跳过复核的固定数字：

| 项目 | 当前结果 | 发布含义 |
| --- | --- | --- |
| TypeScript/Rust 构建与常规测试 | 通过；Rust 179 tests、TS unit 386、integration 57、a11y 9 | 主体实现可信，但不等于发布候选已验证 |
| `pnpm quality` | 仅 `releasePerformance` / `evidence` 未闭环 | 需要候选包、原生报告和正确的平台范围模型 |
| Git 工作树 | 112 个 tracked 变化、59 个 untracked，共 171 个路径；另有 1 个 tracked 删除 | 无法把当前目录直接视为可复现发布源 |
| G2 | `pending` | 不得开始受 G2 约束的候选打包、安装或发布动作 |
| Tauri CSP | `null` | 生产安全门未关闭 |
| 文件打开 | 内容读取和路径身份复核分两次访问 | 仍存在路径对象在两次访问间被替换的窗口 |
| 全局快捷键 | host 先 show/focus，再由前端读 `document.hasFocus()` | 无法可靠区分“调用前已聚焦”与“刚被 host 聚焦” |
| 延迟字体 | 首帧使用 `DEV_FONTS` proxy；真实字体 ready 后只刷新 UI | ready 前创建/编辑的 node size 可能永久保存为 fallback 几何，与导出契约不一致 |
| 发布平台文档 | PRD/Accepted ADR 均为 macOS v1 | 当前双平台 evidence verifier 与权威范围冲突 |
| 候选工具链 | release performance 与 install gate 仍为固定 BLOCKED 占位；bundle gate 未校验 G2 scope | 即使批准 G2，也还不能直接完成候选测量/安装验收 |
| 主入口预算 | 495,995 / 500,000 bytes | 只余 4,005 bytes，后续必须防止越线，不能抬阈值掩盖回归 |

## 3. 权威发布范围

本批次必须以以下层级解释发布范围：

1. `docs/product/v1-product-spec.md` 的 §1.1、AC-14 与 G1 记录：v1 仅发布 macOS Apple Silicon；Windows 为后续专门版本，明确不属于 v1 验收。
2. Accepted ADR 0001、0006：macOS 原生证据构成本轮完整验收基础。
3. `docs/quality/` 与 `scripts/quality/`：只能实现上述范围，不能自行扩大产品发布平台。

当前 PRD 的旧性能表，以及 `v1-quality-gates.md`、`v1-test-spec.md`、risk/licensing/evidence 索引仍残留“双平台 v1”措辞。它们属于 G1 范围变更后未同步的下游漂移；PRC-010 要在 `G-PRC-SCOPE` 下逐项纠正，但不得反过来修改 §1.1/AC-14 来迎合旧表。

因此应把发布证据模型改成显式范围，而不是把平台列表写死在 verifier 中：

```json
{
  "releaseScope": {
    "productVersion": "v1",
    "requiredPlatforms": ["macos"],
    "deferredPlatforms": [
      {
        "platform": "windows",
        "reason": "Dedicated later release; outside v1 acceptance",
        "decisionRef": "docs/product/v1-product-spec.md"
      }
    ]
  }
}
```

约束如下：

- `requiredPlatforms` 的每个平台都必须有有效、与当前候选 hash 绑定的原生报告；缺少任意一个即失败。
- `deferredPlatforms` 必须包含原因和权威引用；`not-run/deferred` 不影响当前 v1 的 `READY`，但不得被写成已通过。
- verifier 必须拒绝重复、未知或互相重叠的平台项，防止用 schema 松动来绕过门禁。
- Windows 仍保留 TypeScript/Rust 编译、平台适配层边界与静态可移植性检查；它们是移植准备，不是 v1 原生发布证据。
- 此修订改变 release/CI 判定行为，即使它是在纠正文档漂移，执行前仍需项目负责人批准 `G-PRC-SCOPE`。

## 4. “完成”的四个层级

不要再把下面四个状态混称为“开发完成”：

| 状态 | 必须满足 | 不代表 |
| --- | --- | --- |
| `IMPLEMENTATION_COMPLETE` | PRC-010～PRC-055 完成；相关单元/集成测试通过 | 已有干净发布源或候选包 |
| `SOURCE_READY` | PRC-050 决策落档；PRC-060 形成干净、可追溯 commit；全套源码门通过 | 候选包已在真实 macOS 环境验证 |
| `RELEASE_CANDIDATE_READY` | G2 已批准；PRC-070 unsigned 候选包及 macOS 原生证据完整；G-FINAL 通过 | 已签名、公证或对外发布 |
| `READY_TO_RELEASE` | PRC-080 独立终审 `ACCEPT`；PRC-090 交接包完整；没有未决 P0/P1 | 已获得公开发布授权 |

公开发布是下一阶段的独立动作，需要用户再次明确授权；本批次到 `READY_TO_RELEASE` 为止。

## 5. 批次 Gate

| Gate | 决策者 | 通过条件 | 阻塞动作 |
| --- | --- | --- | --- |
| `G-PRC-PLAN` | 项目负责人 | 接受本指南、任务卡、依赖和验收口径 | 除只读清点外的 PRC 实施 |
| `G-PRC-SCOPE` | 项目负责人 | 明确 v1 `requiredPlatforms=[macos]`、Windows deferred | 修改 quality/CI 的发布判定 |
| `G-PRC-ADR` | 项目负责人/架构 owner | 完成 ADR 0011 as-built 对账，并接受 descriptor-bound open、font-metrics barrier 与 shortcut pre-focus 协议 | PRC-020、PRC-025、PRC-030 生产实现 |
| `G-PRC-CONFIG` | 项目负责人 | 批准生产 CSP、capability 变更及验证方法 | 修改 Tauri 生产配置 |
| `G2` | 项目负责人 | 产品身份、许可、候选类型、允许路径/动作与清理边界全部有精确记录 | unsigned 候选打包、安装、卸载；签名、公证、发布始终另 Gate |
| `G-FINAL` | 项目负责人 | 对候选应用完成最终视觉/体验验收 | `RELEASE_CANDIDATE_READY` 判定 |
| `MM-110` | 独立审阅者 | 基于同一 commit、candidate hash 和证据包给出 `ACCEPT` | `READY_TO_RELEASE` 判定 |

如果 Gate 只批准其中一部分，只执行被明确批准的部分；不得把“批准任务卡”解释成“批准所有红线动作”。

## 6. 工作包与依赖

| 卡号 | 工作包 | 依赖 | 主要交付 |
| --- | --- | --- | --- |
| PRC-000 | 源码基线清点与变更账本 | 无，只读可先行 | 171+ 路径重新盘点、归属/去留/证据分类、无未知来源 |
| PRC-010 | v1 平台范围与发布门纠偏 | G-PRC-PLAN、G-PRC-SCOPE | 显式 scope schema、verifier/test、更新 release checklist |
| PRC-015 | ADR 0011 as-built 对账与架构放行 | PRC-000、G-PRC-PLAN | 实现/决定/测试映射、漂移结论、owner accept/reject 记录 |
| PRC-020 | descriptor-bound 文件打开 | G-PRC-ADR | ADR、同一对象读取与身份绑定、竞态回归测试 |
| PRC-025 | 字体 ready 前的权威几何提交屏障 | G-PRC-ADR | 延迟解析契约、无 fallback size 持久化、启动/编辑回归测试 |
| PRC-030 | 全局快捷键 pre-focus 协议 | G-PRC-ADR | request/response 路由、单次调用身份、五状态原生证据 |
| PRC-040 | 生产 CSP 与最小权限 | G-PRC-CONFIG | 非空生产 CSP、能力审计、无远程端点、运行验证 |
| PRC-050 | 产品身份、许可与 G2 决策包 | G-PRC-PLAN | 所有产品/法律/候选问题的明确答案与落档 |
| PRC-055 | 候选 bundle/install/performance runner 实装 | PRC-010、PRC-050 schema | G2 scope 执行门、dry-run、原生采样与 artifact 输出契约 |
| PRC-060 | 集成、追踪与干净源码基线 | PRC-000～055 | 可审阅 commit、clean worktree、全量源码门、source hash |
| PRC-070 | unsigned macOS 候选与原生验收 | PRC-060、G2 | candidate hash、性能/安装/生命周期/视觉证据 |
| PRC-080 | 最终 quality 与 MM-110 终审 | PRC-070、G-FINAL | `pnpm quality` 全绿、evidence verified、MM-110 `ACCEPT` |
| PRC-090 | 发布执行交接（不发布） | PRC-080 | release packet、checksum、notices、操作清单、回退说明 |

PRC-010、015、040 与 PRC-050 的信息收集在各自 Gate 通过后可以并行；PRC-015 完成 G-PRC-ADR 后再并行 PRC-020/025/030。PRC-055 等 PRC-010 的 scope 契约和 PRC-050 的 G2 schema 定稿后实施。PRC-060 是唯一集成汇合点。PRC-070 以后必须严格串行，保证所有证据都绑定同一源码 commit 和同一候选 hash。

## 7. 技术实施边界

### 7.1 源码基线不是“把 status 清空”

PRC-000 先为每个 tracked/untracked/deleted 路径建立账本，至少记录：来源批次、owner、用途、是否属于发布源码、是否属于可再生证据、是否预期入库、所需批准。不得为追求 clean 而删除不明文件、丢弃用户修改或用 `git reset --hard`。

真正的 `SOURCE_READY` 在 PRC-060 才产生：已批准的源码和文档进入可审阅 commit，可再生输出有生成命令，外部参考输入仍保留其来源/许可证说明，工作树无未解释变化。

### 7.2 文件打开必须绑定同一底层对象

单纯“读完后再按路径 stat 一次”不能证明内容来自最终授权的对象。推荐协议：

1. 对 canonical target 只打开一次，取得 host 文件描述符/handle。
2. 从该描述符读取 metadata identity，并通过同一描述符做 50 MiB 有界流式读取与 SHA-256。
3. 在发放 capability 前检查当前路径仍指向该 descriptor identity；发生变化时返回稳定、可重试错误，不发放 orphan handle。
4. capability 保存 descriptor-derived identity 和 digest；后续保存仍沿用 generation/reservation 规则。
5. canonical-only 平台必须显式声明，不允许在实现层静默降级成“路径相同就算同一对象”。

该改动涉及跨平台文件身份与长期兼容成本，先写 ADR，再改生产代码。

### 7.3 全局快捷键必须先取事实，再改变焦点

host 不能先 show/focus 再问 renderer “刚才是否聚焦”。推荐两阶段协议：

1. host 生成单次 `invocationId`，向最近窗口发送 pre-focus probe，暂不改变焦点。
2. renderer 返回调用瞬间的 `document.hasFocus()` 和 window generation；编辑态仍由现有画布交互状态机负责拒绝建点。
3. host 校验 invocation、window id、generation，且每个 invocation 只能消费一次。
4. 原先聚焦时才发 quick-create，再由画布沿用编辑态 no-op 契约；原先未聚焦时只 show/focus，不创建节点。
5. renderer 无响应时，允许安全退化为“只唤醒、不创建”；过期 invocation 必须失效，不能延迟创建。

协议测试必须覆盖：前台空闲、前台编辑、后台窗口、最小化窗口、无窗口/冷启动，以及过期响应和窗口重建。超时只能用于安全退化和资源回收，不能作为正确性判断依据。

### 7.4 字体延迟加载不能污染持久化几何

`FontResolver` proxy 在真实字体载入前使用 `DEV_FONTS` 近似宽度，而 node `size` 又是 schema 中的持久化权威。ready 后仅触发 React 刷新不会修正已经提交的尺寸；快速创建、文本编辑、眉题或字体切换都可能把近似值永久保存。

本批次保留“首帧不等待重型导出资源”的决定，但增加 geometry commit barrier：

1. 画布和已有文档可以立即显示；已有 node size 继续以文档值为权威，不做隐式全图重排。
2. 任何会依据字体度量产生新 size 的命令，在真实 bundled font resolver ready 前不得提交。
3. 推荐保留用户意图/编辑内容，异步等待字体后用真实 resolver 计算并一次提交；不能悄悄丢操作或先存 fallback 再后台改写。
4. 字体加载失败时显示可恢复错误，保持输入内容，不生成部分 command，也不允许保存一个自称 canonical 但尺寸来自 fallback 的文档。
5. 若等待时间实测影响交互，再将字体 metrics 与 PDF/resvg 重资源拆开；不能用恢复启动阻塞或放宽布局契约掩盖问题。

### 7.5 CSP 以真实构建产物为输入

先盘点 `dist/` 中脚本、样式、字体、WASM 与 Tauri IPC 所需 scheme，再定义生产 CSP。最低要求：

- `default-src 'self'`，不允许 `*`；生产配置不允许 `unsafe-eval`。
- 没有产品批准的联网需求，因此不得出现任意 `http:`、`https:` 或通用远程白名单。
- 字体、图片、WASM、worker 和 IPC 只开放真实使用的本地来源。
- 如果框架确实要求 inline style，单独记录理由、影响面和替代方案，不能把它扩展到 script。
- dev CSP 与 production CSP 分开；不能为了开发服务器便利放宽生产配置。
- capability 文件逐项解释用途，未使用命令和窗口权限移除前需获得删除/配置变更授权。

### 7.6 产品身份和法律文本不能由执行者猜测

PRC-050 必须让项目负责人明确：显示名、bundle identifier、版本号、默认文件扩展名、UTI/MIME、文件关联、应用图标最终来源、软件许可证、第三方字体/依赖 notices、候选包类型、是否允许本机安装/卸载。任何未回答项都应标为 `BLOCKED`，不能用占位文本进入候选包。

### 7.7 候选证据必须同时绑定源码与二进制

候选专属的 raw evidence、时间戳报告和 readiness manifest 必须写入 G2 批准的 release artifact 目录，且该目录不属于 tracked source tree。最终 verifier 在 PRC-060 的 clean source commit 上通过显式 `--manifest <path>` 消费它；不能先改 tracked evidence、再把新 HEAD 冒充成构建候选所用的 source commit。

仓库内可追踪 schema、合成 fixture、生成器和稳定模板；候选专属证据如需在发布后归档，使用单独的 attestation commit，并保留 `candidateSourceCommit`，不得重写候选来源。这样同时满足源码 clean、证据可复核和二进制来源不漂移。

每份原生报告至少包含：

- `sourceCommit`、工作树 clean 证明；
- candidate absolute/recorded path、SHA-256、包大小、内部 app 大小；
- OS build、CPU、内存、显示缩放、测试时间；
- 冷/热启动、RSS、密集画布交互、打开/保存/另存为/关闭、崩溃恢复、全局快捷键、SVG/2x PNG/PDF；
- PASS/FAIL/BLOCKED 的原始数据和测量命令；
- 与当前 release scope 一致的平台状态。

不得复用旧候选的截图或性能数据证明新 candidate。candidate hash 改变后，所有 native evidence 都要重新生成或明确说明为何仍然等价；默认按重新生成处理。

## 8. 统一验证入口

所有任务先运行自身最小验证；PRC-060 与 PRC-080 再运行全量门。根 README 是命令唯一来源，当前最低集合为：

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm quality -- --release-evidence <approved-manifest-path>
git diff --check
```

补充规则：

- Rust host 改动必须运行相应 `cargo test`；不得只依赖 TypeScript adapter test。
- 发布 scope/verifier 改动必须有正反 schema fixture：macOS 完整可通过、macOS 缺失必失败、Windows deferred 不阻断、Windows 被列为 required 时缺失必失败。
- CSP 改动必须在真实 production build 中启动应用并检查控制台/日志，不接受只看配置文本。
- PRC-070 的性能和生命周期命令必须以 candidate app/bundle 为目标，不得把 Vite dev server 当成发布候选。
- 若 `pnpm quality` 因尚未获得 G2 或候选不存在而失败，报告应精确写 `BLOCKED_BY_G2` 或 `BLOCKED_BY_CANDIDATE`；进入 PRC-080 后不允许继续带此例外。
- 不带 `--release-evidence` 时，quality 必须 fail-closed，不能自动读取旧候选的 tracked manifest 获得假绿。

## 9. 全局 STOP 条件

命中任一项立即停止对应工作包并报告，不得自行绕过：

- 需要删除文件/目录、丢弃改动或重写 Git 历史，但没有逐项批准。
- 需要修改 CI/CD、生产 Tauri 配置或发布门，但对应 Gate 未批准。
- G2 未精确说明允许的输出路径、候选类型、安装/卸载与清理边界。
- 产品身份、许可证、文件扩展名或 bundle identifier 仍是占位符。
- descriptor-bound 协议在目标平台无法成立，且只能退化为路径复核。
- shortcut 协议只能靠 sleep/固定延时保证是否创建节点。
- 候选产物与 source commit 无法一一对应，或生成后工作树出现未解释变化。
- 主入口超过 500,000 bytes，或通过抬阈值/跳过检查才能通过。
- 任一 P0/P1 未关闭，或 P2 只有口头接受而无 owner/理由/到期条件。
- 任何任务要求签名、公证、上传、`git push` 或公开发布；这些都需要独立明确授权。

## 10. 批次验收口径

本批次只有在以下条件同时满足时才可以标记完成：

1. PRC-000～PRC-090 均有可复核交付，或有项目负责人明确接受的范围外记录。
2. 权威产品范围、quality schema、release checklist 和 verifier 对平台定义一致。
3. 文件打开竞态、字体 fallback 几何提交与快捷键 pre-focus 竞态均有协议级修复和失败路径测试。
4. 生产 CSP 非空且本地功能、WASM、字体与三格式导出均在 candidate 中验证。
5. G2、产品身份、许可证和第三方 notices 已落档，无占位符。
6. 发布源码来自 clean commit；所有证据绑定该 commit 和唯一 candidate SHA-256。
7. `pnpm quality` 返回 0，release evidence verifier 返回 0。
8. macOS Apple Silicon 原生验收 PASS，Windows 明确为 deferred/not-run 且不冒充 PASS。
9. G-FINAL 通过，MM-110 独立终审为 `ACCEPT`。
10. 发布交接包完整，但没有执行签名、公证、上传或公开发布。

## 11. 派发约定

- 每张任务卡独立派发，一次只承担一张卡；不得顺带跨卡重构。
- 任务开始时重新读取根 `AGENTS.md`、本指南和对应任务卡。
- 先复现/建立红灯证据，再实施，再跑验收；结论必须附命令和实际结果。
- 文档/ADR 是决策输入，不是自动授权。ADR 状态只有项目负责人可从 Proposed 改为 Accepted。
- 并行任务不能同时改同一生产文件；冲突由 PRC-060 统一整合，不允许执行者自行覆盖他人改动。
- 任何实际发布动作都不属于本批次。
