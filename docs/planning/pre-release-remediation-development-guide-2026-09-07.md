# 发布前终审整改开发指南（PRR 批次）

日期：2026-09-07  
状态：`IN_PROGRESS / PRR-069C_READY / PRR-070_BLOCKED`（PRR-070 source `b45dc0c` 再次命中 Tauri Finder `.DS_Store` 无上限等待并按 STOP 作废；先执行确定性 DMG 装配整改）
适用范围：PRC-000～PRC-090 执行后、公开发布动作前  
输入：[发布前全面代码审阅](../quality/pre-release-code-review-2026-09-07.md)  
任务卡：[pre-release-remediation-task-cards-2026-09-07.md](./pre-release-remediation-task-cards-2026-09-07.md)
当前审阅：[prr-000-050-implementation-review-2026-09-07.md](../quality/prr-000-050-implementation-review-2026-09-07.md)

> 本指南用于修复终审拒绝项。它不自动授权修改生产配置、写入许可证法律文本、清理旧候选、安装到系统目录、签名、公证、上传、Git push 或公开发布。

## 1. 目标与完成定义

目标不是把旧清单重新标绿，而是从一个 clean source commit 重新构建唯一候选，并让每项结论都能从候选二进制、原始数据和负责人记录复算。

只有同时满足以下条件，状态才可进入 `READY_FOR_RELEASE_EXECUTION_REVIEW (UNSIGNED / NOT_PUBLISHED)`：

1. PRR-000～PRR-080 由执行 Agent 完成，PRR-090 由独立验收者完成；P0/P1 为零，P2 有负责人书面处置。
2. G2 记录真实批准人、日期、精确范围和 `[from-user]` 原始批准摘录；不再使用 `project-owner` 占位符。
3. 根 LICENSE、THIRD_PARTY_NOTICES、package/Cargo/bundle metadata 与最终许可决定一致。
4. `.mindmap` 文件关联、UTI/MIME、产品名、版本、最低 macOS 版本都能从新候选 `Info.plist` 复算。
5. `.dmg` 不超过 Accepted ADR 0006 的 25MB 预算；初始 entry JS 不超过 500,000 bytes。
6. 字体切换后的所有 node `size` 来自目标真实字体，作为一个可撤销事务提交；不存在 fallback 尺寸入库。
7. 原生候选具备不少于 20 个有效冷/热启动样本，以及 RSS、dense canvas、edit、save、2x PNG 的 raw samples；任何缺测均为 `INCOMPLETE`。
8. 安装/启动/打开 `.mindmap`/保存/另存/关闭/快捷键/三格式导出/CSP 均在同一 `.app` hash 上完成原生验证。
9. 项目负责人对同一 candidate hash 给出真实 G-FINAL；自动化 runner 只能准备证据，不能代签。
10. 强化后的 `verify-evidence`、全量 quality 和 PRR-090 独立 MM-110 都返回 0/`ACCEPT`。

签名、公证、staple、上传和公开发布不属于上述“开发完成”，仍需另开发布执行任务并取得明确授权。

## 2. 推荐路线

```text
PRR-000 治理与证据基线
   ├─ PRR-010 原生性能与证据协议
   ├─ PRR-020 包体/字体策略
   ├─ PRR-030 bundle 身份与文件关联
   ├─ PRR-040 字体切换几何事务
   ├─ PRR-050 active handle 生命周期
   └─ PRR-060 许可证与 notices
                ↓
PRR-065 零画布顶栏 + 原生命令承载
                ↓
PRR-066 PNG/CSP + 真正按需加载 + 性能协议整改
                ↓
PRR-067 冷启动首次执行归因 + 条件式收口
                ↓
PRR-068 固定图标母版 + 确定性桌面集成
                ↓
PRR-069C app-only build + 无 Finder DMG 装配
                ↓
       clean source commit
                ↓
PRR-070 新候选 + 原生矩阵 + G-FINAL
                ↓
PRR-080 全量门 + 冻结验收包
                ↓
PRR-090 独立终审 + 新交接包
```

PRR-010/020/040/050 可在各自决策明确后并行开发，但 PRR-030 涉及生产 Tauri 配置，PRR-060 涉及法律文本，必须等待对应负责人输入。PRR-065 必须在新的 clean source commit 和 PRR-070 之前完成；PRR-070、080、090 必须严格串行，且 PRR-090 不得交给参与 PRR-000～080 实现或证据生成的 Agent 自审。

## 2.1 派发基线与工作区规则

