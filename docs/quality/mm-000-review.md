# MM-000 审签记录

> 维护者：MM-000（register maintainer）；批准人：项目负责人（project-owner）。
> 每次登记更新必须同步更新本文件；建议/研究不得冒充批准。

## 2026-08-26（二）｜G1 批准与平台范围变更

### G1 审签

- **批准人**：ErDong Zou（项目负责人）；**时间**：2026-08-26。
- **批准内容** [from-user]：
  1. 四轨选型：**Tauri 2**（桌面 host）/ **React Flow**（画布视图）/ **web-ts-wasm**（导出 renderer，MM-045 NOT_ACTIVATED）/ **Noto Sans SC**（基础字体）+ **LXGW WenKai**（手写风格第二字体，[from-user] 提出"要有一个手写体、兼顾中英文"）。
  2. **平台范围变更**：v1 以 macOS 为发布平台（Apple Silicon），Windows 作为稳定后的专门版本；架构保留 Windows 转换口（PRD §1.1 移植就绪约束）。
  3. attribution：React Flow 署名保留显示（安全默认；隐藏需另行确认）。
  4. PDF：单页适合内容 + 字体内嵌子集。
- **证据基础**：macOS Spike 快照 `docs/quality/runtime-spike-decision.json`（v2，recommendation-ready；v1 blocked 快照在 git 历史保留）+ `.tmp/runtime-spike/**` 原始 metrics（digest 已按候选绑定）。
- **绑定校验**：`G1.sourceSpikeResult.sha256 = 24ea43fa…145f`；四轨 `approvedTracks`（value/candidateResult/candidateEvidenceSha256/acceptedAdr id+version+sha256）与 `acceptedAdrVersions` 结构化条目一致；ADR 0001–0006 转 **Accepted 1.0.0**。`verify-decision --phase bootstrap` PASS（2026-08-26，退出码 0）。
- **范围变更影响**：AC-01/07/12/14 改为 macOS 口径；R-013（缺 Windows 设备）状态改为 **accepted-by-user**（范围变更吸收，Windows 版本另行立项）；R-002/R-003/R-009 关闭（候选已定）；R-001/R-004/R-007/R-008/R-015 维持 monitoring（实现期验证）。

### 未决项更新

1. 产品名、扩展名、MIME/UTI、图标——维持 TBD（G2 前）。
2. Intel macOS 覆盖——不承诺。
3. React Flow attribution 隐藏选项——如需再议。
4. `verify-decision` bootstrap profile 对"快照内 recommendation 与 register 一致性"的检查为 register 内部对照（快照 v2 同步重生成，两者由 finalize-g1.mjs 原子产出）；ADR bytes/hash 与 sidecar 漂移检测已生效。MM-110 复核时抽验。

---


## 2026-08-26｜初始固化 + G0 批准

### 交付物清单

| 交付物 | 状态 | 来源 |
| --- | --- | --- |
| `docs/product/v1-product-spec.md` | 已存在（Ralplan 基线，本次未改动） | `.omx/specs/deep-interview-minimal-mind-map-tool.md` |
| `docs/decisions/0001-desktop-host.md` ~ `0007-licensing.md` | 本次创建，7 份全部 Proposed | 架构提案 §11 ADR 草案 + PRD 对应章节 |
| `docs/decisions/decision-register.json` | 本次从模板初始化；G0=approved，四轨 blocked/not-tested，G1/G2 pending | 模板 + 项目负责人 2026-08-26 会话授权 |
| `docs/quality/v1-quality-gates.md` | 本次创建 | PRD §9/§13.1 + 测试规格 §1 + 开发指导 §3 |
| 本审签记录 | 本次创建 | — |

### G0 审签

- **批准人**：ErDong Zou（项目负责人）
- **时间**：2026-08-26
- **授权依据** [from-user]：项目负责人于 2026-08-26 会话中明确授权"按照开发指导以及任务卡进行后续的具体开发工作"，并要求在关键节点（前端界面设计、功能与快捷键等）停下来探讨。该授权覆盖 G0 范围（本地 Spike 实验）；解读为 G0 批准，登记于 decision-register.json。
- **设备登记**：macOS = Apple M4 / 24 GB / macOS 26.6.2 (25G83) / arm64（本机实测）。**Windows = 项目负责人 2026-08-26 确认当前无 Windows 设备**——MM-010 的双平台聚合证据与 recommendation-ready 保持 BLOCKED（R-013）；macOS 侧四轨证据先行采集；替代路径（借用/购置设备、本机 Windows 11 ARM 虚拟机、范围调整为 macOS 先行）留待 G1 讨论时由项目负责人决定。
- **红线登记**：候选依赖仅限 `scripts/runtime-spike/**`；不发布、不改 CI/CD、不访问凭据、不签名/公证、G1 前不装正式产品依赖、不上传远端。

### 逐链接对照

| 对照项 | 结果 |
| --- | --- |
| PRD ↔ deep-interview spec（`.omx/specs/`） | 一致：PRD 标注需求事实来源为访谈规格；范围/非目标/AC-01～AC-14 未发现冲突 |
| ADR 0001/0002/0004 ↔ 架构提案 §1.4–1.7、§11 | 一致：候选、评分权重、exit criteria、blocked 语义原样固化 |
| ADR 0003 ↔ 架构提案 §3–5 | 一致：schema/canonical/StateIdentity/DocumentSession/capability 语义完整搬运 |
| ADR 0005/0006 ↔ PRD §8.2/§9 + 架构提案 §8/§10 | 一致：字体/PDF 策略与预算基线标 Proposed，待 Spike/G1 |
| ADR 0007 ↔ PRD §12 [from-user] 边界 | 一致：免费终端使用 + 商用另授权；PolyForm 明确不建议 |
| decision-register ↔ 模板 schema | 结构一致；仅 G0 字段按批准填充；validationProfiles/consumerRules 未改动 |
| v1-quality-gates ↔ 开发指导 §3 + PRD §13.1 | 一致：G0/G1/G2 定义、进入条件、不包含项对齐 |

### 未决项（保持 Proposed/TBD，不冒充批准）

1. **Windows Spike 设备**：型号/OS/CPU 架构待项目负责人登记（停点A）。
2. G1 全部内容：四轨选型、schema/平台/预算/标识/扩展名/attribution/PDF——待 MM-010 PASS 证据。
3. 产品名、扩展名、MIME/UTI、文件图标：用户确认门槛，全部 TBD。
4. 最终许可证文本：G2 法律审阅门槛。
5. `verify-decision.mjs`：按任务卡在 MM-010 建立后追加对 JSON 登记的自动校验；此前以本文件人工一致性记录为 evidence。

### 风险状态更新

R-016（登记完整性）：本次建立了 register + 审签记录，状态 open→monitoring（G1 漂移检测依赖 MM-010 的验证器，建立前人工对照）。R-002/R-003/R-007/R-009/R-011/R-013 维持 open。
