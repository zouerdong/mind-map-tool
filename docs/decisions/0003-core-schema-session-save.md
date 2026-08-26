# ADR 0003: Core Schema、状态身份与保存语义

- Status: Accepted
- ADR-Version: 1.0.0
- Date: 2026-08-26
- Owners: Project maintainers
- Track: schema/session/save（被 MM-030 消费）

## Context

core 是平台无关领域层：不依赖 React、React Flow、Tauri、文件系统或 DOM。必须保证 undo/redo 与 dirty 判定在分叉、in-flight 保存、外部冲突下永不误判，且文件格式可长期迁移、可 hash、可 golden。

## Decision Drivers

- 防数据丢失与 dirty 误判（P0）
- canonical 文件的可验证性与迁移能力
- 命令历史的可测试性
- 与 UI/平台层的严格隔离

## Considered Options

1. **StateIdentity + 不可变保存快照 + canonical JSON + 强制 VersionToken**（推荐）。
2. 栈索引/可回绕 revision 判断 clean：分叉历史下误判，Rejected。
3. 直接序列化画布库状态：UI 库绑架数据格式，Rejected。

## Decision

Proposed 采用方案 1，要点：

1. **Schema v1**：canonical UTF-8 JSON（无 BOM、两空格缩进、LF、末尾换行、固定键顺序）；顶层强制整数 `schemaVersion`；nodes 含 `id/text/position/size`，edges 含 `id/sourceNodeId/targetNodeId`；默认拒绝自环与同方向重复边；坐标/尺寸有限且在上限内；node `size` 是容器几何唯一权威。selection、hover、viewport、history、dirty、path、target handle、onboarding 一律不入文件。
2. **StateIdentity**：每个 canonical 状态获得进程内永不复用的 identity（单调 64-bit 或 UUID）；undo/redo 返回原历史节点及原 identity；分叉编辑永远分配新 identity。
3. **命令模型**：纯函数 `applyCommand(stateNode, command) -> { stateNode, inverse, effects }`；首版命令集 `CreateNode / EditNodeText / MoveNodes / DeleteSelection / CreateEdge / DeleteEdges / SetTheme`；`ReplaceDocument` 仅用于 load；删除节点与相连边、批量移动均为原子命令；新命令截断 redo。viewport 是 session-only，不 undo、不 dirty；theme 持久化、undo、dirty。
4. **DocumentSession**：管理 `{currentState, savedStateIdentity, displayPath, documentTargetHandle, versionToken, pendingSaves}`。普通保存冻结 `{stateIdentity, canonicalBytes, handle, expectedVersionToken}`；Save As 冻结一次性 `TargetAuthorization`。完成只把冻结时的 identity 标为保存点；保存失败不改变 saved identity/handle/token。并发保存串行化，后续请求排队并重新捕获快照。
5. **Host capability**：`DocumentTargetHandle` 与 `VersionToken` 由 host 签发、对 UI 完全 opaque、绑定 window/session；core 只存放/回传，不解析、不伪造、不持久化。

数值规范：最多 3 位小数、`-0` 归一为 `0`；字符串保留用户 Unicode，控制字符按 JSON 转义；canonical bytes 对 locale/timezone 不敏感。

## Consequences

### Positive

- 分叉/in-flight/外部冲突语义全部可判定；文件可 diff、可 hash、可 golden；core 可独立测试。

### Negative

- 必须实现严格 canonical 化与 identity 机制；schema 对外发布后破坏性变更需 migration + 新 ADR。

## Validation

MM-030 单元测试矩阵：identity 永不复用、分叉 dirty、undo 回保存点 clean、in-flight 成功/失败、handle 不序列化、canonical round-trip/hash；属性测试覆盖随机文档 decode∘encode ≡ id 与任意命令序列无 dangling edge。

## G1 批准记录

- **批准人**：ErDong Zou（项目负责人），2026-08-26，基于 macOS Spike 证据（`docs/quality/runtime-spike-decision.json`）。
- **批准决定**：StateIdentity + 不可变保存快照 + canonical JSON + VersionToken
- **绑定**：本版本（1.0.0）内容 hash 已登记于 `docs/decisions/decision-register.json` G1.acceptedAdr；批准后任何内容漂移使 G1 失效并需重新审签。