截至 2026-09-10，PRR-000～069 已集成并完成独立审阅；source `b45dc0c` 的 PRR-070 阶段 A 因 Tauri Finder `.DS_Store` 无上限等待命中预先声明的 STOP。原进程之后自然完成的 candidate 仍只读作废；先执行 PRR-069C，独立审阅通过后才重新派发 PRR-070。因此：

1. PRR-069C 从包含本卡的最新 clean HEAD 开始；PRR-070 随后从包含 PRR-069C 独立审阅修复与状态同步的新 clean HEAD 开始。不得退回历史 source，也不得复用 `b45dc0c` 或更早候选/证据。
2. 旧 `.tmp/release-candidate` 内容全部只读；新证据写入当前 source commit 对应的新子目录。不得覆盖根层旧 manifest/report，也不得清理历史目录。
3. PRR-069C 只整改发布 runner 和对应文档/测试，不执行 PRR-070。PRR-070 原则上只生成 ignored candidate/evidence；一旦需要修改源码、测试、runner 或 tracked 文档，立即停止并退回对应整改卡，修复后换新 source hash 从头重做。
4. 执行 Agent 不得自行批准 G-FINAL、MM-110 或 handoff，也不得开始 PRR-080；自动化与 Agent 只能整理一份绑定候选 hash 的负责人验收请求。
5. 不授权 push/rebase；签名、公证、凭据、系统信任修改、上传和公开发布仍明确禁止。

## 2.2 负责人必须提供的四组输入

这些输入没有到位时，对应 Agent 只能做不越权的测试/设计准备，不能宣称完成：

1. **G2 原始授权**：真实批准人、日期、精确 candidate/evidence/install/deletion paths、允许与排除动作，并提供可引用的 `[from-user]` 原文。
2. **生产 bundle 配置授权**：明确允许 PRR-030 修改 `apps/desktop/src-tauri/tauri.conf.json`，并确认最低 macOS 版本；当前建议为 11.0。
3. **法律文本**：最终 LICENSE、权利主体/年份/商业授权入口，以及 THIRD_PARTY_NOTICES 的展示位置。
4. **验收环境授权**：精确允许使用和清理哪些临时目录、是否允许在受控环境注册/恢复 LaunchServices，以及 Rust advisory 工具的固定版本与本地隔离安装方式。

负责人可以按下面结构一次性提供输入，尖括号内容必须替换为真实值：

```text
[from-user] <日期时间>
G2 approver: <真实姓名或可审计身份>
批准 PRR-000～080 使用当前 working-tree snapshot 作为起点。
允许的新候选目录: <精确仓库内路径>
允许的新证据目录: <精确仓库内路径>
允许的临时安装/清理目录: <精确路径>
允许动作: unsigned build, native test, performance sampling, local isolated advisory scan
排除动作: signing, notarization, credentials, git push/rebase/reset, upload, public release

生产配置:
允许 PRR-030 修改 apps/desktop/src-tauri/tauri.conf.json；
最低 macOS 版本为 <版本>；
允许/不允许在受控测试环境注册并恢复 LaunchServices。

法律输入:
LICENSE: <负责人/法律提供的最终文件或原文>
Copyright: <主体与年份>
Commercial contact: <入口>
THIRD_PARTY_NOTICES 展示位置: <位置>
```

如果其中任一值仍是 TBD、占位身份或模糊目录，对应 Gate 必须保持 BLOCKED。

## 2.3 执行 Agent 的统一派发提示

每次派发只替换任务号，连同本指南和任务卡一起交给 Agent：

```text
只执行 PRR-XXX，不顺带执行其他 PRR。
先完整阅读根 AGENTS.md、发布前终审整改开发指南、PRR 任务卡和全面审阅报告。
必须从包含 2026-09-07 审阅小修的当前 working-tree snapshot 开始，保留既有未提交修改。
严格遵守该卡的允许范围、红灯、验收和 STOP；先补能复现问题的失败测试，再做最小根因修复。
不得删除文件/目录，不得修改卡外生产配置、CI、密钥或法律文本，不得签名、公证、push、上传或发布。
命中授权缺口或 STOP 时返回 BLOCKED，不得用占位数据、固定值、跳过测试或自写批准记录继续。
完成后按任务卡“共同执行合同”的固定格式交回；不要把项目状态改成 READY_TO_RELEASE。
```

## 3. 不复用旧候选的原则

旧候选及 `.tmp/release-candidate/` 只保留审计用途；不要修改其 JSON 让它“看起来合格”，也不要把新证据写回旧 manifest。新批次推荐使用：

