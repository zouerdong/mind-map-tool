# PRC-000～PRC-090 发布前全面代码审阅

日期：2026-09-07  
结论：`REJECT / NOT_READY_TO_RELEASE`  
审阅基线：`541d38ceebe15b272689450072f6195b2440b2b5`（审阅开始时 `main`、clean）  
审阅对象：PRC-000～PRC-090 实现、发布 runner、候选 `.app` / `.dmg`、readiness manifest、MM-110 与发布交接包  
整改指南：[pre-release-remediation-development-guide-2026-09-07.md](../planning/pre-release-remediation-development-guide-2026-09-07.md)  
整改任务卡：[pre-release-remediation-task-cards-2026-09-07.md](../planning/pre-release-remediation-task-cards-2026-09-07.md)

## 1. 审阅结论

主体编辑、文件生命周期、导出、视觉实现和常规自动化已达到较高完成度，但“开发全部完成、可以进入发布动作”的结论不成立。当前候选必须作废并重建，旧 MM-110 `ACCEPT` 与 `READY_TO_RELEASE` 交接包不得作为发布依据。

阻塞原因不是签名、公证尚未执行——这两项本来就属于下一阶段；真正的问题是候选本身仍未满足已经批准的工程与产品门槛，而且旧证据把未测量、测量失败或非候选数据写成了通过。

本轮已直接修复局部门禁、错误处理和默认文件扩展名问题。剩余事项涉及生产配置、产品/法律决定、性能采样架构、全量字体策略或核心命令语义，不属于可安全顺带完成的小修，已拆成 PRR 任务卡。

## 2. 阻塞发现

| ID | 级别 | 发现 | 客观证据 | 处置 |
| --- | --- | --- | --- | --- |
| RLS-001 | P0 | 发布证据链存在假绿和时间倒挂 | readiness manifest 生成于 `04:13Z`，其声称包含的 install/performance 证据生成于 `04:21Z/04:22Z`；强化后的 verifier 对同一 manifest 报 35 项失败 | 旧 manifest、MM-110 和 handoff 全部作废；执行 PRR-000/010/080 |
| RLS-002 | P0 | 性能报告不是候选原生性能证据 | 旧 runner 在 Chromium 权限失败时写固定帧数据；RSS 空数组被替换为 `38.5MB`；真实 app 没有 `renderer-ready` 打点；edit/save/PNG 无 raw samples；web harness 被当成 native canvas | 假数据回退已移除；PRR-010 实装候选原生探针 |
| RLS-003 | P0 | 安装包超过 Accepted 预算 | `.dmg` 为 `28,011,310` bytes；ADR 0006 要求 Tauri 每平台不超过 25MB | PRR-020，不得抬阈值 |
| RLS-004 | P0 | 最终许可证与 notices 不存在 | 根目录没有 `LICENSE*` 和 `THIRD_PARTY_NOTICES*`；ADR 0007 仍为 Proposed，且明确要求最终文本和法律审阅 | PRR-060；由负责人/法律给出文本，工程侧生成并核验 notices |
| RLS-005 | P0 | 没有真实 G-FINAL，也没有与候选 hash 绑定的原生平台报告 | 被引用为 G-FINAL 的 VRA-080 JSON 只记录 web harness，`browserCapture=DEFERRED_SANDBOX`，没有 source/candidate hash 或 `[from-user]` 验收记录 | verifier 已要求显式 G-FINAL 与 native-candidate JSON；执行 PRR-070 |
| RLS-006 | P0 | G2 批准记录使用占位身份，不能证明红线动作获得负责人授权 | `decision-register.json` 写 `approvedBy: project-owner`，evidence 只有执行者摘要，没有 `[from-user]` 记录 | G2 校验已 fail-closed；PRR-000 取得并记录真实批准人及范围 |
| RLS-007 | P1 | `.mindmap` 产品身份没有进入 macOS bundle | 候选 `Info.plist` 没有 `CFBundleDocumentTypes` / `UTExportedTypeDeclarations`；旧交接包却声称“原生 `.mindmap` 文件关联” | 默认保存名与对话框过滤已修；生产 bundle 配置由 PRR-030 完成 |
| RLS-008 | P1 | 最低系统版本三处冲突 | 产品身份文档为 macOS 11+，交接包为 12+，候选 `LSMinimumSystemVersion=10.13`；Mach-O 实际 minimum OS 为 11.0 | PRR-030 统一为负责人确认值并验证 plist/Mach-O |
| RLS-009 | P1 | 切换文档字体绕过权威几何重测 | `SetDocumentStyle(font)` 直接提交，所有已有节点继续保留旧字体测得的持久化 `size`；长文本可溢出，UI/导出边界失配 | PRR-040 设计原子字体切换 + 全节点重测命令及 undo |
| RLS-010 | P1 | install gate 只验证临时目录复制/哈希/删除 | 没有实际启动、LaunchServices 文件关联、双击打开、菜单/窗口身份和版本探针；不能证明“可安装可使用” | PRR-030/070 扩展原生安装验收 |
| RLS-011 | P1 | 视觉 runner 可在捕获失败时输出 PASS | 旧实现 catch 后写 `DEFERRED_SANDBOX`，但所有 layer 和 conclusion 仍是 `PASS`，最后退出 0 | 已修为 `INCOMPLETE` 非零；自动化只生成证据，不授予 G-FINAL |
| RLS-012 | P2 | 同一窗口的旧文档 handle 在 Save As/open 后持续有效到窗口关闭 | `HandleRegistry::issue` 明确“旧的不失效”；掌握旧 opaque handle/token 的 renderer 仍可写旧文件 | PRR-050 绑定 active handle 与窗口 generation，或由负责人书面接受残余风险 |
| RLS-013 | P2 | 首入口预算余量过小 | 审阅小修后的最终隔离 production build 为 `499,804 / 500,000` bytes，仅余 196 bytes | 后续每卡都要复测；PRR-020 优先避免把新逻辑塞回首入口 |
| RLS-014 | P2 | Rust 依赖尚无 advisory 数据库扫描证据 | `pnpm audit --prod --audit-level high` 当前返回“无已知漏洞”；本机没有 `cargo-audit`，许可证扫描不等于漏洞扫描 | PRR-080 在批准的固定工具链中运行 RustSec/Cargo advisory 扫描，或由负责人书面记录风险处置 |

