# Mind Map Tool 当前进度、剩余路线与空间审计

日期：2026-08-31

## 1. 当前处于什么阶段

项目已经不是“骨架”或早期 demo：core、画布、三格式导出、保存队列、dirty/
history、原生关闭、多窗口 host 状态机和一批真实 macOS 证据均已存在。当前更准确
的定位是：**功能原型已成形，正在做发布前系统性整改；多窗口生命周期仍差最后
一次收口，最终产品 UI 尚未开始。**

这也解释了为何 MRT-004 用时远超前几卡：它同时触及原生窗口、文件 identity、
并发状态机、renderer bootstrap、系统事件、macOS 自动化与 Windows 编译边界，
是当前整改路线中最复杂的一张卡，不代表后面每张都会同样久。

## 2. 到底还剩几步

### 按当前已批准的 macOS v1 范围

严格按可分派工作包计算，还剩 **12 个工作包**：

- 1 个 MRT-004 最终收口：`MRT-004W2R2`；
- 8 个既定工程卡：`MRT-005`～`MRT-012`；
- 3 个 UI/体验包：`UXD-001`、`UXI-001`、`UXI-002`。

为了不再频繁验收，建议合并为 **7 个开发阶段、4 次工程统一验收 + 1 次用户
视觉方向选择**：

| 阶段 | 工作包 | 目标 | 验收节奏 |
| --- | --- | --- | --- |
| 0 | MRT-004W2R2 | generation 与 native 证据最终收口 | 统一验收 1；通过后解锁 MRT-005 |
| 1 | UXD-001 → 用户方向 Gate → UXI-001 | 先定体验方向，再实现极简 App Shell/核心画布结构 | 用户只做一次方向选择；工程随阶段 2/3 一并验收 |
| 2 | MRT-005 | 不可信文件、schema/canonical 不变量、50 MB bounded read | 执行 Agent完成后不单独回来 |
| 3 | MRT-006 ∥ MRT-007 | 三格式导出一致性；整理算法与偏好恢复 | 与阶段 1/2 合并统一验收 2 |
| 4 | MRT-008 → MRT-009 → UXI-002 | 快捷键/焦点、P0 样式操作面、最终交互/视觉/a11y | 统一验收 3 |
| 5 | MRT-010 | 建立唯一可信总门禁与证据链 | 执行后直接进入阶段 6 Internal Gate |
| 6 | MRT-011 → MRT-012 → 最终复审 | release 性能/包体、文件安全/许可证/CSP/治理 | 统一验收 4（发布候选） |

### 若目标仍是 macOS + Windows 同时可下载

当前 README/PRD 的已批准范围是：**v1 只发布 macOS Apple Silicon，Windows 为
稳定后的专门版本**。现有 Windows 工作只保证源码移植边界，不等于 Windows
应用可运行。

若项目负责人恢复最初的“双平台首发”目标，需要在上述 7 阶段后增加第 8 阶段：

- Windows 图标/打包与文件关联；
- Windows 路径/identity/对话框/快捷键差异；
- Windows 实机 E2E、性能、安装/卸载与发布证据；
- 相应 PRD/ADR/Gate 变更。

因此：**到当前批准的 macOS v1 是 7 个阶段；到最初设想的 macOS + Windows
公开可用版本是至少 8 个阶段。** Windows 阶段尚未形成详细卡，不能把同源
compile probe 当作已经完成。

## 3. 空间审计

项目当前约 **10 GB**。异常体积几乎全部来自被 `.gitignore` 忽略、可再生的
构建与依赖缓存，源码、正式文档和 Git 历史本身并不大。

| 路径 | 大小 | 性质 | 建议 |
| --- | ---: | --- | --- |
| `apps/desktop/src-tauri/target/` | 8.3 GB | 当前 Rust/Tauri debug、Windows target、bundle、incremental | 可删；下次 cargo/bundle 自动重建 |
| `scripts/runtime-spike/hosts/tauri-spike/src-tauri/target/` | 887 MB | 已完成 spike 的 Rust build cache | 可删；harness 源码和 lockfile保留 |
| `scripts/runtime-spike/node_modules/` | 383 MB | 旧 spike 独立依赖 | 可删；`npm ci` 可重装 |
| `.tmp/` | 377 MB | spike raw、旧 E2E、W2R 截图/probe | 可再生，但当前 W2R 截图仍有审查价值 |
| `apps/desktop/dist/` | 44 MB | Vite 构建产物 | 可删；`pnpm build` 自动重建 |
| 根 `node_modules/` | 236 MB | 当前开发依赖 | 建议保留，后续 Agent立刻需要 |
| `assets/fonts/` | 40 MB | 正式受控字体资源 | 必须保留 |
| `.git/` | 35 MB | 项目历史 | 必须保留 |
| `.omx/` + `docs/` | 约 1.2 MB | 规划、验收、ADR、审计来源 | 必须保留 |

### 推荐清理方案

立即删除前四个纯构建/独立依赖目标（不含 `.tmp`）：

```text
apps/desktop/src-tauri/target/
scripts/runtime-spike/hosts/tauri-spike/src-tauri/target/
scripts/runtime-spike/node_modules/
apps/desktop/dist/
```

预计释放约 **9.57 GB**，项目会从约 10 GB 降到约 450～500 MB；代价只是下次
Rust 构建和旧 spike 重跑需要重新编译/安装。

`.tmp/` 建议等 MRT-004W2R2 最终验收通过后统一删，可再释放约 377 MB。当前
三次 W2R native run 的截图约 57 MB，虽不是 Accepted 证据，但本轮审查仍在引用；
暂留比现在立刻删更稳妥。

根据项目红线，实际删除前必须由项目负责人对上述精确路径再次确认。不得删除
`.omx`、`docs/quality/evidence`、`assets/fonts`、根 `node_modules` 或 `.git`。

### 已执行结果（2026-08-31）

项目负责人已明确授权上述清理。四个精确目标均已删除并复核不存在；项目总占用
从约 10 GB 降至 **787 MB**。`.tmp` 377 MB、根 `node_modules` 236 MB、
`assets/fonts`、`.git`、`.omx` 和正式证据均按计划保留。删除对象全部是被
`.gitignore` 覆盖的可再生产物；没有新增 tracked-file 删除，`git diff --check`
保持通过。

## 4. 下一步唯一入口

下一位执行 Agent只拿：

`.omx/reviews/2026-08-31-mrt-004w2r2-final-generation-and-native-proof-task-card.md`

它完成并通过统一验收后，MRT-005 与 UXI-001 才进入生产实现。UXD-001 的设计
定义可以并行，但方向必须由项目负责人选择，不能由实现 Agent自行定稿。
