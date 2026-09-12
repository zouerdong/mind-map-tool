# PRR-070-R2：接通 Graph JSON 桌面导出

状态：`READY_FOR_EXECUTION / LOCAL_DOGFOOD_BLOCKED / G-FINAL_NOT_REQUESTED`。优先级 P0。

## 1. 根因与目标

PRD 已明确 Graph JSON 是第四导出格式，`packages/export/src/graph-json.ts` 及其契约测试也已存在；但桌面端
`ExportFormat`、`exportFlow` 和导出面板仍只接通 SVG/PNG/PDF。PRR-070-R1 的三格式冒烟沿用了这个错误范围，导致候选漏掉用户明确要求的“供 Agent 直接理解”能力。

本卡只把现有 Graph JSON serializer 接到桌面产品中。完成后应在导出面板最先看到
`Graph JSON（供 Agent）`，导出文件名为 `<脑图名>.graph.json`，内容直接使用现有 `encodeGraphJson` 契约。

## 2. 实现约束

1. 扩展桌面 `ExportFormat`，使用稳定内部值 `graph-json`；不要把 `.mindmap` 保存文件冒充 Graph JSON。
2. `exportFlow` 对 `graph-json` 直接调用 `encodeGraphJson`：
   - 在弹出目标选择前冻结当前 document bytes；
   - 不调用 `buildScene`、SVG、PNG、PDF renderer；
   - 不依赖字体加载、WASM 或画布截图；
   - 继续复用现有一次性 export authorization 与 `commitExport` 安全写入链。
3. 建议文件名映射：`graph-json -> .graph.json`，其余格式保持原样。
4. 导出面板顺序固定为：Graph JSON（供 Agent）、SVG、PNG（2x）、PDF。Graph JSON 必须有稳定的
   `data-testid="export-graph-json"`。
5. `MindMapApp` 中只对三种视觉导出执行字体/geometry barrier；Graph JSON 仍需先 flush 当前编辑文字，但不得因字体资源失败而不可导出。
6. 同步仍会编译的备用/开发 UI 与快捷键说明，避免继续显示“三格式”。无需给 Graph JSON 新增独立快捷键；`⌘E` 仍打开统一导出面板。
7. 不修改现有 Graph JSON schema/version，不修改 `.mindmap` schema，不新增依赖，不改 Rust host、生产配置、DMG 装配、性能预算或 VoiceOver 设置。

建议允许修改：

- `apps/desktop/src/app/export-commands.ts`
- `apps/desktop/src/app/mindmap-app.tsx`
- `apps/desktop/src/app/app-header.tsx`
- `apps/desktop/src/app/shortcut-table.md`
- 与上述行为直接对应的测试
- 必要的任务状态文档

## 3. 必须测试

增加定向测试，至少证明：

1. `exportSuggestedName(..., "graph-json")` 生成 `.graph.json`。
2. 导出 bytes 可 JSON parse，并包含：
   - `format: "mindmap-graph-json"`
   - `version: 1`
   - `meta.nodeCount/edgeCount`
   - `graph.nodes[].id/label/text/position/size`
   - `graph.edges[].source/target`
3. 同一文档两次输出 bytes 完全一致；不含时间戳、机器路径或内部 `schemaVersion`。
4. Graph JSON 路径不调用 renderer；即使 renderer/font metrics 不可用也能成功导出。
5. 编辑中的文字先 flush，再进入 Graph JSON snapshot。
6. 导出面板真实显示四种格式，Graph JSON 位于首位。
7. SVG/PNG/PDF 原有路径和测试不回归。

最终只运行一次：

```text
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
```

无需重跑 advisory、性能矩阵、全量 macOS 原生矩阵、LaunchServices 或 VoiceOver。

## 4. 候选冒烟

形成 clean implementation commit 后，构建一次新的 unsigned `.app`/ULMO `.dmg`，只做以下冒烟：

1. 新建两个节点并连一条边，输入中英文文字。
2. 打开导出面板，确认四个选项且 Graph JSON 位于首位。
3. 导出 `.graph.json`，重新读取并验证节点、边、文字和 source/target 正确。
4. 用普通文本编辑器打开，确认 UTF-8、两空格缩进、末尾换行，结构无需项目内部文档也可理解。
5. SVG/PNG/PDF 各点一次，只确认入口仍可用；不重复视觉矩阵。

本轮应用代码会变化，因此旧 app hash 不再作为最终 dogfood 候选；但这种局部接线不要求重跑 20×性能矩阵。记录新 app/DMG hash 和大小即可。

## 5. 停止点与交回

完成后停在 `READY_FOR_INDEPENDENT_REVIEW`。不得安装到 `/Applications`、申请 G-FINAL、执行 PRR-080/090、签名、公证、push、上传或发布。

```text
Task: PRR-070-R2
Status: READY_FOR_INDEPENDENT_REVIEW | BLOCKED_ON_<真实原因>
Base: <完整 clean commit>
ImplementationCommit: <完整 clean commit>
Changed: <文件与目的>
Verification: <命令与结果>
GraphJsonContract: <filename / format / version / node-edge-text checks / deterministic>
RendererIndependence: <renderer/font failure case>
FourFormatSmoke: <Graph JSON + SVG + PNG + PDF>
Candidate: <app path / sha256 / bytes>
DMG: <path / sha256 / bytes / verify>
VoiceOver: NOT_STARTED
Evidence: <本轮 .tmp 路径>
NotRun: advisory / performance / full native matrix / G-FINAL / PRR-080/090 / signing / notarization / push / upload / publish
Risks: <真实遗留；无则 none>
Next: STOP_FOR_INDEPENDENT_REVIEW
```