## 3. 候选与证据实测

### 3.1 受审旧候选

| 项目 | 实测 |
| --- | --- |
| `.app` | 约 32,208 KiB 磁盘占用，Mach-O arm64 |
| `.dmg` | 28,011,310 bytes，超过 25MB 预算 |
| Bundle ID / version | `com.mindmap.desktop` / `0.1.0` |
| 最低系统版本 | plist 10.13；二进制 11.0；文档 11+；旧 handoff 12+ |
| 文件关联 | 不存在 `.mindmap` 的 document type / exported UTI |
| 签名状态 | adhoc/linker-signed；Info.plist 未绑定、resources 未 sealed；符合“尚未正式签名”，不能作为公开分发签名 |
| 主要体积 | LXGW WenKai 24,744,500B；Noto Bold 8,543,168B；Noto Regular 8,331,336B；WASM 2,478,606B |

候选由旧源码基线构建；本审阅已经产生修复，所以即使不考虑上述问题，它也已不再代表当前工作树。

### 3.2 旧 readiness manifest 的独立复算

强化后的命令：

```bash
node scripts/quality/verify-evidence.mjs \
  --manifest .tmp/release-candidate/readiness-manifest.json
```

结果：`exit 1`，35 项失败。核心失败包括：

- manifest 早于它引用的 install/performance 证据与候选产物；
- install/performance runner hash 与当前受审源码不一致；
- edit/save/PNG 指标缺失；
- warm-start 与 installer 预算字段缺失；
- `.dmg` 超预算；
- RSS raw samples 为空；
- canvas 数据不是 native candidate；
- G-FINAL 缺失。

因此旧 `.tmp/release-candidate/mm-110-independent-review.md` 的 `ACCEPT` 和 `release-handoff-packet-v1.md` 的 `READY_TO_RELEASE` 均被客观证据推翻。

## 4. 本轮已直接修复

这些修改不改变产品范围，不签名、不发布、不访问凭据，也没有改生产 Tauri 配置：