```text
.tmp/release-candidate/<source-commit>/<candidate-sha256>/
```

新 evidence manifest 最后生成，且必须晚于它引用的全部 artifact。至少记录：

- `source.commit` 与 clean worktree 证明；
- `.app` / `.dmg` path、SHA-256、size、latest mtime；
- 每个 runner 的 SHA-256、完整命令、exit code、开始/结束时间；每个 evidence artifact 也记录独立 SHA-256，performance summary 记录 raw evidence SHA-256；
- OS build、arch、硬件与 build type；
- G2/G-FINAL 的真实批准人、时间、候选 hash 和 `[from-user]` 记录；
- required/deferred platform；
- native platform report JSON，而不是把 `.app` 路径冒充报告；
- raw samples、summary 与 Accepted budget 的逐项映射。

Manifest 生成后不得重跑并覆盖被引用证据；任何 runner、源码、候选或原始数据变化都必须新建批次并重新生成 manifest。

## 4. 原生性能测量协议

### 4.1 启动完成点

真实应用目前没有 `renderer-ready` 信号。推荐增加只在 `MINDMAP_PERF_SAMPLE=1` 下启用的单向诊断协议：

1. host 为本次启动生成 run id 和 monotonic start time；
2. React root mount 后等待两次 `requestAnimationFrame`，并确认画布可交互；
3. renderer 通过现有 typed IPC 上报 `{runId, windowGeneration, milestone: "renderer-ready"}`；
4. host 校验 run id/generation 后向 stdout 输出唯一机器可解析记录；
5. sampler 收到记录后才记样本，并等待子进程真正退出；超时、提前退出、错 generation 都记失败，不填默认值。

冷启动与热启动分别至少 20 个有效样本。报告必须说明缓存条件；如果无法稳定控制 OS/WebView cache，不得把连续 40 次普通启动分别命名为 cold/warm，应建立可复现的冷/热定义后再测。

### 4.2 交互、保存和导出

候选原生 probe 必须在真实 WebView/Tauri host 内驱动合成文档，记录 monotonic duration：

- 300 nodes / 450 edges 的 pan、zoom、node drag frame intervals；
- create/move/connect/undo；
- 标准文档原生 save；
- 标准文档 2x PNG export；
- renderer-ready 后 stable RSS。

每项 raw 样本、失败数、p50/p95/max、fixture hash 与 candidate hash 都要输出。Web harness 可保留为回归层，但 `measurementSource` 必须是 `web-harness`，不能满足 native release budget。

## 5. 包体与字体策略

当前三份字体约 41.6MB 未压缩，其中 LXGW WenKai 单文件约 24.7MB，是 `.dmg` 超预算的主要来源。按下列顺序做 spike：

1. 优先验证全字库 WOFF2/压缩字体是否可被 WebView、fontkit、SVG→PNG 与 PDF embedding 同时正确消费；比较 `.app`、`.dmg`、首次加载和导出时间。
2. 若不能达标，再比较可合法分发的更小中文手写字体；任何替换都要重新做 CJK coverage、missing glyph、OFL/Reserved Font Name 和 golden。
3. 仅在负责人同意缩小 v1 产品范围时，才可移除可选手写字体。
4. 字体子集化只有在产品明确接受固定字符覆盖与缺字策略时才允许；面向任意用户中文输入时，不能用测试语料子集冒充完整覆盖。

预算不可由实现者修改。产物必须同时满足 `.dmg ≤ 25MB`、entry JS `≤ 500,000B`、每字体/总字体资源限制和三格式导出一致性。

## 6. Bundle 身份与 macOS 行为

在负责人批准修改 `apps/desktop/src-tauri/tauri.conf.json` 后，使用当前锁定的 Tauri schema 实现：

- `bundle.fileAssociations`：`ext=["mindmap"]`、Editor role、`application/x-mindmap+json`、`com.mindmap.document`、conforms to `public.json`；
- `bundle.macOS.minimumSystemVersion`：与产品批准值统一，当前文档目标是 `11.0`；
- 最终 `licenseFile`/copyright/category（仅在文本确认后）；
- 应用产品名、bundle id、version/build number 与 package/Cargo 一致。

构建后必须从产物验证，而不是只检查配置源：

```bash
/usr/libexec/PlistBuddy -c 'Print :CFBundleDocumentTypes' <Info.plist>
/usr/libexec/PlistBuddy -c 'Print :UTExportedTypeDeclarations' <Info.plist>
/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' <Info.plist>
xcrun vtool -show-build <app-binary>
```

