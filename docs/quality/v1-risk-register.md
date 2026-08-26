# 极简自由脑图工具：风险登记册

> 状态：Ralplan 共识风险基线。

> 状态值：`open`、`monitoring`、`blocked`、`closed`、`accepted-by-user`。任务 owner 不能自行把需要用户/法律审阅的风险关闭；最终 accountable reviewer 为 MM-110，产品/发布决定人为项目负责人。

| Risk ID | 风险与影响 | Owner task / reviewer | 可观察触发条件 | 触发后动作 | 关闭证据 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| R-001 | Tauri 的 WKWebView/WebView2 差异导致入口、IME、渲染或自动化不一致 | MM-010、MM-060 / MM-110 | 任一平台 exit criteria FAIL 或差异缺陷 P1+ | host 轨停止推荐 Tauri；评估通过的 Electron，若无 PASS 则 R-002 | 两平台同脚本 PASS、host score、缺陷关闭记录 | open |
| R-002 | 所有 desktop host 候选失败，错误锁死较高分候选 | MM-010 / 项目负责人、MM-110 | Tauri/Electron 均无 PASS | decision 顶层及 host 轨置 `blocked`；停止 MM-020，开研究/范围决策 | 新候选或修订门槛后至少一候选 PASS + 用户 G1 批准 | open |
| R-003 | React 画布候选均未通过交互、IME、a11y、性能或隔离 | MM-010、MM-050 / MM-110 | React Flow/custom 均 FAIL | canvas 轨 `blocked`，停止 MM-020/MM-050；不得选最高分失败项 | 至少一候选满足 canvas-v1 且 G1 批准 | open |
| R-004 | React Flow attribution/API/许可与产品分发不兼容 | MM-010、MM-020 / 项目负责人、MM-110 | attribution 不可接受、许可扫描失败或需 Pro 代码 | React Flow 标 FAIL；改评通过的 custom view 或阻断 | attribution 决议、license scan、依赖版本证据 | open |
| R-005 | Save As/导出选址 authorization 被伪造、重放、过期、错类型使用或遇到 TOCTOU，或普通 Save handle 被伪造/跨窗口复用，造成越权覆盖 | MM-060、MM-080 / MM-110 | authorization ID 不在 host ledger、已 consumed/expired、kind 不匹配、dialog 后 target 改变，或 handle 伪造/过期/撤销/跨窗口 | 返回稳定 authorization/handle 错误族或冲突；不得创建/覆盖目标或更新 handle/token/saved identity | authorization forged/replay/expired/wrong-kind + dialog→commit TOCTOU + handle 生命周期双平台 failure test | open |
| R-006 | Windows directory flush、ACL/attributes、文件系统语义不满足耐久承诺 | MM-060、MM-090 / MM-110 | capability probe FAIL、NTFS/非NTFS 行为不同、ACL 丢失 | 标明能力边界；数据安全失败则 BLOCKED，power-loss 边界需用户接受 | Windows 两设备/文件系统报告、failure injection、人工审签 | open |
| R-007 | 固定字体许可、中文覆盖、缺 glyph 或包体不达标 | MM-010、MM-040 / 项目负责人、MM-110 | 所有字体候选任一许可/覆盖/包体 exit FAIL | font 轨 `blocked`，停止 MM-020；不得填占位 fontToken | 字体许可链接、CJK corpus、缺 glyph、包体 PASS + G1 | open |
| R-008 | PDF 分页、字体嵌入或多 viewer 结果不符合首版 | MM-010、MM-040 / 项目负责人、MM-110 | 页数/MediaBox/字体/几何 tolerance FAIL | renderer/PDF 策略阻断；请求 G1 调整而非静默降级 | 两 viewer 结果、PDF golden、用户批准 ADR | open |
| R-009 | TS/WASM 与 native renderer 均未通过质量/内存/许可 | MM-010、MM-040/MM-045 / MM-110 | 两 candidate 均 FAIL | renderer 轨和顶层 `blocked`；停止 MM-020 | 至少一 renderer PASS + G1 批准 | open |
| R-010 | OS 级自动化/系统对话框/文件事件无法稳定执行 | MM-090 / MM-110 | runner flaky 超阈值或 API 无法自动化 | 不用 mock 冒充；建立可重复人工 case；关键数据安全项无法验证则 BLOCKED | 两平台人工记录、截图/日志、flaky 分类 | open |
| R-011 | source-available/双重许可文本误伤允许用途或与依赖不兼容 | MM-100 / 项目负责人、法律审阅、MM-110 | 法律未审、依赖扫描失败、商业边界歧义 | G2 `blocked`；不写最终许可、不公开发布 | 法律审阅记录、最终文本、third-party notices | open |
| R-012 | 多 Agent 越界修改/manifest 冲突导致实现不可合并 | 各任务 owner / MM-110 | 修改允许 glob 外文件或 MM-060/MM-045 并行 | 立即 STOP，回报冲突；按依赖串行重新派发 | path diff、任务回报、boundary check | open |
| R-013 | 缺少 macOS 或 Windows 真实设备，产生单平台推断 | MM-010、MM-060、MM-090、MM-100 / 各卡聚合 owner、MM-110 | 任一要求平台没有结果 | 对应任务 `BLOCKED`，不得聚合 PASS 或进入下一 Gate | macOS/Windows 各一报告 + 聚合报告 | open |
| R-014 | commit 任一阶段失败、外部修改、target handle 生命周期或异步保存导致数据丢失/dirty 误判 | MM-030、MM-060、MM-080 / MM-110 | failure injection、分叉/in-flight、open/Save As 后 ordinary save 或 handle 撤销测试失败 | P0 BLOCKED；修复后 MM-090 全量重跑 | unit/integration/E2E + ordinary-save 无重复弹窗 + 旧文件 hash/dirty 证据 | open |
| R-015 | 300/450、启动、RSS、包体或导出超预算 | MM-010、MM-050、MM-090 / 项目负责人、MM-110 | 任一批准预算 FAIL | 候选 FAIL 或开性能修复卡；不得自行放宽预算 | 两平台 performance.json + G1 预算批准 | open |
| R-016 | recommendation 未通过 exit criteria、G1 批准后 evidence/ADR/Spike snapshot 漂移、验证阶段串用，或未经对应 Gate 批准就被消费 | MM-010、MM-000、MM-020、MM-100 / 项目负责人、MM-110 | 任一 approved value 非 PASS 推荐、candidate evidence/source snapshot/ADR digest 改变、`spike-result/bootstrap/packaging` profile FAIL、批准记录缺失，或未来 Gate pending 错误阻断前一阶段 | 当前消费卡 `BLOCKED`；G1 失效并重新审签；禁止越过 G1 scaffold 或 G2 packaging；不得通过放宽 validator 继续 | 三 profile drift/negative tests、sourceSpikeResult SHA-256、approvedTracks、ADR id/version/hash、G0/G1/G2 审签与退出码 | open |

## 使用规则

1. 每张任务卡必须列出所负责或可能触发的 Risk IDs，并在回报中逐项更新状态/证据。
2. 触发 `blocked` 的风险时，不得用评分、mock、单平台结果或未经审阅的 waiver 继续。
3. MM-090 生成 `docs/quality/risk-evidence-index.json`；MM-110 按 Risk ID 逐项复核。需要用户接受的残余风险只能标 `accepted-by-user`，并链接 decision register 记录。