1. 发布路径门：修复 absolute path 崩溃、字符串前缀逃逸、父级 symlink 越界、`..`/仓库根目录、候选/证据/删除边界校验。
2. Bundle 门：只允许 clean worktree 构建，要求本次构建确实刷新全部批准产物，计算 `.app` 树大小，输出带 runner/source/hash 的 inventory。
3. Evidence 门：复算 app/DMG、runner 与每个 evidence artifact 的 hash 和内嵌生成时间，逐项从 raw sample 反算 summary 和 Accepted 预算，并校验 native 来源、候选平台报告与独立 G-FINAL JSON；缺少 `releaseScope` 的历史 schema 不能降级放行。
4. 性能门：移除固定帧时间、固定 RSS、600ms 启动回退；启动只接受匹配 run id/generation 的精确 `renderer-ready` JSON 并等待进程退出；缺数据改为 `INCOMPLETE`，release 每组至少 20 样本，并纳入全部 Accepted 指标和 installer 预算。
5. 视觉门：浏览器捕获失败不再 PASS；旧截图不能冒充本轮输出；runner 明确不能授予 G-FINAL；直接 unit test 不再写 tracked evidence。
6. 许可门：扫描 29 个直接 JS、300 个传递 JS、487 个 Cargo package，并要求最终 LICENSE 与 THIRD_PARTY_NOTICES。
7. 网络门：allowlist 改为“文件 + 精确规则”，不再豁免同一文件里的所有端点模式。
8. GeometryBarrier：failed 状态不再落 fallback 几何或产生未处理 rejection；意图可重试，提交失败不丢队列，并发 flush 只 drain 一次。
9. 全局快捷键：host generation 缺失时只唤醒不建点；event emit 失败回收 pending invocation；补负向测试。
10. 默认文档名与原生对话框过滤改为 `.mindmap`，同时保留 `.json` 打开兼容。
11. 替换一个恒真 Rust 断言，使其真正检查 Closing 窗口不会创建/聚焦新窗口。

## 5. 验证结果

| 验证 | 结果 |
| --- | --- |
| 审阅前 `pnpm test:unit` | PASS，44 files / 419 tests |
| 审阅前完整 Rust tests | PASS，187 tests + doc tests |
| 修复后 `pnpm format:check` | PASS |
| 修复后 `pnpm typecheck` | PASS |
| 修复后 `pnpm lint` | PASS |
| 修复后 `cargo fmt --check` | PASS |
| 修复后 `cargo check --locked` | PASS |
| 修复后隔离 production build | PASS，498 modules；初始 entry 499,804B |
| 修复后安全范围 TS 测试 | PASS，42 files / 409 tests；排除 2 个会主动删除临时目录的 bootstrap 文件 |
| Geometry/font/evidence 定向测试 | PASS，3 files / 23 tests |
| 视觉导出契约定向测试 | PASS，1 file / 11 tests；只证明自动化契约，不是候选视觉 G-FINAL |
| 快捷键/生命周期定向 Rust 测试 | PASS，2 tests |
| `pnpm net:scan` | PASS，99 files / 0 endpoints |
| `pnpm audit --prod --audit-level high` | PASS，当前 JS 生产依赖无已知漏洞 |
| Rust advisory scan | NOT RUN，`cargo-audit` 未安装；本轮未擅自安装工具 |
| `pnpm license:scan` | FAIL，仅因根 LICENSE 与 THIRD_PARTY_NOTICES 缺失；依赖枚举本身无未知/禁用项 |
| 旧 readiness manifest 复算 | FAIL，35 项 |
| G2 packaging decision 复算 | FAIL，批准人和 `[from-user]` 证据为占位/缺失 |

完整测试套件中的少数 fixture 会主动递归删除临时目录；根 `AGENTS.md` 要求任何删除先获批准，因此本轮没有在修复后擅自重跑这些清理型套件。最终 PRR-080 必须在获得该精确临时目录清理授权后做一次完整、干净复跑。

## 6. 最终意见

- 当前状态应标为 `IMPLEMENTATION_NEEDS_REMEDIATION`，不是 `READY_TO_RELEASE`。
- 旧候选和所有依赖其 hash 的报告只保留审计用途，不可继续补写后“接着用”。
- 先完成 PRR-000～060，再从 clean source commit 构建唯一新候选；PRR-070 的所有原生证据和 G-FINAL 必须绑定该候选；PRR-080 冻结验收包，最后由未参与实现的验收者执行 PRR-090。
- 签名、公证、上传、Git push 和公开发布仍是下一阶段独立授权，不在本轮整改范围内。
