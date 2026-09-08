# Release Readiness Manifest Schema（v3，PRR-000）

状态：`ACTIVE`（2026-09-07 PRR-000 定义；消费方 `scripts/quality/verify-evidence.mjs`）

本文件是发布 readiness manifest 的唯一 schema 来源。v1/v2 是 PRC 批次的历史形态：它们只能作为审计材料被读取，`verify-evidence` 对 v1/v2 一律拒绝发布 PASS（"历史 manifest 只可审计"）。任何新 manifest 必须使用 v3，并由 PRR-080 在 PRR-070 全部输入 artifact 与真实 G-FINAL 生成之后最后写入。

## 1. 顶层必需字段

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `schemaVersion` | number | 必须为 `3` |
| `caseId` | string | 长度 ≥3 的用例标识 |
| `task` | string | 非空；生成该 manifest 的任务号（PRR-070/080） |
| `generatedAt` | string | ISO 时间；不得早于任何被引用 artifact/批准/命令的完成时间 |
| `source.commit` | string | 生成证据时的 HEAD；verify 时必须等于当前 HEAD |
| `source.worktree` | string | 必须为 `clean`；verify 时实际 worktree 也必须 clean |
| `environment` | object | `platform`/`arch`/`os`/`node`/`buildType` 均为非空字符串 |
| `commands` | array | 非空；见 §2 |
| `platformReports` | object | 见 §5 |
| `releaseScope` | object | 见 §6；缺失即"历史 manifest 只可审计" |
| `candidate` | object | 见 §3 |
| `approvals` | object | 见 §4 |
| `overall` | string | 必须为 `READY` |

## 2. commands[]（schema v3 新增执行窗口）

每个 command 记录一次实际执行的验证命令：

| 字段 | 约束 |
| --- | --- |
| `id` | 唯一；`cmd-bundle`、`cmd-install-gate`、`cmd-release-performance` 三个发布必需 id 不可缺失 |
| `command` | 完整命令文本 |
| `exitCode` | 整数且为 0 |
| `startedAt` / `finishedAt` | ISO 时间；`finishedAt ≥ startedAt` 且不晚于 `generatedAt`（v3 强制，缺失即失败） |
| `artifact` | runner 生成的 JSON 证据路径（repo 相对）；禁止直接指向二进制/`.app` |
| `artifactSha256` | 64-hex；verify 时按 artifact 内容复算（v3 对全部 command 生效，不区分 runner） |

发布 runner（bundle/install/performance）的 JSON artifact 自身必须内嵌 `sourceCommit`、`runnerSha256`（与当前仓库 runner 文件 hash 一致）、candidate 绑定、`generatedAt` 以及 v3 要求的 `startedAt`/`finishedAt` 执行窗口；`measurementSource` 出现在测量类 artifact 上（`native-candidate` 才能满足原生预算，`web-harness` 只可作回归层）。

## 3. candidate

| 字段 | 约束 |
| --- | --- |
| `path` | `.app` 目录；不得为符号链接；hash/mtime 可复算 |
| `sha256` / `installerDmg` / `dmgSha256` | 与 bundle inventory 一致；`.dmg` ≤ Accepted ADR 0006 预算 |
| `unsignedConfirmed` | 必须 `true`（签名属独立授权） |

## 4. approvals（自动化不得授予）

`approvals.g2` 与 `approvals.gFinal` 都必须存在且逐字可复算：

- `status` 为 `APPROVED`；
- `approvedBy` 为**真实批准人姓名/可审计身份**，`project-owner`/`owner`/`tbd`/`unknown` 等占位一律失败；
- `approvedAt` 合法且不晚于 `generatedAt`；
- `userRecord` 以 `[from-user]` 开头，且逐字出现在被引用的批准记录 artifact 中；
- `gFinal.candidateSha256` 必须等于 manifest candidate 的 `sha256`；G-FINAL artifact 是独立 JSON（`approvalKind: "g-final"`），并绑定 `sourceCommit`；
- **任何自动化 runner 都不能生成或代签这两类记录**；runner 只能准备证据，Gate 由项目负责人在实际查看/操作候选后给出。

## 5. platformReports

required 平台（v1 为 `macos`）必须 `status: verified`、`exitCode: 0`，artifact 为 native platform report JSON：

- `evidenceKind: "native-candidate"`（不是 `.app` 路径或 web harness 输出）；
- `sourceCommit`/`candidateSha256`/`platform` 与 manifest 一致；
- `overall` 或 `status` 为 `PASS`。

deferred 平台必须给出 `reason` 与存在的 `decisionRef`，且不得与 required 重叠。

## 6. releaseScope

`productVersion` 非空；`requiredPlatforms` 非空且为已知平台。G2 批准范围（candidate 输出路径、允许动作、禁运清单）由 `approvals.g2.artifact` 指向的 decision register 复算，`verify-evidence` 会拒绝越界路径与缺失动作。

## 7. 时间拓扑总则

manifest 的 `generatedAt` 是证据链的终点：任何 command 的 `finishedAt`、runner artifact 的 `finishedAt`、批准记录的 `approvedAt`、candidate 产物的 mtime 都不得晚于它。生成后任何输入 artifact 变化（hash 漂移）都会使 verify 失败；改变源码、runner 或候选 bytes 必须新建批次并重新生成 manifest，不允许局部拼接旧证据。
