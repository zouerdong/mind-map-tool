# 极简自由脑图工具：架构与技术决策草案

> 状态：Ralplan 共识架构提案。技术栈、文件格式和兼容承诺必须经用户 G1 确认并正式写入 `docs/decisions/` 后才能实施。
>
> 更正（VRA-000 对账，2026-09-06）：G1 已于 2026-08-26 批准，四轨选型（Tauri 2 / React Flow / web-ts-wasm / Noto Sans SC + LXGW WenKai）已固化为 Accepted ADR 0001–0006、0008；本文件降级为历史提案，架构事实以 `docs/decisions/` 与 `docs/architecture/` 为准。

## 1. RALPLAN-DR

### 1.1 原则

1. 领域模型与编辑历史必须独立于桌面框架、React 和画布库。
2. 原生文件和导出物由确定性数据管线生成，不把 DOM 截图当作产品格式。
3. 轻量必须以 macOS/Windows 实测为依据，不能由框架声誉代替。
4. 第一版只构建本地单机应用，不创建服务器后端或延期能力骨架。
5. 关键依赖可替换：交互视图可以更换，文档 schema、命令语义和导出 scene 不随之重写。

### 1.2 Top 3 decision drivers

1. **双平台轻量分发**：安装体积、启动、RSS、系统 WebView 可用性、文件关联与安装器完整度。
2. **自由画布交互交付风险**：节点/连接、平移/缩放、选择等高复杂交互必须可靠，但历史、文件和导出不能被 UI 库绑架。
3. **数据与导出的长期稳定**：原生文件可迁移、损坏安全，SVG/PNG/PDF 内容一致且可验证。

### 1.3 [from-research] 官方证据

