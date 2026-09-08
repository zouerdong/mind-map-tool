# PRR-066：候选性能与 PNG/CSP 根因整改

日期：2026-09-08  
类型：生产路径修复 / 性能证据协议修复  
优先级：P0  
状态：`READY_FOR_CODING`  
依赖：PRR-070 阶段 A 在 `0c8a93b` 正确停止；[独立审阅](../quality/prr-070-stage-a-performance-review-2026-09-08.md)完成  
后继：独立审阅 PRR-066 → 新 clean source commit → PRR-070 从步骤1完整重做

## 派发文本

将本卡整张交给 Coding Agent，并附上下面一句：

```text
只执行 PRR-066。基线为 main@0c8a93bf4cc1b55234cd6b54f0dfe9f02eac9c65 加当前 working-tree 中审阅者已完成的 perf-probe 两文件 patch；必须保留并纳入最终 commit。不要继续 PRR-070，不申请 G-FINAL，不执行 PRR-080。完成后停下来交回我独立审阅。
```

## 目标

在不提高任何 Accepted 预算、不删样本、不缩字库、不改变导出格式和文档 schema 的前提下，同时关闭：

1. production CSP 阻止 resvg WASM，导致 2x PNG 导出失败；
2. 空白画布首帧后无条件加载完整导出栈，导致 RSS 超预算并与启动标记竞争；
3. RSS 仅等待2秒，未满足30秒稳定窗；
4. canvas probe 的聚合 p95 与 raw verifier 不一致；
5. 失败链只显示 `UNKNOWN`，无法审计底层原因。

## 基线与证据边界

- source 基线：`main@0c8a93bf4cc1b55234cd6b54f0dfe9f02eac9c65` 加当前未提交审阅 patch。
- 旧 `.tmp/release-candidate/0c8a93b.../` 只读保留为失败证据；不得覆盖、修补或删除。
- 本卡诊断产物仅进入 `.tmp/prr-066-*`；不得写入未来 PRR-070 的 source-hash evidence 目录。
- 用户已批准本项目的 production `tauri.conf.json` 修改与 unsigned 本机候选测试；本卡只允许下面列明的最小 CSP 改动，不外推到其他生产配置。
- 不签名、不公证、不访问凭据、不注册 LaunchServices、不安装到系统目录、不 push、不上传、不公开发布。

## 允许修改

- `apps/desktop/src/app/perf-probe.ts` 与测试（审阅 patch 已开始）
- `apps/desktop/src/app/mindmap-app.tsx` 与字体几何屏障集成测试
- `apps/desktop/src/app/ports.ts`、`export-commands.ts` 与对应测试
- `packages/ui/src/canvas/geometry-barrier.ts` 与 `packages/ui/test/geometry-barrier.test.ts`
- `packages/export/src/index.ts`、PNG 错误映射及对应测试（仅为结构化错误，不换 renderer）
- `apps/desktop/src-tauri/src/perf/mod.rs` 与 Rust 测试
- `apps/desktop/src-tauri/tauri.conf.json`：仅 CSP 的 `wasm-unsafe-eval`
- `scripts/quality/run-performance.mjs`、`verify-evidence.mjs`、`scan-network-endpoints.mjs` 及其测试/fixture
- 本卡关联的 planning/quality 状态文档

禁止修改 ADR 0006 的预算、样本数和产品范围；禁止用 native renderer、系统字体、缩字库或删除 LXGW 规避内存。Accepted ADR 0011 已包含按真正导出动态加载的路线，本卡选择该已批准分支，不改 ADR 正文与 decision hash。

## 红灯先行

实现前先补或确认以下失败测试：

1. production CSP 缺 `wasm-unsafe-eval` 时，PNG/WASM candidate probe 必须失败；加入后只允许该 token，`unsafe-eval`、`*`、远程 endpoint 仍必须被 scanner 拒绝。
2. `MindMapApp` 仅 mount、空白画布稳定时，不调用 renderer `warmup()`/`whenReady()`/`whenMetricsReady()`，也不触发三份导出字体与 WASM 的加载。
3. pending 字体状态下的首次 create/edit/kicker/font-switch 会自动启动一次 geometry flush；真实字体 ready 后恰好提交一次，不需要等到 Save，失败仍保留 intent 且无 unhandled rejection。
4. Save/Close-Save/Export 在 pending intent 存在时仍等待同一 in-flight font load，绝不持久化 fallback size。
5. PNG renderer 初始化失败返回稳定结构化错误（优先 `EXPORT_WASM_UNAVAILABLE`）与底层 message，不再只出现 `UNKNOWN`。
6. canvas `frameP95Ms` 必须等于 runner/verifier从三组完整 raw frame samples 复算后的最大 p95；逐轮 p95 只作诊断。
7. RSS evidence 没有 `settleMs >= 30000` 或采样早于稳定窗时，runner/verifier 必须 `INCOMPLETE`，不得填默认值。

## 实施步骤

### A. 统一可复算性能协议

1. 保留审阅者已改的 canvas 聚合与 `code + message` 输出，并补足必要边界测试。
2. 将 host RSS 稳定等待从 2,000ms 改为至少 30,000ms；事件或 raw evidence 必须携带可验证的 `settleMs`，runner 与 `verify-evidence` 均校验它。
3. 保持当前 runner/verifier 的 percentile estimator、20样本和预算常量不变。本卡不得借更换算法使 warm 变绿。
4. 场景超时必须覆盖30秒稳定窗与采样时长；不得用无上限 sleep，也不得发生超时后写 PASS。

