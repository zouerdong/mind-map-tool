# ADR 0002: 交互画布视图选型

- Status: Accepted
- ADR-Version: 1.0.0
- Date: 2026-08-26
- Owners: Project maintainers
- Track: canvasView（exit criteria 版本 canvas-v1）

## Context

第一版需要自由画布：任意位置创建/移动/连接文字节点、平移缩放、多选、框选、IME 编辑、可访问性。canonical document、命令、undo/redo、dirty 与序列化不得依赖画布库内部结构；画布可整体替换而不重写 core。

## Decision Drivers

- 核心交互完整性（节点/连接/导航/选择）：25
- 300 节点/450 连接性能：20
- IME/焦点/可访问性：20
- core projection 隔离：15
- 许可/attribution/API 稳定性：15
- 包体：5

## Considered Options

1. **React Flow（`@xyflow/react`）**：MIT，内建拖拽、缩放、平移、选择、连线。注意：undo/redo 与 copy/paste 是 Pro 示例，不能视作免费能力；`html-to-image` 图片下载示例是 DOM 截图，不承担导出主链；attribution 处理需要独立产品/许可决定。
2. **最小自研 React SVG/Canvas 视图**：减少依赖与锁定，但需重建选择、缩放、连线、命中测试与可访问性；仅在 React Flow Spike 失败后评估。

## Decision

Proposed **React Flow，仅作为交互视图**。exit criteria：MIT/attribution 决定可被项目负责人接受、无 Pro 示例代码依赖、300/450 双平台达标、中文 IME 无阻断、projection contract 测试通过。任一不满足则 React Flow 标 FAIL 并评估自研视图；两轨全 FAIL 时本轨 `blocked`。host 选型不自动带动画布选型——两者是独立 ADR。

`SelectedCanvasProjection` 只把 core nodes/edges 投影为视图模型；`InteractionController` 把 UI 事件归一化为 core commands；画布库内部 selection/measurement/缓存绝不进入文件。若最终选自研视图，依赖图中不得出现 `@xyflow/react` 或其类型/样式，不得保留备用分支代码。

## Consequences

### Positive

- 首版交互面成熟，降低自研命中测试/连线/缩放的风险；core 可替换性由 projection contract 测试锁定。

### Negative

- attribution 与运行时依赖需要用户确认；库内部 ID/measurement 必须隔离；升级受上游 API 影响。

## Spike 记录（2026-08-26，macOS 腿 Chrome headless）

- React Flow 12.6：300/450 场景 pan/nodeDrag/zoom p95 = 17.9/16.7/16.7 ms（预算 ≤32 ms，PASS）；bundle 372 KB；attribution 默认渲染"React Flow"（MIT，处理方式待 G1 用户确认）；无 Pro 代码依赖。
- 自研最小 SVG 视图：帧率持平、bundle 193 KB；仅实现 pan/zoom/单选拖动，框选/多选/连线/键盘导航/命中测试缺失（自研需重建的全部范围）。
- IME 真实组合输入未测（headless 限制）——双平台人工矩阵项。
- G1 决定（2026-08-26 [from-user]）：选 React Flow；attribution 保留默认显示（如需隐藏须项目负责人另行确认）；无 Pro 代码依赖。

## Validation

MM-010 画布轨评分（同一合成图、双平台）；`check-boundaries.mjs --scope selected-canvas` 按 decision register fail-closed 断言获选分支；G1 批准 attribution 决定与本 ADR。

## G1 批准记录

- **批准人**：ErDong Zou（项目负责人），2026-08-26，基于 macOS Spike 证据（`docs/quality/runtime-spike-decision.json`）。
- **批准决定**：React Flow（@xyflow/react）仅作交互视图；attribution 保留显示
- **绑定**：本版本（1.0.0）内容 hash 已登记于 `docs/decisions/decision-register.json` G1.acceptedAdr；批准后任何内容漂移使 G1 失效并需重新审签。
