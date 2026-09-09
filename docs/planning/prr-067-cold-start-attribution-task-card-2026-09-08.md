# PRR-067：冷启动首次执行归因与协议收口

日期：2026-09-08  
类型：性能根因诊断 / 诊断可观测性 / 条件式修复  
优先级：P0  
状态：`COMPLETE`（PRR-067A-v3 与 PRR-067B 均已通过独立审阅；实施 `f9d2a75`，审阅修复 `f52e771`；PRR-070 已解除本卡技术阻塞，但须在产品图标收口后从新 clean source 完整重做）

阶段 A 第一轮（2026-09-08，@ `4251894`）已被独立审阅判 CHANGES_REQUESTED；其结论与决策包降级 superseded（`.tmp/SUPERSEDED-README.md`）。

审阅修正执行记录（2026-09-09）：修正 1/3/4/5/6/10 已落地并形成 clean commit `773eaea`（分段埋点、clean worktree 前置、trace fail-closed、--legacy-timing-only、有界原始 stdout/stderr、完整 64 位 hash；35 项 runner 测试全绿，全量门通过）；诊断候选 v2 `dfa0c47246dccaac69747a1fb0426fc66e181282904755253ee7f3de1c132737` 自该 commit 构建。

修正 7 全部完成（2026-09-09，系统 09:06:44 重启恢复渲染会话后）：B0（20/20，290.7–351.5ms）、B1（5/5 副本首启 815.8–1461.3ms、二启 293.4–313.4ms）绑定 `773eaea`；B2（conditioning 322.5ms 成功 + 20/20 样本 322.5–356ms）、B3（3/3，300.4–325.3ms，无 thermal/负载污染）、D1（20/20 带 trace，spawn→main-entered 全部 3.1–19.5ms）、D2（v2 字节一致新副本 2345.1→324.7ms，离群差值 98.7% 落在 spawn→main-entered 界限）绑定 `8e956fe`。环境事故（00:31–09:06 直接 spawn WebContent XPC 挂死）全程记录于 `.tmp/prr-067-experiments/ENVIRONMENT-INCIDENT.md`，挂死期 0 有效样本产物归档于 `incident-2026-09-09/`，未参与结论。**新证据**：重启后已执行路径再次出现首启离群（探测样本 1735.8ms，1155.9ms 落在 spawn→main-entered）——首次执行成本是会话级状态，非一次性机器级成本。

修正 8/9/11 完成：决策包 v2 重制于 `.tmp/prr-067-g-perf-protocol-request/`（v2 md SHA-256 `a6155d2e5613761166909b3e344791bb163f895aaddd1134af342b67994be5ae`）：结论限定为 exec→main 界限内的系统侧成本且不指认子系统、全部 hash 完整 64 位、全部实验绑定可重建 clean commit 与 runnerSha256、首次执行耗时独立成节（§5）。根因判定维持 `MEASUREMENT_BOUNDARY_CONFIRMED`（证据强于第一轮）。未修改预算/样本数/percentile/renderer-ready 完成点/ADR/decision-register。

**PRR-067A-v3 决策包语义修正（2026-09-09，负责人指令，base `912fd59`）**：仅修改决策包与本状态记录；未改代码/ADR/预算/estimator/样本数，未重跑实验，未开始 PRR-070。落实：① 删除"该成本只发生在安装后的第一次"与"等同/同类于首次 WebView 安装"表述（正文 §3/§5 已清除；§10 修正记录表中保留指令原文作审计）；② 证据边界收敛为三条可证明项：成本主要位于 exec→main 边界、新路径首次执行与系统重启后首次执行均可能出现、具体 macOS 子系统不可确定；③ 协议改双指标：`sessionFirstLaunchMs`（conditioning 启动耗时，完整记录与展示——durationMs 进 cold-conditioning.json/performance summary/native report/G-FINAL request；v0.1.0 无硬预算）+ `conditionedColdStartP95Ms`（成功 conditioning 后 20 cold 样本，沿用 estimator，≤1500ms 预算不变）；④ conditioning 失败整轮 INCOMPLETE，不得补跑/挑样/混样；⑤ cold-conditioning.json 必须绑定 source/candidate/runner hash。独立审阅一致性修正后：MD v3 SHA-256 `b88850e82a2f6b7962a5e7ac581d806d140bf56dbafcc2a0cc7514d9ff5ba85b`，JSON SHA-256 `ac4ea609b0e85369478d591da43b3ff25f219b11be3e4432722260e84894f21c`，JSON 内 `requestMarkdownSha256` 与 MD 一致。仍停 `WAITING_FOR_G_PERF_PROTOCOL`，未实施任何 ADR/runner/verifier 修改。

