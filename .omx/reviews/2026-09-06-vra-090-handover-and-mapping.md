# VRA-090 交付审查记录：旧整改清零映射与发布前交接

## 1. 任务基本信息

- **批次编号**：VRA-090
- **优先级/类型**：P1 整合治理与交接
- **完成日期**：2026-09-06
- **前置依赖**：VRA-000～VRA-080 全部执行并通过
- **目标**：视觉对齐闭环，核销 VRA-000 的旧任务映射，确保视觉完成不掩盖未完工程、旧卡不重复开发覆盖新 UI，形成清晰唯一的发布前交接路线。

---

## 2. 旧任务映射逐项核销审查（对账 VRA-000 §4）

根据 [visual-alignment-baseline-manifest-2026-09-06.json](../plans/visual-alignment-baseline-manifest-2026-09-06.json) 与 [2026-09-06-vra-000-baseline-reconciliation.md](./2026-09-06-vra-000-baseline-reconciliation.md)，逐项核验结果如下：

| 旧任务 ID | 原始范围 | 承接批次 | 落实状态与最新证据 | 结论 |
| --- | --- | --- | --- | --- |
| **MM-085** | 一键整理（垂直树 + CSS 动画） | VRA-030 / VRA-060 | 算法由 VRA-030 重写为 DAG 汇聚分层（保留多父/跨层）；动画由 VRA-060 升级为 `MotionCoordinator` 800ms 连续插值与线形态演进；移除 CSS 延迟过渡。证据：`tests/visual/visual-alignment.test.ts`、`layer3-motion-*.png`。 | **已核销 (CLEARED)** |
| **MM-088** | 全局唤醒热键 (⌥Space) | MRT-008 / VRA-070 | VRA-070 在新外壳视图菜单中保留「快捷键设置 (⌥Space)」入口，连接既有 `GlobalShortcutPort`。原生五状态（前台/遮挡/他应用/IME/冲突）仍归 **MRT-008 owner**。 | **外壳已就绪；原生深度留存 MRT-008** |
| **MM-089** | 键盘操作完整性 | VRA-050 / VRA-070 | 快捷键定稿已全部映射至 `EditorCanvas` 与 `AppHeader`；键盘焦点导航、Enter 编辑、Esc 取消、IME 组合锁死保护通过。证据：`keyboard-flow.test.tsx`、`ime-editing.test.tsx`。 | **已核销 (CLEARED)** |
| **MM-090** | E2E 质量执行 | MRT-010 / VRA-080 | MM-090 既有断言保持绿灯；VRA-080 增设六层真实验收体系并接入唯一质量入口。 | **已核销 (CLEARED)** |
| **UXD-001** | 体验方向探索 | VRA-010 | 用户已确认暖白实心卡片、正交电路线、800ms 收束动效作为唯一审美基线。 | **已核销 (CLEARED)** |
| **UXI-001** | 极简 App Shell + 画布结构 | VRA-050 / VRA-070 | VRA-050 交付实心卡片与同源画布；VRA-070 交付 40px `AppHeader` 与悬浮 `AppNotice`。 | **已核销 (CLEARED)** |
| **UXI-002** | 状态补齐、动效、最终验收 | VRA-060 / 070 / 080 | 动效协调器、安全状态外壳与 6 层真实验收全部交付，生成全景与关键帧证据。 | **已核销 (CLEARED)** |
| **MRT-001..003V** | 保存队列/redo/dirty-close | 既有已完成 | 原生安全协议完全保留，`mindmap-app.tsx` 保持不变的端口调用次序。 | **保持有效，零破坏** |
| **MRT-004W2R2** | generation 线性化与 native 证据 | 原卡保留 | 生命周期负责人继续收尾；VRA 批次通过 G-NATIVE 解耦完成了安全接入。 | **保留原卡 owner** |
| **MRT-005** | 不可信文件、schema 校验 | VRA-020 + MRT-005 | Schema v2（眉题/强调/线型）与命令校验已在 VRA-020 完成（ADR 0010）；host 端 50MB 等由 **MRT-005 owner** 维护。 | **领域契约已核销；Host 留存 MRT-005** |
| **MRT-006** | 导出一致性与安全 | VRA-040 + MRT-006 | 视觉与几何一致性由 VRA-040/080 完全吸收（三格式真实样本已出）；字体资源上限与失败路径留存 **MRT-006 owner**。 | **视觉一致性已核销；资源上限留存 MRT-006** |
| **MRT-007** | 整理算法 + 偏好恢复 | VRA-030 + MRT-007 | 算法子项由 VRA-030 重写并通过；偏好损坏恢复留存 **MRT-007 owner**。 | **算法已核销；偏好恢复留存 MRT-007** |
| **MRT-008** | 热键/焦点状态机 | 原卡保留 | 消费接口已接入 VRA-050/070；事务式换绑留存 **MRT-008 owner**。 | **保留原卡 owner** |
| **MRT-009** | P0 样式编辑操作面 | VRA-050 / VRA-070 | 富文本 runs、眉题、色彩角色、线型、卡片形状、framesVisible 隐藏完全实现。 | **已核销 (CLEARED)** |
| **MRT-010** | 唯一质量门禁 | MRT-010 / VRA-080 | VRA-080 已将 `visual` stage 与 `test:visual` 真正接入 `run-all.mjs`；总门禁余项留存 **MRT-010 owner**。 | **视觉门禁已接入；总门禁留存 MRT-010** |
| **MRT-011** | Release 性能/包体 | 原卡保留 | 产物中 1.5MB JS chunk 与字体按需加载留存 **MRT-011 owner**。 | **保留原卡 owner** |
| **MRT-012 / G2** | 许可证、标识、安装打包 | 原卡保留 | 法律许可、代码签名与公开发布留存 **MRT-012 owner**。 | **保留原卡 owner (G2)** |