- [from-research] [Tauri 2 快速开始](https://v2.tauri.app/start/)与[架构说明](https://v2.tauri.app/concept/architecture/)说明它使用操作系统 WebView，不随应用捆绑浏览器引擎，符合小包体方向。
- [from-research] [Tauri WebView 版本表](https://v2.tauri.app/reference/webview-versions/)显示 Windows 使用 WebView2、macOS 使用 WKWebView；因此必须双平台实测，不能假设渲染完全一致。
- [from-research] [Tauri 配置参考](https://v2.tauri.app/reference/config/)提供 `fileAssociations` 与 bundle 配置；安装器与关联仍须在真实 DMG、MSI/NSIS 上验收。
- [from-research] [Tauri RunEvent](https://docs.rs/tauri/latest/tauri/enum.RunEvent.html)区分 macOS 文件打开/重开事件；Windows 冷启动路径通常来自参数。[single-instance 插件](https://v2.tauri.app/plugin/single-instance/)可把后续实例参数路由到已运行实例。
- [from-research] [Electron 分发文档](https://www.electronjs.org/docs/latest/tutorial/application-distribution)要求把预构建 Electron 二进制随应用打包；[Electron 进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model)采用 Chromium 多进程，因此分发体积和常驻资源是本项目的真实劣势，但运行时一致性是优势。
- [from-research] [React Flow](https://reactflow.dev/)为 MIT 许可并内建拖拽、缩放、平移、选择和连线。其 [undo/redo](https://reactflow.dev/examples/interaction/undo-redo) 与 [copy/paste](https://reactflow.dev/examples/interaction/copy-paste) 是 Pro 示例，不能视作免费核心能力；历史必须属于 `core` command model。
- [from-research] React Flow 的[图片下载示例](https://reactflow.dev/examples/misc/download-image)锁定 `html-to-image@1.11.11`，这是 DOM 截图示例，不足以承担语义 SVG、PNG、PDF 三格式的统一主链。
- [from-research] React Flow 的[ attribution 说明](https://reactflow.dev/learn/troubleshooting/remove-attribution)需要独立做产品/许可决定，不能由实现者悄悄隐藏。
- [from-research] [Neutralino 分发概览](https://neutralino.js.org/docs/distribution/overview/)中的 macOS/Windows installer 指南仍标记为未完成并依赖社区脚本，不适合首版要求的可靠大众分发。
- [from-research] [Flutter 桌面支持](https://docs.flutter.dev/platform-integration/desktop)证明其可构建 macOS/Windows 桌面应用；是否进入本项目执行分支仍要以交付成本和已有任务资产复用率评分。

### 1.4 可行方案

| 方案 | 构成 | Pros | Cons | 结论 |
| --- | --- | --- | --- | --- |
| A | Tauri 2 + React/TypeScript + `@xyflow/react` 仅交互视图 + core command/history + 独立语义 SVG renderer | 预期包体小；画布交互成熟；Rust host 适合原子文件写入、resvg；职责可拆分 | 系统 WebView 差异；Rust/TS 双栈；React Flow attribution/依赖；中文字体与 PDF 仍需验证 | **有条件推荐**，通过双平台 Spike 后采纳 |
| B | Electron + React/TypeScript + 同一 core/UI/export | 运行时一致；桌面生态和调试成熟；作为降级迁移成本低 | 捆绑 Electron/Chromium，多进程，包体/RSS 与“轻量”冲突 | **可靠降级**；若 A 无法通过兼容/导出/文件打开门槛则采用 |
| C（considered） | Flutter + 自研 Canvas/文本编辑/命中测试 | 原生编译、跨平台渲染一致，交互与绘制完全可控 | 必须另建 Dart core/UI/export/tooling 分支，不能复用 A/B 的 TS core、React Flow 验证、导出 harness 与任务卡；首版交付面显著扩大 | **Rejected for v1**；理由是交付成本与任务资产复用率，不基于对团队能力的臆测 |

### 1.5 淘汰与保留理由

- Neutralino：安装器官方链不完整，首版公开双平台分发风险超过它带来的体积收益，淘汰。
- 纯 Web/PWA：不满足本地原生文件关联与桌面交付目标，淘汰。
- 全自研 React Canvas/SVG 交互：技术可行，但第一版会重复实现选择、缩放、连线、命中测试；仅在 React Flow Spike 失败后评估，不作为起步方案。
- Electron 不淘汰：它是 Tauri 系统 WebView 差异无法接受时的现实后备。
- Flutter：官方桌面能力成立，但 v1 需要一整套不可与 A/B 复用的 core/UI/export/tooling 与验证分支；按本项目“最小必要实现面”原则正式淘汰，不进入 Spike 或任务图。

### 1.6 推荐

推荐 A，但它是 **Spike 后确认**，不是既成事实。桌面 host 与画布库分成两个 ADR、各自评分；不能用 Tauri/Electron 对照顺便锁定 React Flow。React Flow 只负责投影与输入事件；canonical document、命令、undo/redo、dirty、序列化和导出均不得依赖其内部结构。

导出 Spike 必须在机器可读登记中形成唯一结论：只有通过 exit criteria 且证据完整的候选才能被推荐；默认优先 **TS/WASM 完整 renderer**，由 `packages/export/` 唯一拥有 SVG/PNG/PDF；只有它失败而 **native renderer** 通过时，才选择 native 并启用互斥的 MM-045 专卡。若两者都失败，轨道必须标记 `blocked`、推荐值为 `null`，不得为了继续实施而强迫二选一，也不得保留“Rust resvg 可能由某卡顺手实现”的第三种模糊状态。

### 1.7 独立评分矩阵

桌面 host ADR 按 100 分评分：跨平台行为一致性与维护复杂度 25；安装/文件事件完整度 20；包体/RSS/启动 20；文件安全/自动化可测性 20；实现与长期维护成本 15。Tauri 和 Electron 必须使用同一硬件、同一合成图、同一脚本；最高分不自动胜出，任何数据安全或文件入口阻断项直接淘汰。

画布 ADR 按 100 分评分：核心交互完整性 25；300/450 性能 20；IME/焦点/可访问性 20；core projection 隔离 15；许可/API稳定性/attribution 15；包体 5。React Flow 的 exit criteria 是：MIT/attribution 决策可接受、无 Pro 代码依赖、标准规模达标、中文 IME 无阻断、projection contract 通过；否则才评估最小自研 React SVG/Canvas 视图。

## 2. 系统边界与依赖方向

```text
apps/desktop (window/menu/lifecycle composition)
   |                 |                    |
   v                 v                    v
packages/ui -----> packages/export/layout   packages/platform ---- selected native host
   |                 |                    |                       |
   +-----------------+-----> packages/core <----------------------+
                             ^
                             |
                 packages/export/scene-render
```

规则：

- `packages/core/` 不依赖 React、React Flow、Tauri、文件系统或浏览器 DOM。
- `packages/ui/` 实现获选 React 画布视图，把 core model 投影为视图模型并把交互归一化为 core commands；只有 canvas decision=`react-flow` 时才生成 React Flow nodes/edges。
- `packages/ui/` 只能依赖 `packages/export/layout` 的公开纯函数，不能反向依赖 scene renderer 或 native adapter；`scripts/quality/check-boundaries.mjs` 必须锁定 `ui → export/layout → core` 且禁止 `core → export/ui`，其 `--scope selected-canvas` 按 decision register fail-closed 选择 React Flow 或 custom view 断言，并拒绝未获选画布依赖进入构建图。
- `packages/export/` 尚不在根目录契约中：MM-020 必须先更新根 `AGENTS.md` 的目录表，再创建目录、`README.md` 和 manifest；它消费 core document，提供共享文本布局/语义 scene，不读取 React DOM。
- `packages/platform/` 定义 TypeScript ports：open/save/dialog/preferences 与获选 renderer 所需 host；差异进入适配器。
- `apps/desktop/` 只组合窗口、菜单、事件、IPC 与包配置；不承载业务规则。
- Tauri Rust 代码是本机 host layer，不是服务器后端；无端口监听、远程 API、数据库或云服务。

## 3. 核心数据模型

建议 canonical TypeScript 契约：

```ts
type MindMapDocumentV1 = {
  schemaVersion: 1;
  document: {
    theme: "light" | "dark";
    nodes: Array<{
      id: string;
      text: string;
      position: { x: number; y: number };
      size: { width: number; height: number };
    }>;
    edges: Array<{
      id: string;
      sourceNodeId: string;
      targetNodeId: string;
    }>;
  };
};
```

约束：ID 在文档内唯一；坐标/尺寸必须有限且在上限内；边不能引用缺失节点；是否允许重复边/自环在 schema ADR 确定（默认拒绝自环、同方向重复边）；纯文本允许显式换行但不得存 HTML。selection、hover、viewport、引导状态、文件路径、history、dirty 不入文件。v1 打开后执行 fit-content；pan/zoom 不进入 undo、不触发 dirty。主题进入文件、undo 和 dirty。

Canonical JSON：UTF-8 无 BOM、两空格缩进、LF、末尾一个换行；schema 规定键顺序，nodes/edges 使用稳定文档顺序；有限数值最多 3 位小数、`-0` 归一为 `0`；字符串保留用户 Unicode 内容并按 JSON 规则转义控制字符。canonical bytes 用于 hash/golden，不能依赖 locale/timezone。

Node `size` 是 v1 容器几何的持久化权威，不能由 exporter 或另一个 WebView重新测量后覆盖。字体 ADR 必须选择有明确再分发/嵌入许可的固定 font token，说明随应用打包或按导出子集化、fallback 顺序、缺 glyph 警告/替代行为与包体代价。首版排版固定 font size/weight、line-height、padding、baseline；换行只认规范化的显式 `\n`，不做依赖 DOM 宽度的隐式重排。共享 `layoutText` 契约产生 node size 与 `<tspan>` baseline，UI 与 exporter 使用同一实现。确定性边界是：同 document/font/renderer 版本的 canonical SVG bytes/hash 必须一致；固定 renderer/font 的 PNG/PDF 必须一致；外部查看器仅要求 ADR 定义的内容/几何容差。

## 4. 命令、DocumentSession 与保存快照

Core 暴露纯函数 `applyCommand(stateNode, command) -> { stateNode, inverse, effects }`。每个 canonical 状态获得进程内永不复用的 `StateIdentity`（单调 64-bit id 或 UUID）；undo/redo 返回原历史节点及其原 identity，分叉编辑永远分配新 identity，绝不能用历史数组索引或可回绕 revision 判断 clean。首版命令：

- `CreateNode`、`EditNodeText`、`MoveNodes`、`DeleteSelection`；
- `CreateEdge`、`DeleteEdges`；
- `SetTheme`；viewport 是 session-only UI state，不是 domain command；
- `ReplaceDocument` 仅用于 load，不进入普通用户历史。

拖动期间 UI 可显示临时位置，pointer-up 只提交一个 `MoveNodes`。删除节点与相连边是一个原子命令；批量移动是一个命令。新命令截断 redo。

`DocumentSession` 管理 `{currentState, savedStateIdentity, displayPath, documentTargetHandle, versionToken, pendingSaves}`。`DocumentTargetHandle` 是 host 签发、进程内 opaque、绑定当前 window/session 的持久目标 capability：从系统文件入口打开文档时取得，或 Save As 首次提交成功后取得；session/window 关闭即撤销，UI 不能由 path/token 伪造，也不能跨窗口复用。开始普通保存时冻结 `{stateIdentity: R, canonicalBytes, documentTargetHandle, expectedVersionToken}`；Save As 则冻结一次性 `TargetAuthorization`。完成后只把 `R` 标为保存点，并接收 host 返回的当前 handle/token。当前仍为 R 或 undo 回到同一 R 时 clean；若保存期间变为任意其他 identity，保存完成后仍 dirty。保存失败不改变 saved identity/handle/token。由此保证：

- `save → undo → divergent edit`：新分支 identity 不等于保存 identity，dirty；
- `save → edit → undo back to saved state`：回到原 R，clean；
- `save in flight → edit → save completes/fails`：完成只确认快照 R，新编辑保持 dirty；失败则保存点完全不变。

并发保存第一版串行化：同一 session 同时只允许一个 commit；后续保存请求排队并在开始时重新捕获快照/token。history 与 StateIdentity 都不写入文件。

## 5. 原生文件格式与安全写入

- 容器：建议 v1 为上述 canonical UTF-8 JSON，便于研究、diff、hash 与恢复；产品名/扩展名/MIME/UTI 均待用户确认。
- 顶层强制 `schemaVersion`；读取先限制文件大小，再 parse、schema 校验、语义校验。
- 未知未来主版本：只读拒绝并提示升级，不允许覆盖原文件。
- `Save As` 成功后才更新当前 path；普通 `Save` 无 path 时转入 `Save As`。
- 损坏文件只报告错误和路径，不自动“修复”或覆盖；后续恢复策略需新 ADR。
- v1 对外发布后，任何破坏性变更都需要 migration 和 ADR。

打开/成功提交后生成非持久化 `VersionToken`：稳定 path identity + 平台 file identity（macOS device/inode；Windows volume/file index）+ size + high-resolution mtime + SHA-256，并与该 session 的 opaque `DocumentTargetHandle` 配对。普通 Save 必须提交 handle + expected token；host 同时复核 handle 的 session/window 绑定、有效期状态、path identity 与当前 token。覆盖已有路径时 `expectedVersionToken` 必填；commit 前重新读取 token，不一致返回 `EXTERNAL_MODIFICATION_CONFLICT`，保留 temp/旧文件并让用户选择另存为或显式重新加载。首版不允许静默强制覆盖。

### 5.1 共同 commit protocol

1. 同目录以不可预测名字和 exclusive-create 建立 temp，保证同 volume。
2. 写入冻结快照的全部 bytes；验证 byte count；注入 `temp-write` 失败点。
3. flush 用户态缓冲并把 temp 文件数据/metadata sync 到磁盘；注入 `file-sync` 失败点。
4. 若覆盖旧文件，在 commit 立即前复核 `expectedVersionToken`；复制/保持 ADR 指定的权限、ACL、扩展属性或明确报告无法保持。
5. 使用平台原子 primitive 提交；注入 `replace` 失败点。失败时旧路径仍指向可读旧文件，session 保持 dirty；temp 按规则标记下次启动清理，不在错误路径上盲删。
6. 对父目录执行平台支持的持久化 flush；若 Windows 目标文件系统/权限无法 flush 目录，记录能力结果并至少 flush 最终文件句柄，ADR 明示 power-loss 边界。
7. 重新读取新文件、计算新 `VersionToken`；Save As 首次成功时由 host 签发绑定该 window/session 的 `DocumentTargetHandle`，普通 Save 返回仍有效的当前 handle（host 可安全轮换）。只有成功后才更新 session displayPath/handle/token/saved identity。

### 5.2 macOS / Windows primitive

- macOS：temp `fsync`，应用目标权限/ACL/必要扩展属性后，使用同目录 `renameat`/经验证的系统 replace primitive 原子替换，再 `fsync` 父目录。文件存在/不存在两条路径都必须故障注入。
- Windows：temp `FlushFileBuffers`；已有目标优先使用 `ReplaceFileW`，新目标使用 `MoveFileExW(..., MOVEFILE_WRITE_THROUGH)` 或等价经验证 primitive；提交后 flush 最终文件句柄，并尝试用带 `FILE_FLAG_BACKUP_SEMANTICS` 的目录句柄持久化目录项，能力不足则写入 ADR 和 power-loss 人工测试。共享冲突、只读、ACL/attributes 保持都要验证。
- 崩溃恢复：只识别本应用命名且位于已授权目录的 stale temp；默认不自动覆盖目标。下次打开可安全清理已证明无用的 temp，删除动作仍遵守项目红线并由发布实现流程明确授权。

## 6. 窗口、文件打开与 IPC

采用一文档一窗口、单应用实例，并用唯一 `LaunchRouter` 处理所有入口：

```text
native source (argv / Opened / Reopen / single-instance / icon activation)
  -> LaunchIntent { id, kind: ActivateEmpty | OpenPaths, paths, sequence }
  -> queue while Booting
  -> AppReady(windowRegistry, rendererBridge)
  -> normalizePathIdentity
  -> dedupe intent/path
  -> WindowAction { CreateBlank | OpenInNewWindow | FocusExisting }
  -> renderer acknowledgement
```

- Booting 阶段只入队，不提前创建默认窗。首次 ready 后：若 cold batch 有文件 intent，直接按顺序打开文件，不先建空白窗；若只有 activation，则建空白窗。
- 图标或 Dock `Reopen`/activation 是已确认的 `ActivateEmpty`：cold/warm 都创建新空白窗口，不替换或关闭现有 dirty 窗。只有 Spike 证明入口不可可靠辨认时才发起范围变更。
- `OpenPaths`：路径先做绝对化、分隔符/Unicode 规范化、存在文件 canonicalization，并优先使用平台 file identity 识别大小写、符号链接或等价路径。已打开 identity 执行 `FocusExisting`；不同文件各建窗口，保持事件 sequence。
- intent id 与 path identity 都幂等；renderer ack 前事件保留，崩溃/重连不重复开窗。连续多文件、重复 native 回调和 argv/OpenEvent 双报必须去重。
- dirty window 不因任何后续 open/activation intent 被替换。关闭与保存只由其自己的 `DocumentSession` 驱动。

IPC 只暴露窄接口，所有 payload schema 校验：

```text
openDocument(path, windowSessionId) -> OpenResult { bytes, documentTargetHandle, versionToken, displayPath, pathIdentity }
authorizeDocumentTarget(suggestedName) -> TargetAuthorizationRef { authorizationId } | cancelled
commitDocumentAs(windowSessionId, targetAuthorizationRef, bytes) -> SaveResult { documentTargetHandle, versionToken, displayPath }
commitCurrentDocument(windowSessionId, documentTargetHandle, expectedVersionToken, bytes) -> SaveResult { documentTargetHandle, versionToken, displayPath }
showOpenDialog() -> path | cancelled
authorizeExportTarget(suggestedName, format) -> TargetAuthorizationRef { authorizationId } | cancelled
commitExport(targetAuthorizationRef, bytes) -> ExportCommitResult { displayPath }
readPreference(key) / writePreference(key, value)
```

`TargetAuthorization` 只负责系统对话框的一次性选址。UI 只收到不可解析的 `authorizationId` bearer reference；canonical `{ normalizedPath, pathIdentity, expectedVersionToken | null, expectedAbsent, targetKind, expiresAt, consumed }` 保存在 host-side ledger，不能由 UI 传入结构字段取得授权。`commitDocumentAs` / `commitExport` 必须以 ID 回查 ledger、校验 kind/expiry/consumed，再复核 path identity/token；已有目标在 dialog→commit 间改变返回 `EXTERNAL_MODIFICATION_CONFLICT`，当时不存在的目标若突然出现返回 `TARGET_APPEARED_CONFLICT`。伪造 ID 返回 `INVALID_TARGET_AUTHORIZATION`，过期返回 `TARGET_AUTHORIZATION_EXPIRED`，消费后 replay 返回 `TARGET_AUTHORIZATION_CONSUMED`，document/export 混用返回 `TARGET_AUTHORIZATION_KIND_MISMATCH`。上述失败不得创建或覆盖目标，也不得更新 document handle/token/saved identity。authorization 短期、单次使用且与目标种类绑定；ledger 项在消费、过期或 session 关闭后按 ADR 清理。

`DocumentTargetHandle` 只负责已打开文档的后续普通 Save：它不包含可由 UI 解析或修改的路径，是 host 维护的 capability reference，绑定 window/session 与目标 identity；伪造、过期、已撤销、跨窗口使用返回 `INVALID_DOCUMENT_TARGET_HANDLE`。`openDocument` 和成功的 `commitDocumentAs` 都返回 handle + token；`commitCurrentDocument` 每次仍复核 expected token，外部修改继续返回冲突。普通 Save 不再次弹 Save As 对话框。UI/MM-030/MM-080 只能保存和回传 opaque handle/token，不得自行拼 path、identity 或 authorization。MM-060 唯一拥有两类 capability、TOCTOU 与撤销测试；MM-040 只生成 bytes，MM-080 只负责冻结 bytes 与调用正确合同。

若 Spike 选择 TS/WASM renderer，PNG/PDF bytes 均在 `packages/export/` 生成，host 只执行 `commitExport`。若选择 native renderer，额外启用由 MM-045 唯一拥有的 `renderExport({ canonicalSvg, format, dimensions, fontToken }) -> bytes | cancelled | size-limit-error`；随后仍通过共同 commit protocol 落盘。两分支互斥，`exportPng` 之类半契约不得残留。

路径来自系统事件/对话框或当前文档授权；WebView 不获得任意文件系统权限。Tauri capabilities 按最小权限配置。错误返回稳定 code + 用户可读 message，不把本机敏感路径写入遥测（项目本就无遥测）。

## 7. UI 与获选画布隔离

- `SelectedCanvasProjection` 把 core nodes/edges 转成 G1 获选画布的 view model；任何画布库内部 selection/measurement/缓存都不进入文件。
- UI 事件经 `InteractionController` 产生 domain command；不得直接 mutate canonical state。
- 文本编辑用受控 overlay/节点编辑器，明确 IME composition；中文输入期间快捷键不得提交错误命令。
- 节点编辑完成时调用共享 `layoutText`，把权威 `size` 与文本作为同一 command 提交；获选画布或 DOM measurement 只可用于临时预览，不能改变保存/导出语义。
- 白/黑主题由 token 表驱动；文档只保存 theme enum，不保存任意 CSS。
- 仅当 `canvasView=react-flow`：projection 可以生成 React Flow nodes/edges，必须隔离其 ID/measurement，并遵守 attribution 决定与“不得使用 Pro 示例代码”的约束。
- 当 `canvasView=custom-react-view`：依赖图中不得出现 `@xyflow/react` 或其类型/样式；不得保留备用分支代码。`check-boundaries.mjs --scope selected-canvas` 必须按批准的 decision fail-closed 选择对应断言。

## 8. 独立导出架构

```text
MindMapDocument
  -> validate
  -> shared text-layout contract + authoritative node size
  -> compute content bounds + padding
  -> ExportScene (rect/text/path/theme/font refs)
  -> serialize semantic SVG (no foreignObject)
       -> .svg bytes
       -> selected renderer -> 2x PNG
       -> selected renderer -> PDF
```

- scene 与 serializer 是纯函数，固定属性顺序、数值精度、节点/边层级、padding、font token、line-height 与 baseline；canonical SVG UTF-8 bytes/hash 对 locale/timezone/DPI 不敏感。
- SVG 使用 `<rect>`、`<text>/<tspan>`、`<path>`；不包含 DOM 控件、React Flow attribution、selection handles 或 onboarding。
- PNG 与 PDF 以同一 SVG 为输入，不从当前 viewport 截图。
- 2x PNG 的像素宽高严格等于 scene CSS width/height × 2；在分配前检查单边长度、总像素与预估内存上限。
- 空文档返回 `EXPORT_EMPTY_DOCUMENT`。超大画布返回 `EXPORT_SIZE_LIMIT` 与“缩小画布或导出 SVG”的操作建议；不能尝试到 OOM 后才失败。
- 白/黑主题背景、中文字体、缺 glyph、PDF 单页/分页、页面尺寸与上限必须在 Spike 后写 ADR。
- 默认分支：TS/WASM renderer 由 MM-040 完整拥有 SVG/PNG/PDF。条件分支：若机器可读 Spike 结果选择 native，则 MM-040 只拥有 layout/scene/SVG，MM-045 串行接管 native PNG/PDF、IPC 和 renderer 依赖；两卡不得并行修改 native host。
- golden 分为 canonical SVG hash/语义快照（跨平台一致）和固定 renderer/font 的像素/PDF golden；外部查看器做内容/几何容差验证。不得用更新 golden 掩盖回归。

## 9. 首次引导架构

`OnboardingStateMachine` 与编辑器功能解耦：

```text
idle -> create-node -> edit-node -> move-node -> connect -> save-or-export -> completed
  \---------------------------------------------------------------> skipped
```

它监听已经发生的 domain command/effect 来前进，不另写一套“教程版编辑器”。状态机本身不依赖 `packages/platform/`：app 在 MM-080 注入初始偏好并持久化 `completed/skipped`；重放创建新的引导 session，但不修改用户文档。锚点以稳定 UI semantic id 定位，动画遵守 reduced-motion。

## 10. 性能与兼容 Spike 门槛

可复现 harness 必须提交到 `scripts/runtime-spike/**`，包含 README、固定依赖锁定、合成夹具生成器和命令；`.tmp/runtime-spike/**` 只存可再生 build/output。Spike 在代表性 macOS 与 Windows 机器验证：

1. 300 nodes / 450 edges 的拖动、缩放、框选与导出。
2. Tauri 与 Electron 的 cold/warm 启动、RSS、安装包/下载体积对照。
3. cold/warm file open；中文、空格、长路径；同文件重复打开。
4. 白/黑主题、中文 IME、系统缩放 100%/150%/200%。
5. 无 `foreignObject` 的语义 SVG；比较 TS/WASM 完整 renderer 与 native renderer 的 SVG/2x PNG/PDF 质量、字体、内存和 owner 成本。
6. 中文字体替换/嵌入、PDF 单页/分页、大画布上限。
7. Windows WebView2 bootstrap 策略；离线/缺失/旧版本处理。
8. macOS/Windows 最低版本与 CPU 架构矩阵。

Spike 输出必须以 `decision-register-template-minimal-mind-map-tool.json` 为 schema 基线，并包含两份独立评分表。顶层与 `desktopHost`、`canvasView`、`exportRenderer`、`font` 四轨都有 `status: recommendation-ready | blocked`。每个候选记录 `result: pass | fail | not-tested`、exit criteria 版本、证据链接和 blocked reasons。

推荐值只能引用同轨 `result=pass` 且证据非空的 candidate；同轨全失败时该轨必须 `blocked`、推荐值必须 `null`，顶层也必须 `blocked`。字体轨同时检查再分发/嵌入许可、中文覆盖、缺 glyph 与包体；不得写占位 fontToken。所有必需轨 `recommendation-ready` 才允许顶层同状态。

MM-010 只能写 recommendation 和 Proposed ADR，绝不能自行 Accepted。`verify-decision.mjs` 必须实现三个 fail-closed profile：`--phase spike-result` 要求 G0 approved、候选/证据/四轨/顶层状态自洽，但允许正常的 G1 pending；`--phase bootstrap` 在前者基础上要求所有必需轨 `recommendation-ready`、G1 approved，并验证 `G1.sourceSpikeResult {path, sha256, generatedAt}` 指向未漂移的 Spike snapshot、四轨 `approvedTracks` 值对应 snapshot 中 PASS candidate 及 `candidateEvidenceSha256`、每轨 `acceptedAdr {id, version, sha256}` 与当前 ADR bytes 及结构化 `acceptedAdrVersions` 条目一致。`candidateEvidenceSha256` 是该候选按路径排序的 evidence manifest canonical bytes 的 SHA-256，不是任意手填摘要；`--phase packaging` 再要求 G2 对精确本地候选准备范围 approved，同时明确不推定签名、公证、凭据、上传或发布。推荐值、candidate evidence、snapshot hash、ADR version/hash 任一在批准后漂移都必须使 bootstrap 非零。MM-010/MM-020/MM-100 分别消费这三个 profile；任一当前阶段条件缺失即对应任务 `BLOCKED`，未来 Gate 的正常 pending 不得反向阻断前一阶段产出。默认偏好仍是 Tauri、React Flow、TS/WASM，但评分较高的 FAIL 候选不能被推荐。

## 11. ADR 草案

### ADR-HOST｜桌面 host（独立）

- **Decision**：Proposed Tauri 2；只有同矩阵 Spike、机器可读 decision 与用户批准后才 Accepted。Electron 是完整降级分支。
- **Drivers**：跨平台行为/维护 25、安装文件入口 20、包体资源 20、数据安全/自动化 20、交付维护成本 15。
- **Alternatives**：Electron 的最强反方论据是同一 Chromium 可减少 WKWebView/WebView2、字体和自动化差异；即使多几十 MB，只要在用户预算内且显著降低缺陷，它应胜出。Flutter 因需要不可复用的 Dart core/UI/export/tooling 分支、扩大 v1 交付面而 rejected；Neutralino 因安装器链不完整 rejected。
- **Why proposed**：Tauri 有轻量潜力且本机 host 适合文件提交，但不能以预期代替实测。
- **Consequences**：若选 Tauri，维护 Rust IPC、WebView2 bootstrap 和两套系统事件；若选 Electron，接受较大包体/RSS但复用同一 TS core/UI/export。
- **Follow-ups**：Spike → 用户确认 host/最低 OS/CPU → 只启用获选分支命令。没有服务器后端。

### ADR-CANVAS｜交互视图（独立）

- **Decision**：Proposed `@xyflow/react` 仅作为视图；不因 host 选择自动 Accepted。
- **Drivers**：交互完整性 25、性能 20、IME/a11y 20、core 隔离 15、许可/attribution/API 15、包体 5。
- **Alternatives**：最小自研 React SVG/Canvas view 可减少依赖，但要重建选择、缩放、连线、命中测试和可访问性。
- **Why proposed**：React Flow 提供首版所需交互；projection/controller 让核心可替换。
- **Consequences**：历史/复制不得依赖 Pro 示例；attribution 与依赖许可前置确认；300/450、IME 和 projection contract 任一阻断即退出。
- **Follow-ups**：画布评分 → attribution 用户确认 → 冻结版本和 exit evidence。

### ADR-DATA-EXPORT｜数据、安全保存与 renderer owner

- **Decision**：core 使用永不复用 state identity、不可变保存快照、canonical JSON 和强制 version token；viewport 不持久化/不 undo/不 dirty，theme 相反。导出使用 semantic SVG；默认 TS/WASM 完整 renderer，失败才启用互斥 MM-045 native branch。
- **Drivers**：防数据丢失/误判、三格式一致、跨平台可测试、唯一 owner。
- **Alternatives**：栈索引 revision（分叉误判，rejected）；DOM screenshot（无语义且不稳定，rejected）；native renderer（保留条件分支，增加 IPC/native owner 成本）。
- **Why chosen**：同一状态/scene/布局契约可覆盖异步保存、分叉历史、中文导出和重复 hash。
- **Consequences**：必须实现平台 commit protocol、failure injection、固定字体/renderer 及尺寸上限；外部查看器只承诺容差。
- **Follow-ups**：用户确认 schema/font/PDF/性能与 renderer decision；MM-020 起每次新增运行时依赖立即执行许可扫描。

### G0 / G1 / G2 决策门

- **G0｜Spike 授权前**：项目负责人确认允许本地实验、macOS/Windows 测试设备/OS 可用，并明确禁止发布、修改 CI/CD/凭据。候选依赖只能存在于 `scripts/runtime-spike/**` harness；MM-000 维护可读清单和 register，MM-010 消费。
- **G1｜Bootstrap 前**：项目负责人基于 PASS evidence 确认 host、canvas、renderer、font、schema v1、最低平台、性能预算、产品标识/扩展名、attribution、PDF/背景/上限；对应 ADR/version 必须 Accepted。MM-000 记录批准人/时间，并把四轨 approved value、PASS evidence digest、ADR id/version/hash 绑定到 `sourceSpikeResult` 的 path/SHA-256/generatedAt；MM-020 用 `verify-decision.mjs --phase bootstrap` 验证批准后无漂移。建议或 Proposed 不等于批准。
- **G2｜发布准备/发布前**：项目负责人确认许可证/商业授权法律文本、安装器选择，并在机器登记中精确列出 MM-100 的 selected host、candidate output paths、installation targets、allowed install/uninstall actions 与 deletion boundaries；默认只允许 unsigned 候选。test-signing、签名、公证、凭据、系统信任修改、上传、公开发布分别需要新的明确授权，不能被 G2 本地准备一并推定。

可读 register 落在 `docs/decisions/decision-register.md`，机器可读 register 落在 `docs/decisions/decision-register.json`，模板为本规划目录下的 JSON 文件。MM-000 是 register maintainer，项目负责人是 approval owner，MM-020/MM-100 是消费者，MM-110 是最终审阅人。任一 Gate 状态不是 `approved` 时，对应消费卡必须返回 `BLOCKED`。

## 12. 许可与发布架构约束

- PolyForm Noncommercial 会把用户已允许的日常商业工作用途一起限制，不符合已确认边界，不建议采用。
- Commons Clause 更接近“禁止通过软件本身销售”的目标，但具体组合、措辞和兼容性仍需法律审阅。
- 建议方向是 source-available dual license：终端使用免费，软件本身商业化需另行授权；最终文本不是工程 Agent 的决定。
- 从 MM-020 起每次新增运行时依赖立即运行许可扫描；发布前再生成完整第三方 license/notice 清单，验证 React Flow、host、字体与导出依赖兼容。
- Tauri bundle 可配置文件关联和平台安装包；Windows WebView2 bootstrap、macOS 签名/公证、Windows code signing 各自是发布任务门槛。CI/CD 与公开发布均需用户另行授权。

## 13. 风险责任

规划级风险、trigger、owner、action 与关闭证据以 `risk-register-minimal-mind-map-tool.md` 为唯一索引。任务卡触发对应 Risk ID 时必须更新证据；`blocked` 风险不能由实现 Agent 自行 waiver，MM-110 逐项复核。
