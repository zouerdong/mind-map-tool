# ADR 0011：VRA-090 后可靠性边界、延迟加载与收口协议

- Status: Accepted（2026-09-07 G-PRC-ADR 批准，结合 PRC 批次收口协议完成对账）
- ADR-Version: 1.1.0
- Date: 2026-09-07
- Scope: MRT-004W2R2、MRT-005、MRT-006、MRT-007、MRT-008、MRT-011、PRC-020、PRC-025、PRC-030

## Context

VRA-090 后仍有几条会影响数据安全、并发正确性、启动性能和长期维护成本的工程收口项：

1. 窗口销毁/重建可以与锁外文件 I/O 交错；旧 generation 的提交完成不能污染同名新窗口。
2. host 读取不可信脑图时必须在分配大 buffer 前拒绝超过 50 MiB 的文件；导出字体资源也需要确定的资源上限。
3. 本机偏好损坏不能阻塞进入画布，但必须可观察并在下次写入时修复。
4. 全局热键换绑不能出现“新键未持久化但旧键已释放”的半提交状态。
5. 导出 renderer、WASM 和字体不应阻塞首帧；首个导出动作才是重资源的硬依赖。
6. PRC 终审识别的三个协议级风险：
   - 文件打开存在“先读内容再 stat 身份”的 TOCTOU 窗口；
   - 字体未 ready 前创建或编辑节点可能将 `DEV_FONTS` fallback 度量固化为权威持久化 size；
   - 全局快捷键 host 先聚焦再由前端读取 `document.hasFocus()` 存在前后台状态竞争。

## Decisions

### 基础可靠性与延迟加载（MRT-004W2R2～MRT-011）

- 为每个锁外 commit/recovery 操作捕获 `{windowLabel, windowGeneration}`；所有 post-I/O registry 作用和 recovery 记录都必须以 generation 原子复核。
- host 文档读取采用 metadata 预检加 `take(max + 1)` 有界读取，最大 50 MiB；超限返回稳定 `DOCUMENT_TOO_LARGE`，不签发 handle。
- 导出字体 bundle 每字体最多 32 MiB、总计最多 64 MiB；PNG/PDF 在进入 resvg/pdf-lib 前返回结构化 `EXPORT_FONT_RESOURCE_LIMIT`。
- 偏好 JSON 只允许顶层对象和标量值。结构损坏返回 `PREFERENCES_CORRUPT`；renderer 回退空快照并显示非阻塞提示，下一次合法 store 以原子替换修复文件。
- 热键换绑顺序固定为“注册新键 → 持久化新偏好 → 注销旧键”；任一步失败都尝试恢复旧绑定和旧偏好，无法恢复时返回 `GLOBAL_SHORTCUT_ROLLBACK_FAILED`。
- Tauri export renderer 只在首帧后的 warmup 或真正导出时动态载入；PNG/PDF 实现分别拆成按需 chunk。启动路径不等待字体或 WASM。

### PRC 协议扩展（PRC-020 / PRC-025 / PRC-030）

- **PRC-020 Descriptor-bound 文件打开**：
  1. 对目标规范路径只打开一次，取得底层文件描述符 `std::fs::File`；
  2. 从该描述符读取 metadata（Unix dev+ino）确定物理身份；
  3. 通过同一描述符流式读取不超过 50 MiB 的内容并计算 SHA-256；
  4. 签发 handle 前，检查目标当前规范路径的 metadata 仍与此描述符一致；若被外部替换则拒绝签发并返回稳定可重试错误；
  5. 失败路径绝不留下 orphan handle。

- **PRC-025 权威几何提交屏障（Geometry Commit Barrier）**：
  1. 真实 bundled font resolver 就绪前，画布正常显示与输入，但不向 document session 提交持久化 fallback node size；
  2. 字体 ready 后用真实 `FontResolver` 计算度量，恰好提交一次 command；
  3. ready 前触发 Save/Close-Save 时，等待真实字体就绪后再提交；加载失败时保留用户输入并提示可恢复错误，绝不保存含 fallback 尺寸的损坏文档；
  4. 历史文档打开继续信任已有持久化 size，不因 ready 事件隐式全图重排。

