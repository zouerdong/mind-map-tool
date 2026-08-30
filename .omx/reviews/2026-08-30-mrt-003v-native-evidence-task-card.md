# MRT-003V 原生证据收口任务卡

## 1. 定位

**优先级：P0**  
**状态：READY（需 Mac 已解锁）**  
**依赖：MRT-003 代码层已验收通过**  
**预计性质：验证卡，不预设代码修改**

本卡只补齐最终工作区对应的真实 macOS Save/Discard/Cancel 证据，并纠正 evidence 的总状态语义。除非真实验证暴露新 bug，否则不得继续改关闭协议，也不得开始 MRT-004。

## 2. 前置检查

1. 确认 Mac 已解锁，并且执行宿主拥有 Accessibility 权限。
2. `pgrep -fl mindmap-desktop` 检查是否存在用户正在使用的 Mind Map 进程；若存在，先询问用户，禁止直接 `pkill` 可能含未保存数据的窗口。
3. 记录 `git rev-parse HEAD`、`git status --short`、最新变更文件时间。
4. 从当前工作区重新执行 debug bundle 构建，不复用旧 `.app`。
5. 记录 `.app/Contents/MacOS/mindmap-desktop` SHA-256，以及前端产物主 JS 的 SHA-256。
6. 确认 bundle 构建时间晚于所有 MRT-003 生产源码修改时间。

## 3. 自动化原生子集

在最新 bundle 上重跑：

```bash
scripts/quality/run-e2e-macos.sh --case all --skip-build
```

必须重新得到：

- clean 关闭不弹 modal并真实关窗。
- dirty Cancel 保持窗口与 dirty。
- dirty Discard 真实关窗。
- 重复 close 不叠 modal。
- ⌘Q Cancel 阻止退出，Discard 后退出。

不得覆盖旧证据后只保留 PASS 文本；新 evidence 必须携带 bundle hash 和当前 dirty 状态。

## 4. 真实系统 Save 矩阵

测试文件全部使用合成脑图，保存到临时目录；不要使用用户真实文档。

| 编号 | 操作 | 必须观察 |
| --- | --- | --- |
| V1 | 未命名 dirty → native close → Save → 在系统 Save 面板保存到含中文和空格的路径 | 面板可操作；写出合法 canonical 文件；保存完成后窗口关闭 |
| V2 | 未命名 dirty → close → Save → 在系统 Save 面板取消 | 窗口与 close modal 保持；dirty 不变；没有目标文件 |
| V3 | 打开 V1 文件 → 编辑 → close → Save | 不再弹 Save As；ordinary commit 一次；文件更新；窗口关闭 |
| V4 | 打开命名文件 → 编辑 → 外部修改同一文件 → close → Save | 显示冲突；窗口和 dirty 保持；外部 bytes 不被覆盖 |
| V5 | 命名文件保存遭遇真实只读/IO 拒绝 | 显示稳定错误；窗口保持；旧文件不变 |
| V6 | dirty → close → Discard | 不出现 Save 面板；目标 bytes 不变；窗口关闭 |
| V7 | dirty → close → Cancel | 零写盘；窗口与 dirty 保持 |

V5 如果需要修改临时文件权限，只能作用于明确创建的临时夹具，不得修改系统或用户目录权限。清理夹具涉及删除时遵守根 AGENTS.md 红线，先请求用户授权。

## 5. Evidence 格式修正

新报告至少分开：

```json
{
  "automationStatus": "PASS|FAIL|BLOCKED",
  "manualNativeStatus": "PASS|FAIL|BLOCKED",
  "overall": "PASS|FAIL|BLOCKED",
  "source": {
    "commit": "...",
    "dirty": true,
    "changedFilesDigest": "..."
  },
  "bundle": {
    "path": "...",
    "executableSha256": "...",
    "frontendAssetSha256": "...",
    "builtAt": "..."
  }
}
```

只有自动化和人工原生矩阵都 PASS 时 `overall` 才能为 PASS。锁屏、权限不足、系统面板无法操作或 bundle/source 无法绑定时必须写 BLOCKED，不能写 PASS 加 limitations。

建议生成新文件：

```text
.omx/reviews/2026-08-30-mrt-003v-native-evidence.json
```

截图/日志放 `.tmp/mrt-003v/`，报告只保存索引、hash 和结论；不得提交构建产物或用户数据。

## 6. 若发现 bug

- 先稳定复现并记录具体分支、bundle hash、文件前后 hash。
- 小型 UI/测试缺口可做最小修复，但必须重建 bundle并从 V1 全量重跑。
- 若涉及 Rust close permit、应用退出、文件提交或 capability 生命周期，停止扩张，提交独立问题卡给审查者。
- 不得为了取得 PASS 跳过系统面板、改用 fake port 或把人工步骤写成自动化。

## 7. 验收命令

```bash
pnpm exec vitest run apps/desktop/src/app/close-lifecycle.test.tsx apps/desktop/src/app/file-commands.test.ts packages/platform/src/lifecycle/close-protocol.test.ts
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
pnpm typecheck
pnpm lint
pnpm quality
pnpm build
git diff --check
git status --short
```

然后执行最新 bundle 的原生自动化和 V1～V7。

## 8. 完成定义

- 最新 source 与 bundle 有可复核 hash 绑定。
- 原生自动化子集 PASS。
- V1～V7 全部 PASS，或真实失败被准确记录并退回修复。
- evidence 不再用子集 PASS 冒充整体 PASS。
- 未开始 MRT-004，未修改 capability/CI/CD/发布配置。
- 审查者复验报告后，MRT-003 才转为总体验收 ACCEPTED。

## 9. Agent 回报格式

1. 当前 commit、dirty 文件清单、bundle/executable/frontend hash。
2. 自动化每个 case 的结果。
3. V1～V7 的逐项步骤、文件前后 hash、窗口最终状态。
4. 截图/日志索引与哪些步骤为人工操作。
5. 完整命令结果。
6. 新 evidence 路径。
7. `git diff --check` 与 `git status --short`。
8. 声明未把 mock/jsdom 当作 native Save 证据，未开始 MRT-004。
