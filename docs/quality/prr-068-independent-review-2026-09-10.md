# PRR-068 应用图标集成独立审阅

日期：2026-09-10  
结论：`ACCEPT / COMPLETE`  
实现提交：`26e1beadbc3980c46f6d6174c78228e52c9d7842`  
审阅修复提交：`51bff869735bfeee4af3561df9c720287cf23bef`

## 结论

PRR-068 已完成。所选 C 方案的 SVG 母版未漂移，Tauri 桌面 7 件图标可由锁定 CLI 确定性生成，ICNS 规范化有效，`tauri.conf.json` 使用完整新图标集合，重建的 unsigned `.app` 在 Finder 中显示新图标且包内 ICNS 与仓库逐字节一致。没有剩余 P0/P1/P2 问题。

审阅发现的验证器路径边界、完整引用集合和稳定错误诊断缺口均属局部问题，已直接修复并增加红灯；PRR-070 源码门也已显式加入 `pnpm icon:verify`。PRR-070 可从包含本报告与状态同步的下一 clean HEAD 开始，但不得复用任何历史候选或 PRR-068 诊断产物。

## 审阅范围

- 实现 diff：`1f7fbc14ad6c56820a9c8c17b7b70065f3ad3d8c..26e1beadbc3980c46f6d6174c78228e52c9d7842`
- 审阅修复：`26e1beadbc3980c46f6d6174c78228e52c9d7842..51bff869735bfeee4af3561df9c720287cf23bef`
- 固定母版：`assets/app-icon/source/mind-map-app-icon.svg`
- 生产图标：`apps/desktop/src-tauri/icons/`
- 生成、manifest、校验与测试：`scripts/quality/generate-icons.mjs`、`icon-baseline.mjs`、`icon-utils.mjs`、`verify-icons.mjs`、`tests/bootstrap/verify-icons.test.ts`
- 原始交回证据：`.tmp/prr-068-app-icon/`
- 独立生成目录：`.tmp/prr-068-review-a.85o0ni/`、`.tmp/prr-068-review-b.AkTFFV/`
- 独立原生检查：`.tmp/prr-068-independent-review/51bff869735bfeee4af3561df9c720287cf23bef/`

## 审阅发现与已完成修复

### P2：配置可指向受管目录外的同名文件

原验证器只检查配置引用存在且 basename 在 manifest 中，因此 `external/icon.png` 这类目录外同名文件可能通过，实际 bundle 却不一定消费受管输出；同时只强制 ICNS/ICO，未要求完整 7 件集合。

已修复：配置引用现在必须逐项解析到受管 `icons/` 目录内的精确文件，完整集合不可缺项且不可重复；新增“缺任一 PNG”和“目录外同名文件”红灯。

### P3：icons 子目录触发未捕获读取异常

原扫描先报告意外目录，随后仍把目录当文件读取 hash，可能抛出未捕获异常，失去稳定诊断。

已修复：使用 `lstat` 限定普通文件，目录、符号链接或不可读条目稳定进入错误列表；新增 mobile 子目录红灯。

### P3：发布源码门未显式消费图标校验

PRR-068 建立了 `pnpm icon:verify`，但原 PRR-070 源码门清单尚未加入该命令。

已修复：根 README 登记标准命令，PRR-070 步骤 2 明确复算母版、桌面 7 件、manifest 与 Tauri 引用。

### P3：状态行使 diff check 失败

实现提交在任务卡状态行新增了行尾空格，范围 diff 的 `git diff --check` 返回非零。

已修复：移除该行尾空格；`1f7fbc1..51bff86` 范围复算通过。

## 确定性与二进制复算

- 母版 SHA-256：`01c7ad41cefbe8f75439bc6ddab48e51fb81b8026f2e923132a411385d11b72e`，与批准值一致。
- 在两个全新目录中独立执行生成器；规范化后的 7 个输出逐文件 SHA-256 完全一致。
- 两轮 manifest 仅生成命令的临时输出目录不同；规范化该字段后 JSON 语义完全一致，均登记 7 个输出。
- ICNS 为 307255 bytes，SHA-256 `7146e7c8788a982c31a8e8455e785b1bbd78783e2498b592b3cc1fd39ce684cc`；严格 parser、规范排序与 `iconutil` 解包均通过。
- PNG/ICO、manifest 与配置引用均由 `pnpm icon:verify` 复算通过；旧纯蓝占位 hash 不存在。

## 原生与视觉复核

从 clean `51bff869735bfeee4af3561df9c720287cf23bef` 独立执行 `pnpm --filter @mindmap/desktop tauri build --bundles app`，exit 0：

- `Info.plist`：`CFBundleIconFile=icon.icns`、bundle id `com.mindmap.desktop`、版本 `0.1.0`。
- app 内 `Contents/Resources/icon.icns` 与仓库 ICNS SHA-256 相同且 `cmp` 逐字节一致。
- `iconutil` 解出 10 个命名 PNG 槽位，覆盖 16、32、64、128、256、512、1024px；全部方形且带 alpha。
- `codesign -dv` 显示 `Signature=adhoc`、`TeamIdentifier=not set`；没有 Developer ID 签名或公证。
- Finder 图标视图直接显示新深靛蓝、白中心、六条蓝紫粉直射线图标，不再显示纯蓝占位。
- 白底/深底 contact sheet 与 Quick Look ICNS 预览均保持所选 C 方案的身份、结构、颜色和比例；无裁切、边缘泄漏、人物轮廓、曲线或额外装饰。
- 16px 下两条紫色射线为亚像素弱化，但中心原点与放射关系仍可识别，且与批准的 16px 审阅导出一致；32px 起六条射线完整可辨。这不是集成回归。

## 独立验证结果

| 验证 | 结果 |
| --- | --- |
| `pnpm icon:verify` | PASS |
| 图标黑盒测试 | 24/24 PASS（实施为 21 项，审阅新增 3 项） |
| `pnpm test:unit` | 53 files、558/558 PASS |
| `pnpm test:integration` | 14 files、94/94 PASS；boundaries PASS |
| `pnpm format:check` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm build` | PASS |
| `cargo fmt --check` | PASS |
| `cargo test --locked` | 210/210 PASS |
| `cargo clippy --all-targets --locked -- -D warnings` | PASS |
| `git diff --check` | PASS |
| clean source 原生 app rebuild | PASS |

## 剩余风险与后继边界

1. 新 ICNS 为约 307KB，而旧 PRR-070 DMG 距 25MB 上限只剩约 449KB；不能由 app-only 构建推断新 DMG 一定通过。PRR-070 必须从新 source 构建唯一 DMG 并重新实测体积，超限即按 STOP 返回。
2. `.app` 的自动 `qlmanage` 在未注册 bundle 场景曾超时；独立 Finder 图标视图、包内 ICNS 字节一致与 ICNS Quick Look 均已通过。受控安装、LaunchServices 与 DMG 中 Finder 表现仍由 PRR-070 完整矩阵验证。
3. Windows 不是 v0.1.0 required platform；ICO 已生成和校验，但未做 Windows 真机验证。
4. 本轮没有签名、公证、上传、push、公开发布或系统信任修改；PRR-070/G-FINAL/PRR-080 均未执行。

## 下一步

从包含本报告和状态同步的 clean HEAD 派发既有 PRR-070，严格从步骤 1 完整重做。首先运行新增的 `pnpm icon:verify`，之后构建唯一 unsigned `.app`/`.dmg`；任何 source、runner、配置或 tracked 文档变化都作废该候选并停止。