### B. 修复 production PNG

1. `script-src` 只增加 `'wasm-unsafe-eval'`，以允许本地打包的 resvg WASM 实例化；不要增加 `'unsafe-eval'`、远程源、通配符或额外 connect source。
2. 扩展 CSP/network scanner：精确允许 `wasm-unsafe-eval`，继续拒绝普通 `unsafe-eval` 与外网 endpoint。
3. 在 export renderer 边界把 WASM fetch/init/render 失败映射为稳定 code + 可读 message；不要在 `catch` 中吞掉 fetch 原因再伪装成资源不存在。
4. 用 production `.app` 的单次 `png-export` probe 证明：得到 `scenario-result`、输出文件存在且为2x PNG、无 CSP console/runtime 拒绝。jsdom 或 Node golden 不能替代这一步。

### C. 让重资源真正按需加载

1. 移除 `MindMapApp` mount 后无条件 `warmup + whenReady` 路径；空白文档不能加载 export JS、fontkit 字体字节或 resvg WASM。
2. `GeometryBarrier.enqueue()` 在首次依赖真实字体度量的 intent 到来时启动单一 in-flight `flush()`；成功后提交并触发 UI bump，失败走现有 onError 且保留队列。
3. 真正导出继续按需调用 renderer load；PNG probe 的计时仍按现有定义在资源 ready 后开始，首次资源加载耗时另记诊断值，不混入 2x PNG render p95。
4. 不破坏 CSS `@font-face`、真实字体几何、字体切换 undo/redo、Save/Close-Save 屏障。若为满足 RSS 必须删除字体、使用系统字体或改变字体覆盖，立即 STOP。

### D. 预发布性能预检

1. 从修复后的 clean commit 构建独立 diagnostic unsigned `.app/.dmg`，使用单独 `CARGO_TARGET_DIR` 与 `.tmp/prr-066-*`，不得覆盖旧 PRR-070 candidate。
2. 先做单项 PNG 与 RSS 诊断，再运行一次完整 `run-performance --scope release --samples 20`。不关闭/修改系统服务，不人工删除任何有效离群，不复用旧 raw。
3. 必须同时达到：warm p95 ≤800ms、30秒 stable RSS ≤120MB、canvas p95 ≤32ms、PNG p95 ≤3000ms，且 cold/edit/save/包体全部保持通过；raw/summary 完整一致。
4. 如果 warm 仍有离群，给 host/renderer-ready 增加阶段性 monotonic marker（仅 perf env 生效），定位是 host setup、WebView navigation、React mount、canvas interactive 哪一段；有证据后修根因。不得把“后台干扰”作为无证据豁免。
5. 如果 RSS 仍大于120MB，记录空白画布的主进程与 WebContent 分进程口径、资源加载状态和30秒样本，再返回 `BLOCKED_ON_RSS`；不要改预算。

## 必跑验证

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm test:a11y
pnpm test:visual
pnpm test:export
pnpm build
pnpm net:scan
pnpm license:scan
pnpm boundaries
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets --locked -- -D warnings
git diff --check
```

另附：production `.app` 单次 PNG probe、30秒 RSS probe、完整20样本 release performance 预检的命令、exit code、raw/summary path 与 SHA-256。

## 完成条件

- 五项根因全部有失败测试、最小修复与绿灯；production PNG 真机成功。
- 空白 mount 不 eager-load 导出资源；首个几何意图仍自动、恰好一次地使用真实字体提交。
- RSS 按30秒协议测量且 ≤120MB；warm/canvas/PNG 及全部 Accepted 预算通过。
- full source gates 全绿，`git diff --check` 通过。
- 所有源改形成一个新的本地 clean commit，交回完整 hash；旧 candidate/evidence 保持原样。
- 状态只写 `PRR-066 COMPLETE / READY_FOR_INDEPENDENT_REVIEW`，不得继续 PRR-070。

## STOP

- 任何预算仍失败或证据 `INCOMPLETE`；
- 需要提高预算、删有效样本、变 percentile estimator、缩字库、换字体/renderer 或改文档 schema；
- 需要超出本卡的生产配置、CI、系统权限、签名、公证、凭据、push、上传或发布；
- 无法证明临时 CSP 只开放本地 WASM 编译；
- 发现旧 PRR-070 evidence 被覆盖或 source/candidate 混用。

## 固定交回格式

```text
Task: PRR-066
Status: COMPLETE | BLOCKED | FAILED
Base: main@0c8a93b + reviewer working-tree patch
Commit: <new full clean source commit or NONE>
Changed: <逐文件>
RootCauses: <PNG/CSP, eager loading, RSS protocol, canvas aggregation, error mapping>
Verification: <命令 + exit code + tests>
NativePreflight: <candidate hash + cold/warm/RSS/canvas/edit/save/PNG/size>
Evidence: <.tmp/prr-066-* paths + SHA-256>
NotRun: <明确列出>
Risks: <残余风险>
Redlines: <确认未继续 PRR-070/G-FINAL/PRR-080，未签名/公证/push/发布>
```