**核销结论**：VRA 批次承诺吸收的视觉、布局、动效、导出一致性与极简外壳等范围已全部完成并给出证据；未吸收项（系统热键换绑、偏好损坏恢复、包体体积优化、发布签名）均保留明确责任人，没有任何遗漏或范围悬空。

---

## 3. 架构与决策事实对齐

1. **架构文档更新**：
   - 新增 `docs/architecture/visual-motion-architecture.md`，精确记录四层依赖结构（`core` $\to$ `export` $\to$ `ui` $\to$ `desktop`）、Kahn DAG 布局原理、`MotionCoordinator` 800ms 动效插值机制与统一质量防线。
2. **ADR 状态核对**：
   - ADR 0001（Tauri 2 宿主）：Accepted
   - ADR 0002（React Flow 画布）：Accepted
   - ADR 0003（Core Schema/Session）：Accepted
   - ADR 0004（web-ts-wasm 导出）：Accepted
   - ADR 0005（Noto + LXGW 字体）：Accepted
   - ADR 0006（性能基线）：Accepted
   - ADR 0008（窗口启动与生命周期）：Accepted
   - ADR 0010（视觉样式 schema v2 与文件兼容）：Accepted
   - ADR 0007（商业许可与开源条款）：Proposed（留存 MRT-012/G2）

---

## 4. 质量总门禁接入核实

在根目录 `package.json` 与 `scripts/quality/run-all.mjs` 中：
- `test:visual` 命令已注册为 `node scripts/quality/run-visual-alignment.mjs`；
- `visual` 检查阶段已纳入 `run-all.mjs` 的 `SUITES.all` 和 `SUITES.integration`；
- 运行结果：
  - `pnpm typecheck`：PASS（0 错误）
  - `pnpm lint`：PASS（0 错误）
  - `pnpm test:unit`：PASS（37 个文件，381 项测试全绿）
  - `pnpm test:visual`：PASS（6 层自动化测试全部通过）
  - `pnpm test:export`：PASS（14 项 golden 通过）
  - `pnpm test:a11y`：PASS（9 项 a11y 测试通过）
  - `boundaries`：PASS（架构隔离与无循环依赖通过）
  - `pnpm build`：PASS（桌面端 1.39s 干净编译）

---

## 5. 发布前交接状态汇总（三方分流）

### 5.1 参考已达成 (Reference Achieved)
- **视觉还原度**：1080×864 内容区对齐参考设计，暖白与黑板双主题、纯色卡片、双层文案、圆角电路线与实心箭头。
- **自动规整**：DAG 多父汇聚分层算法，横向（默认）与纵向布局，无重叠、保序、二次整理 0 moves 幂等。
- **运动连贯**：800ms 连续动效协调器，三次缓动、叶子优先错峰归位、线形态 $0 \to 1$ 连续插值，无跳形，支持打断与 reduced-motion。
- **极简外壳**：40px AppHeader，折叠式文件/视图菜单，悬浮式非侵入通知，完整保全原生 3-way 关闭与保存安全协议。
- **三格式导出**：语义化 SVG、精确 2x PNG 与矢量 PDF，同源几何与排版。

### 5.2 工程未完项与归属 (Remaining Engineering Items with Owners)
- **MRT-008**（焦点与热键状态机）：全局热键换绑与原生跨应用失焦处理。
- **MRT-007**（偏好持久化）：桌面偏好损坏回退机制。
- **MRT-011**（Release 包体与加载优化）：1.5MB JS chunk 代码分割、中文字体按需子集化/动态加载。
- **MRT-012**（发布准备）：开源与字体商业许可审阅、Tauri 应用安装包构建、macOS 签名与公证。

### 5.3 需用户决策 (User Decisions Needed)
1. **G-FINAL 视觉终态签署**：用户在真实 macOS 设备上审阅当前编译运行的桌面应用（`pnpm --filter @mindmap/desktop tauri dev`），确认视觉与动效表现符合预期。
2. **G2 发布阶段授权**：批准进入 MRT-011/MRT-012 的包体优化与签名发布阶段。
