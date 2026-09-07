# MM-090 人工矩阵（macOS）

依据 v1-test-spec §7 人工验收脚本与 §4 跨平台矩阵。WebView 自动化无法
可靠覆盖的系统级行为在此执行并记录，不以 mock 冒充（R-010）。
执行人：项目负责人（未参与实现的最终验收视角）；每项记录期望/实际/
Pass-Fail/截图或日志路径/日期。构建 ID 填 commit hash + 构建类型。

## 前置

- [ ] 构建与版本：commit `____`，`tauri build --debug` bundle，macOS `____`（arm64 `____`）
- [ ] 断网环境（AC-13 离线语义）

## 矩阵

1. **冷启动空白画布**（AC-01；自动化补充=launch-router 测试）：全新偏好状态（首次安装或清空 `~/Library/Application Support/com.mindmap.desktop/` 前先备份）启动 → 直接空白画布，无登录/模板页。
2. **引导完成/跳过/重放**（AC-09；自动化=E2E-08）：真机完成五步引导、跳过、菜单重放各一次；reduced-motion 开关各验一次。
3. **8 节点中文编辑全链**（AC-02/03；自动化=E2E-02/03/04）：创建 ≥8 个中英文节点、连接、移动、多选、删除、undo/redo；**真实 IME**（拼音/双拼）组合期间快捷键不误触。
4. **主题状态检查**（AC-05；自动化=E2E-05）：白/黑板切换；normal/hover/selected/focused/editing 五状态视觉检查。
5. **保存与打开路径**（AC-06/07）：保存到含中文与空格路径 → Finder 双击打开；符号链接/大小写等价路径验证同文件 identity（不覆盖确认）。
6. **多文件与 activation**（AC-01/07）：booting 与已运行两态下连续打开多文件/同文件；图标/Dock 激活新空白窗；dirty 窗不被替换。
7. **关闭三分支**（AC-06；含 native dirty-close 拦截缺口验证）：修改后关闭 → save/cancel/discard 逐一验证；discard 后再冷启动不恢复。
8. **导出核对**（AC-10/11；自动化=export golden）：SVG/2x PNG/PDF 在 ≥2 个独立查看器打开与画布核对；locale/timezone/DPI 变化后 hash 复验；空文档/极大画布错误提示。
9. **文件安全负向**（AC-08；自动化=platform file-safety 套件）：损坏文件、未来版本、只读目录；保存期间外部修改；authorization 伪造/重放负向（由 file-safety 套件自动覆盖，人工抽查错误提示可理解性）。
10. **（G2 后，MM-100 范围）**unsigned candidate 安装/卸载/文件关联——本卡不执行，仅在索引中标注归属。
11. **性能复跑**（AC-12）：`node scripts/quality/run-performance.mjs` 结果附于聚合报告（自动化），人工观察大画布交互流畅性。

## ⌥Space 前台截获验证（键位定稿 2026-08-29 新增，归本矩阵）

- [ ] 应用聚焦时按 ⌥Space → 视口中心出现新节点并自动进入编辑（quick-create 生效）
- [ ] 应用被遮挡/失焦时按 ⌥Space → 画布前置聚焦，**不**新建节点；再按一次才建
- [ ] 其他应用前台时按 ⌥Space → 画布唤起（show+focus）
- [ ] 编辑中文（IME 组合）期间按 ⌥Space → 不误触（quick-create 在编辑态被忽略）
- [ ] 其他应用占用 ⌥Space 时（如安装 Raycast）→ 启动日志出现注册失败提示，应用不崩，可经「热键…」换绑

## 记录

| # | 期望 | 实际 | Pass/Fail | 证据（截图/日志） | 日期 |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

## Windows

根据 PRD §1.1 与 G1 范围变更，Windows 原生验收顺延至后续专门版本（deferred），不属于本次 v1 验收范围；Windows 状态如实记录为 deferred/not-run，不阻断 v1 发布。
macOS Apple Silicon 原生证据构成 ADR 0001 / ADR 0006 G1 批准的完整验收基础。
