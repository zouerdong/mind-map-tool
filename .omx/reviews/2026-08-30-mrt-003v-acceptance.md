# MRT-003V 验收报告

## 结论

**ACCEPTED。MRT-003 至此完成代码与原生证据双重收口。**

没有发现需要退回的中大型问题。验收发现并现场修复两个小缺口：证据中的最新源码时间漏算最终 Rust serde 修复；该 serde 修复缺少自动化反序列化回归测试。两项均不改变生产语义，修复后完整门禁通过。

MRT-004 的 MRT-003V 前置已解除，但 ADR 0008 仍是强制决策 Gate；项目负责人明确批准前，不得修改其状态或开始多窗口生产实现。

## 证据核验

| 项目 | 结果 | 复核事实 |
| --- | --- | --- |
| 工作区基线 | PASS | 验收开始时为干净 `v0.1.4 / 8394f10` |
| 可执行文件绑定 | PASS | SHA-256 `6b404104...25f78e6` 与 evidence 一致 |
| 前端资源绑定 | PASS | `index-W04bpmv5.js` SHA-256 `2192a650...655d237e` 与 evidence 一致 |
| 构建先后 | PASS | 最终 serde 源码原始 mtime 15:12:54；bundle 15:13:49 |
| 自动化原生子集 | PASS | E2E-01A、E2E-16、E2E-CL1～CL5，7/7 |
| V1 Save As | PASS | 真实 NSSavePanel；中文+空格路径；306 bytes；canonical JSON；窗口关闭 |
| V2 面板取消 | PASS | 回到 close 决策；dirty/窗口保持；无目标文件 |
| V3 ordinary Save | PASS | 不弹 Save 面板；文件 hash `47bc...` → `f75f...`；窗口关闭 |
| V4 外部冲突 | PASS | 稳定冲突错误；外部文件 hash `61253...` 不变；窗口保持 |
| V5 I/O 错误 | PASS | 真实只读目录；`FILE_IO_ERROR`；旧文件不变；权限已恢复 755 |
| V6 Discard | PASS | 不出现 Save 面板；目标 bytes 不变；窗口关闭 |
| V7 Cancel | PASS | 零写盘；modal 清除；dirty/窗口保持 |
| 证据状态语义 | PASS | automation/manual/overall 分开记录，三者均为 PASS |

原始截图和合成夹具仍位于 `/tmp/mrt-003v/`，仓库 evidence 只保存索引、hash 和结论，符合任务卡约定。验收还使用最新 `.app` 做了只读启动抽查：窗口可从字体/渲染引擎加载态进入空白画布，工具条和可访问性树正常；抽查产生的空白窗口已经关闭，未触碰用户文件。

## Source / bundle 绑定说明

evidence 生成时源码状态为 `d57d9b9 + dirty`，之后被完整提交为 `8394f10` 并标记 `v0.1.4`。原报告的 `changedFilesDigest` 没有记录算法，不能单独作为可复算证明；本次额外核对了：

1. 证据记录的 executable 与前端资源 hash 均和被测产物一致。
2. 最晚生产源码变更为 15:12:54 的 `ipc/mod.rs` serde 修复，早于 15:13:49 的 bundle。
3. 其余 MRT-001～003V 生产源码均早于该 bundle；15:22 后只有 evidence/规划落盘和提交动作。
4. 当前相对 `8394f10` 的生产差异仅为本次新增的 `#[cfg(test)]` 回归测试，不进入正常 bundle。

因此接受该 source/bundle 绑定。以后 evidence 必须同时记录 digest 算法或直接绑定已提交 tree，避免再次依赖反向审计。

## 现场小修

### S1：更正 evidence 的最新源码时间

将 `builtAfterLatestSourceMtime` 从漏算 Rust 的 14:43:16 更正为 `15:13:49 > 15:12:54 (ipc/mod.rs)`。

### S2：补齐 IPC camelCase 自动化回归

在 `apps/desktop/src-tauri/src/ipc/mod.rs` 增加 Rust 单元测试，同时覆盖：

- `ordinary` 的 `documentTargetHandle`、`expectedVersionToken`、`contentJson`。
- `save-as` 的 `authorizationRef`、`contentJson`。

该测试直接保护 MRT-003V 原生验证中发现的真实故障根因。

## 审查者复验

| 命令/检查 | 结果 |
| --- | --- |
| `pnpm quality` | PASS：26 files / 256 tests；全部阶段 PASS |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | PASS：46 tests |
| `cargo clippy ... -- -D warnings` | PASS |
| `pnpm build` | PASS |
| changed-scope Prettier / Rustfmt | PASS |
| `git diff --check` | PASS |
| Computer Use 最新 `.app` 启动抽查 | PASS |

quality 中 `verify-decision ... FAIL` 是负向漂移夹具的预期输出；外层测试和 quality 汇总均为 PASS。

## 后续状态

- MRT-001～003V：ACCEPTED。
- MRT-004：等待 ADR 0008 明确批准；批准后先执行 MRT-004A，不应一次性把 A～E 全部塞给同一个 Agent。
- UXD-001：可以并行进行体验设计定义，但暂不重写生产 UI。