随后在受控 macOS 用户环境验证 Finder/LaunchServices 双击 `.mindmap`、open event 路由、已有 `.json` 兼容和默认 Save As 扩展名。注册或修改系统文件关联状态前必须取得精确授权并写明恢复方法。

## 7. 字体切换的权威几何事务

不能在 `SetDocumentStyle(font)` 后继续信任旧字体生成的 node size。推荐新增 core compound command，例如 `SetDocumentFontAndResizeNodes`：

- 输入包含目标 font 和每个 node 的新 measured geometry；
- UI 只可在真实 font resolver ready 后构造命令；pending/failed 进入 GeometryBarrier；
- core 一次校验全部 node id/size 后原子提交，任一无效则零写入；
- undo 一步恢复旧 font 与全部旧 size，redo 一步恢复新值；
- node position、edge、selection 与 viewport 不被隐式修改；
- 300 节点计算与提交纳入高风险编辑命令 `≤50ms` 预算。

不要用“切字体后全图静默重排”替代；持久化 size 的变化必须是可追踪用户命令。

## 8. Capability 生命周期

同一窗口只应有一个 active document handle（外加被明确建模的 in-flight transition）。Save As/rebind 完成后，旧 handle 必须失效；失败或 recovery-pending 时不得提前撤销仍需恢复的能力。

推荐把 handle record 加入 `windowGeneration/sessionGeneration`，并由 lifecycle runtime 在原子 finalize 阶段执行 replace-and-revoke。测试至少覆盖旧 handle 重放、跨窗口、窗口重建、Save As 写后恢复、并发 ordinary save 和 close/reopen。

## 9. 许可证交付

工程 Agent 可以生成依赖清单，但不能自行编写最终 source-available 商业法律条款。负责人/法律需提供或批准：

- 根 LICENSE 最终文本；
- 商业授权入口/权利主体/copyright；
- 第三方 notices 的展示与随包位置；
- ADR 0007 的最终 Accepted/Rejected 结论。

工程侧随后从 pnpm lock、Cargo metadata 和字体清单生成 `THIRD_PARTY_NOTICES`，保留 package/version/license/source/license-text 路径，并验证其被包含进最终 `.app`/`.dmg`。当前扫描口径为 29 direct JS + 300 transitive JS + 487 Cargo packages。

## 10. 最终验证顺序

1. 完成 PRR-065，确认生产 WebView 内没有常驻菜单/顶栏，核心命令已由 macOS 原生菜单与既有快捷键承载；形成新的 clean source commit。
2. 从该 clean source commit 运行 format、typecheck、lint、unit、integration、a11y、build、Rust fmt/test/clippy、boundaries、license、network、JS/Rust dependency advisory、golden、web performance、assets。advisory 工具与数据库版本必须记录；未安装工具不能写成 PASS。
3. 通过强化的 bundle gate 构建新的 unsigned `.app`/`.dmg` 与 inventory。
4. 对同一 hash 运行 native performance、install/LaunchServices、生命周期、快捷键、打开/保存/导出和 CSP 检查。
5. 生成 native platform report JSON 与 G-FINAL 请求；停止并等待负责人实际查看/操作该候选。
6. 仅在收到负责人绑定同一 source/candidate hash 的明确 `[from-user]` 结论后，记录独立 G-FINAL JSON；PRR-070 完成并停止。
7. 另行派发 PRR-080，最后生成 manifest，执行 `verify-evidence` 和全量 `pnpm quality -- --release-evidence ...`，冻结验收包。
8. 用户把冻结验收包交回本审阅任务，由未参与实现的验收者执行 PRR-090；只有 MM-110 `ACCEPT` 才生成新 handoff。

任何一步改变源码、runner 或候选 bytes，都回到第 1/2 步重新开始，不允许局部拼接旧证据。

## 11. STOP 条件

- 未取得真实 G2/生产配置/法律文本/系统文件关联操作的对应授权。
- 需要删除旧候选、证据或临时目录但没有精确删除授权。
- 为过预算而提高阈值、移除测试、缩减字库却未更新产品范围。
- 性能探针只有固定 sleep、硬编码数值或 web harness。
- native report、G-FINAL 与 manifest 不是同一 source commit/candidate hash。
- 任一 P0/P1 未关闭，或 P2 没有负责人接受记录。
- 任务开始涉及签名、公证、凭据、系统信任、上传、push 或公开发布。