**G-PERF-PROTOCOL 正式批准（2026-09-09，[from-user]，批准人 ErDong Zou，产品版本 0.1.0，批准对象：PRR-067 v3）**。批准文本原文（审阅一致性修正后的决策包即被批准对象）：

> 批准采用双指标 cold 启动协议：
> 1. release cold 采样前，对同一候选路径执行恰好一次 conditioning。
> 2. conditioning 使用一次性隔离 HOME，必须完成 renderer-ready 和真实退出。
> 3. conditioning 单独保存为 cold-conditioning.json，并绑定完整 source、candidate、runner SHA-256。
> 4. sessionFirstLaunchMs 必须写入 cold-conditioning.json、performance summary、native report 和 G-FINAL request；v0.1.0 只记录和展示，不设 PASS/FAIL 硬预算。
> 5. conditioning 成功后采集 20 个 cold 样本，每个样本使用不同的全新隔离 HOME。
> 6. conditionedColdStartP95Ms 继续使用 sorted[floor(n×0.95)] 估计器，预算保持 ≤1500ms。
> 7. warmStartP95Ms ≤800ms、20 个 warm 样本及 renderer-ready 完成点保持不变。
> 8. conditioning 失败则整轮 INCOMPLETE；禁止补跑、挑样、删除样本或混合不同轮次。
> 9. 授权据此修改 ADR 0006、decision register、runner、verifier、evidence schema、测试和相关文档。
> 10. PRR-067B 完成并通过独立审阅前，不得开始 PRR-070、申请 G-FINAL 或执行 PRR-080。

本状态记录由 PRR-067B 实施回合持有；后续任何决策包内容漂移须经获批准的 hash 绑定重新审签，同 G1 批准记录纪律。

**PRR-067B 实施完成（2026-09-09，base `000f299`，实施 commit `f9d2a75`）**：按批准文本第 1–9 条实施，未触及批准文本之外的项目。ADR 0006 升 v1.1.0（SHA-256 `12768465e9ab5b06ce73b16cc3e5f07f784be8c14914fe5f4873645ac4181e4e`）；decision register 登记 G1.performanceProtocol（批准人 ErDong Zou / 2026-09-09 / 决策包 hash 绑定 `b88850e8…`）；runner 增加 conditioning 段与 cold-conditioning.json 写出；verifier 增加 conditioning 校验块；raw/summary schemaVersion 2→3；release-budgets 与 v1-quality-gates 同步；测试 verify 24 + runner 35（59 项，含 4 个 conditioning 红灯用例）与全量 529 tests、typecheck、lint、format 全绿；旧 v2 证据归档不动。批准第 10 条已遵守：未开始 PRR-070、未申请 G-FINAL、未执行 PRR-080。下一步：独立审阅本回合（审阅通过后本卡转 COMPLETE）。

**PRR-067B 独立审阅完成（2026-09-09）**：主体实现通过；审阅发现的同目录覆盖、conditioning artifact 自身未绑定、native report/G-FINAL request 指标漏传约束、performanceProtocol 未进入 decision gate 四项局部缺口，已由审阅者在 `f52e771` 修复并补红灯。定向 `78/78`、全量 `534/534`、format/typecheck/lint 与 packaging decision gate 均通过。完整结论见 [PRR-067B 独立审阅](../quality/prr-067b-independent-review-2026-09-09.md)。

输入：[PRR-070 阶段 A 冷启动失败独立审阅](../quality/prr-070-stage-a-cold-start-review-2026-09-08.md)  
后继：负责人 `[from-user]` G-PERF-PROTOCOL 批准 → 新回合实施 ADR/runner/verifier/schema 修改并独立审阅 → 新 clean source commit → PRR-070 从步骤1完整重做

## 派发文本

将本卡整张交给 Coding Agent，并附上下面一句：

```text
只执行 PRR-067。必须从包含本任务卡的当前 clean HEAD 开始。先完成阶段 A 归因；不得通过重跑挑样、删除首样本、改 percentile、改20样本数、提高预算或静默预热使结果变绿。若结论需要改变 Accepted 测量协议，停在 WAITING_FOR_G_PERF_PROTOCOL，不得自行修改 ADR/decision-register。不要继续 PRR-070，不申请 G-FINAL，不执行 PRR-080。
```

## 已知事实

- 失败 source：`ea047e8de3e05b1a262d534ffc5989a11af3ee6f`；candidate：`b7c535b1ab09952935344c16b0a732201ae64677b6a162f0974a1ef6e6123cce`。
- cold 20/20 有效样本，顺序第1个为1685.4ms，其余19个为341.2～374.5ms；固定 estimator 因而得到 p95=1685.4ms。
- warm、30秒 RSS、canvas、edit、save、PNG、DMG 均通过；PRR-066 的四项上一轮性能失败未复发。
- 当前证据未记录启动分段和当时系统状态，不能把“首样本”直接等同于 WebView 安装、磁盘缓存、系统安全校验或应用路径。
- Accepted ADR 0006 规定 cold p95≤1500ms、各20次、排除首次 WebView 安装；任何协议语义变化都会使登记 hash 漂移，必须取得负责人新的可审计批准。