- **PRC-030 全局快捷键 Pre-focus 两阶段协议**：
  1. host 截获全局快捷键后分配单次 `invocationId`，向目标窗口发送 `shortcut://pre-focus-probe`，此时不调用 `set_focus()`；
  2. renderer 收到 probe 瞬间读取 `document.hasFocus()`，通过 IPC 命令 `resolve_shortcut_invocation` 回报真实焦点；
  3. host 校验 `invocationId` 单次有效性与窗口代次（generation）：
     - 若调用前已聚焦：host 发送 `quick-create` 事件，前端在编辑态时按已有状态机忽略，非编辑态时居中建点；
     - 若调用前未聚焦：host 仅调用 `show()`、`unminimize()`、`set_focus()` 进行安全唤醒，不发送 `quick-create`；
  4. 超时安全退化为仅唤醒不建点。

## As-Built 对账矩阵

| 决议条目 | 生产实现路径 | 正向测试 | 负向/边界测试 | 残余风险与控制 |
| --- | --- | --- | --- | --- |
| Window generation 隔离 | `src-tauri/src/lifecycle/runtime.rs` | `r1_error_visibility_and_actions_bound_to_presentation_window` | `r1_old_generation_ordinary_commit_cannot_recover_new_generation` | 仅限单机单进程，单调自增 generation 消除代次碰撞 |
| 50 MiB 有界读取 | `src-tauri/src/file/mod.rs` (`read_bounded_bytes`) | `open_file` 正常文档 | `open_oversized_document_rejects_before_issuing_handle` | 已由 PRC-020 descriptor 绑定彻底消除读/stat 竞态 |
| 导出字体资源上限 | `packages/export/src/font-source.ts` | 正常字体加载与导出 | `resource-limits.test.ts` (32MB/64MB 超限) | WASM 实例内存由 resvg 上限约束 |
| 损坏偏好自愈 | `src-tauri/src/file/preferences.rs` | 正常偏好读写 | `preferences_corrupt` 序列化错误返回 | 磁盘硬 I/O 错误持续 fail-closed 提示 |
| 热键事务换绑 | `src-tauri/src/shortcuts/mod.rs` | `rebind_registers_new_before_releasing_old` | `rebind_conflict_keeps_old_binding` | 焦点误判竞态由 PRC-030 pre-focus 解决 |
| 延迟加载首帧 | `apps/desktop/src/app/ports.ts` | `measure-release-assets.mjs` (entry ≤ 500KB) | WASM/chunk 失败错误提示 | fallback 尺寸写入由 PRC-025 屏障拦截 |
| Descriptor-bound 打开 | `src-tauri/src/file/mod.rs` + `identity.rs` | `open_file_with_descriptor` | 路径替换测试、多链接测试 | Windows 平台目前处于 deferred，Unix dev+ino 提供强保证 |
| 几何提交屏障 | `apps/desktop/src/app/ports.ts` + `mindmap-app.tsx` | 真实字体加载后恰好提交一次 | fallback 与真实字体尺寸不同时不持久化 fallback | 启动阶段编辑等待微秒级延迟对交互透明 |
| 快捷键 Pre-focus 协议 | `src-tauri/src/shortcuts/mod.rs` + `mindmap-app.tsx` | 前台已聚焦创建节点 | 后台/最小化只唤醒不创建、过期 probe 丢弃 | 超时安全降级至仅唤醒，绝不产生破坏性创建 |

## Consequences

- 彻底消除打开文件时底层对象被替换的 TOCTOU 风险。
- 首帧保留极速响应，同时杜绝持久化存储 fallback 几何尺寸的不一致隐患。
- 全局快捷键 ⌥Space 的行为在 macOS 上绝对确定，无论窗口在后台还是最小化都不会因唤醒过程而误建节点。

## Verification

- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings`
- `pnpm test:unit`
- `pnpm build`
- `pnpm boundaries`
- `node scripts/quality/scan-dependency-licenses.mjs`