## 目标

1. 把 `spawn → host main → Tauri setup → window/page ready → renderer-ready` 分段变成只在 perf 环境启用、可由 raw 复算的诊断事件。
2. 用同一失败候选和新的隔离诊断候选完成多路径对照，区分应用初始化、每个 fresh profile、每个新 app 路径首次执行和机器级首次执行成本。
3. 只在证据能定位到应用路径时实施最小优化；若证据要求改变测量边界，生成负责人决策包并停止。
4. 保持1500/800ms预算、20个有效 cold/warm 样本、当前 percentile estimator 和 `renderer-ready` 完成点不变。

## 允许范围

- 只读检查失败证据 `.tmp/release-candidate/ea047e8…/`，不得覆盖、补写或删除。
- 新诊断只写 `.tmp/prr-067-*`；允许在其中复制字节一致的 unsigned `.app`、创建 fresh HOME、保存 stdout/stderr/系统状态和实验报告。
- 允许给 `MINDMAP_PERF_SAMPLE=1` 路径增加最小启动 milestone；生产普通启动不得输出、联网或改变行为。
- 允许修改 `scripts/quality/run-performance.mjs`、`apps/desktop/src-tauri/src/perf/`、应用 perf probe、verifier、对应测试和本卡状态文档。
- 若阶段 A 证明应用代码是主因，允许最小应用启动路径优化及相称测试，但不得改变产品功能、字体范围、导出行为或发布预算。
- 不签名、不公证、不访问凭据、不安装到系统目录、不注册 LaunchServices、不修改系统信任/权限、不清理系统缓存、不执行 `sudo purge`，不 push、不上传、不公开发布。

## 禁止方案

1. 删除、winsorize、替换或标记1685.4ms为无效；它是协议内有效样本。
2. 反复执行完整 PRR-070，选择一次全绿结果作为证据。
3. 把 estimator 从当前 `floor(n×ratio)` 改为 nearest-rank、插值或第二大值。
4. 把 cold 样本从20增加或减少，以改变 p95 落点。
5. 在 runner 中加入不计数预热/conditioning，却不更新 Accepted 协议和负责人批准记录。
6. 只用 `Date.now()`、shell `time` 或目测代替同一 runId 的 monotonic 分段。
7. 将诊断 raw 标成 `measurementMode=release` 或放入 PRR-070/080 最终 manifest。

## 阶段 A：红灯、可观测性与归因

### A1. 冻结与失败复算

- 记录 clean HEAD、环境和失败 candidate/raw/summary/runner/inventory hash。
- 独立复算20个 cold 样本的顺序、p50/p95/max；断言首样本仍为有效失败，不改旧文件。
- 先建立红灯测试：缺 milestone、runId/generation 不匹配、阶段逆序、负 duration、丢失首样本、诊断证据冒充 release 均须 fail-closed。

### A2. 启动分段

在 perf-only 路径输出并保存同一 runId 的最小事件：

1. sampler `spawn-requested` 与 child `spawn`；
2. host `main-entered`；
3. Tauri `setup-started/setup-complete`；
4. window/page `page-load-started/page-load-complete`（使用已有可靠事件；没有可靠 hook 时明确记 `not-observable`，不得伪造）；
5. renderer `renderer-ready`。

每个 run 记录 sequence、wall-clock、sampler monotonic elapsed、host monotonic elapsed、PID、runId、windowGeneration、exit code；stdout/stderr 原样落入诊断 evidence。跨进程 monotonic origin 不得直接相减，只允许各自以本进程 origin 分段，并用 sampler 接收时刻形成端到端界限。

### A3. 对照实验

所有实验均为 diagnostic，不进入发布证据。至少完成：

| 组 | 条件 | 最低样本 | 目的 |
| --- | --- | ---: | --- |
| B0 | 失败 candidate 原路径；每次 fresh HOME | 1批×20 | 验证失败后同路径分布，不覆盖原 raw |
| B1 | 5个字节一致、hash一致的临时 `.app` 副本；每副本第1次 + 第2次均用不同 fresh HOME | 10 | 区分“新 app 路径首次执行”与 profile 初始化 |
| B2 | 同一临时 `.app`；共享 HOME，先1次单列 conditioning，再20次记录但不作为 release | 21 | 只作 warm/control，不得据此直接改 cold 协议 |
| B3 | 至少3个 fresh HOME 的单次启动，同时记录可读取的 CPU/load/thermal/memory 状态 | 3 | 排除明显机器负载污染；不得改变系统设置 |

每组记录 app tree hash、binary hash、xattr 名称列表、复制方式、HOME 条件、开始/结束时间、完整启动分段和系统状态。不得清除 xattr 或缓存来制造结论。

### A4. 根因判定

只允许以下三种结论：

- `APP_PATH_CONFIRMED`：可重复的超时主要落在 host/renderer 某一分段，并能映射到具体同步工作。进入阶段 B1。
- `MEASUREMENT_BOUNDARY_CONFIRMED`：离群成本主要位于 `exec→main` 边界；新 app 路径首次执行与系统重启后首次执行均可能出现；具体 macOS 子系统无法由现有证据确定。若解决需要显式定义采样前 conditioning，则生成 `g-perf-protocol-request.md/json` 后停在 `WAITING_FOR_G_PERF_PROTOCOL`。
- `INCONCLUSIVE`：不能稳定复现或无法归因。返回 `BLOCKED`，列出缺失能力；不得选一个方便的解释。

## 阶段 B：条件式收口

### B1. 应用路径根因

仅当 A4=`APP_PATH_CONFIRMED`：

1. 用红灯覆盖具体同步工作和 `renderer-ready` 真实性。
2. 做最小优化，不允许把真实初始化挪到 ready 之后制造假快；ready 时画布仍须可输入、命令/生命周期已安全。
3. perf-only milestone 不得出现在普通生产启动日志中。
4. 构建隔离诊断 candidate，在至少3个独立20-cold批次中，每批全部有效且当前 p95≤1500ms；完整 warm/RSS/canvas/edit/save/PNG/DMG 预算不得回归。
5. 提交一个 clean implementation commit，交回独立审阅；不得继续 PRR-070。

### B2. 测量边界根因

仅当 A4=`MEASUREMENT_BOUNDARY_CONFIRMED`：

1. 不修改 ADR、decision-register、release runner 或 verifier 的正式语义。
2. 决策请求必须给出：原失败证据、对照实验、推荐 cold 定义、conditioning 是否计入、对首次真实用户启动的影响、替代方案和风险。
3. 推荐协议若包含 conditioning，必须明确：conditioning 是单独保存且必须成功的诊断记录；20个 measured cold 样本仍全部使用不同 fresh HOME；不得丢样、改 estimator 或放宽预算。
4. 等待项目负责人提供包含精确协议文本的 `[from-user] G-PERF-PROTOCOL`。未批准前状态保持阻塞。
5. 获批后的 ADR/version/hash、runner/verifier/schema 与测试修改必须作为新的后续回合执行，并再次独立审阅。

## 最低验证

- 启动事件 parser/ordering/runId/generation/exit 的正反测试。
- runner/verifier 对诊断模式、缺事件、逆序、hash 不一致和 release 冒充的 fail-closed 测试。
- `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、相关 unit/integration、`cargo fmt --check`、`cargo test --locked`、`cargo clippy --all-targets --locked -- -D warnings`。
- 若修改生产应用启动路径，再执行全量 `pnpm test:unit`、`test:integration`、`test:a11y`、`test:visual`、`test:export`、`build`、`net:scan`、`license:scan`、`boundaries`。
- 所有诊断报告列出完整命令、exit code、source/candidate/runner/raw hash 和未运行项。

## STOP

- 需要修改预算、样本数、percentile、ready 完成点或 Accepted ADR，但没有负责人新批准。
- 无法证明 milestone 对普通生产路径零行为影响。
- 需要 sudo、清系统缓存、改系统信任/权限、签名、公证或访问凭据。
- 诊断仍无法区分应用与系统首次执行成本。
- 任何实验试图覆盖 PRR-070 失败目录或把 diagnostic 数据写入 release manifest。

## 交回格式

```text
Task: PRR-067
Status: COMPLETE / WAITING_FOR_G_PERF_PROTOCOL / BLOCKED / FAILED
Base: <完整 clean HEAD>
FailureReproduction: <旧证据 hash + 独立复算>
Instrumentation: <milestone、代码路径、零生产行为证明>
Experiments: <B0～B3，每组条件/样本/结果/evidence hash>
RootCause: APP_PATH_CONFIRMED | MEASUREMENT_BOUNDARY_CONFIRMED | INCONCLUSIVE
Changed: <逐文件；诊断-only 与 production 分开>
Verification: <命令/exit code/通过数量>
Evidence: <仅 .tmp/prr-067-* 路径 + SHA-256>
DecisionRequest: <若等待批准，给出 request 路径/hash；否则 N/A>
NotRun: <项目与原因>
Risks: <剩余风险>
Redlines: <确认未执行>
Next: STOP_FOR_INDEPENDENT_REVIEW
```
