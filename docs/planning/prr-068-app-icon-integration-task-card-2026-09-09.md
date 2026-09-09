# PRR-068：应用图标生产集成与原生验证

日期：2026-09-09  
类型：产品视觉资产 / Tauri 打包集成 / 原生验证  
优先级：P0  
状态：`READY_FOR_DISPATCH`  
前置：PRR-067 已完成并通过独立审阅；负责人选定的 C 方案已完成矢量母版与尺寸检查；PRR-070 继续保持阻塞

## 派发文本

将本卡整张交给 Coding Agent，并附上下面一句：

```text
只执行 PRR-068。必须从包含本任务卡、图标规格和 SVG 母版的当前 clean HEAD 开始。把固定母版确定性生成并集成到 Tauri 桌面图标集，增加 fail-closed 校验，构建一个仅供本卡验证的 unsigned .app 并完成 Finder/应用包/小尺寸检查。不得重新设计图形，不得修改 PRR-067 性能协议、runner、预算或发布证据；不得开始 PRR-070、申请 G-FINAL、执行 PRR-080、签名、公证、push、上传或公开发布。完成后形成一个 clean commit，按交回格式停止等待独立审阅。
```

## 固定输入

- 权威母版：`assets/app-icon/source/mind-map-app-icon.svg`
- 母版 SHA-256：`01c7ad41cefbe8f75439bc6ddab48e51fb81b8026f2e923132a411385d11b72e`
- 产品规格：`docs/product/app-icon-spec-2026-09-09.md`
- 视觉审阅导出：`assets/app-icon/exports/`
- 旧占位图标：`apps/desktop/src-tauri/icons/icon.png`（纯蓝色，只可作为待替换对象，不可继续进入候选）

母版结构、节点数量、几何比例和颜色已经由负责人选定。PRR-068 是生产集成，不是新一轮设计探索。

## 目标

1. 从唯一 SVG 母版确定性生成 macOS 所需的 PNG/ICNS，并保留 Windows 后续移植需要的 ICO；不得手工逐尺寸重画。
2. 让 `tauri.conf.json` 明确引用正确的桌面图标集合，彻底替换当前纯蓝占位图。
3. 建立快速、fail-closed 的图标校验，防止母版漂移、占位图回归、尺寸/透明通道错误、配置引用缺失或生成物过期。
4. 构建并检查一个本卡专属 unsigned `.app`，证明 Finder、应用包和最小尺寸使用的都是新图标。
5. 形成新的 clean source commit，供独立审阅；审阅通过后才可重新派发 PRR-070。

## 允许范围

- `apps/desktop/src-tauri/icons/`：替换旧 `icon.png`，新增桌面平台实际需要的 `32x32.png`、`64x64.png`、`128x128.png`、`128x128@2x.png`、`icon.icns`、`icon.ico`。
- `apps/desktop/src-tauri/tauri.conf.json`：只允许更新 `bundle.icon` 列表；不得改其他生产配置。
- `scripts/quality/` 与对应测试：新增图标资产校验及最小测试。
- `package.json`：只允许增加一个明确命名的图标校验命令；不得新增依赖。
- 本卡及规划状态文档：记录实施与验证结果。
- 临时生成和证据只写 `.tmp/prr-068-*`。本卡明确授权覆盖旧纯蓝占位 `apps/desktop/src-tauri/icons/icon.png`；不授权删除其他 tracked 文件。

## 实施要求

### 1. 冻结基线与红灯

- 开始时记录完整 `git rev-parse HEAD`、`git status --short`、Node/pnpm/Rust/Tauri CLI 版本。
- 独立复算母版 hash，必须与固定输入一致；不一致立即停止。
- 先让校验在现有纯蓝占位图上失败，至少覆盖：母版 hash 漂移、PNG 尺寸错误、缺 alpha、旧占位 hash、配置引用缺文件、ICNS/ICO 缺失或零字节。

### 2. 确定性生成

- 使用项目已锁定的本地 `@tauri-apps/cli`，不得安装全局工具或新依赖。
- 先生成到全新的 `.tmp/prr-068-icon-generation/`：

```bash
pnpm --filter @mindmap/desktop tauri icon ../../assets/app-icon/source/mind-map-app-icon.svg --output ../../.tmp/prr-068-icon-generation
```

- 只把桌面交付集合复制到 `apps/desktop/src-tauri/icons/`：`32x32.png`、`64x64.png`、`128x128.png`、`128x128@2x.png`、`icon.png`、`icon.icns`、`icon.ico`。不得提交生成器顺带产生的 iOS、Android、Appx/StoreLogo 文件。
- 已知本地 Tauri CLI 两次生成的 PNG/ICO 字节一致，但 raw ICNS 可能只因内部 chunk 顺序不同而得到不同容器 hash；本卡预检已证明 `iconutil` 解出的 10 个命名槽位逐字节一致。不要把该顺序噪声误判为图像漂移，也不要接受不可复现的容器。
- 在生成脚本中用 Node 标准库严格解析 ICNS（校验 `icns` header、总长度、每个 chunk 长度与边界），按四字节 chunk type、再按 chunk bytes 排序后重写容器；只允许重排完整 chunk，不得重编码图片或删除槽位。规范化结果必须仍可由 `iconutil` 解包。本卡预检的规范化容器为 `307255B`，两轮 SHA-256 均为 `7146e7c8788a982c31a8e8455e785b1bbd78783e2498b592b3cc1fd39ce684cc`；实施时须从 clean base 独立复算，不可直接抄作通过证据。
- 保存生成器版本、母版 hash、输出相对路径/尺寸/bytes/SHA-256 到 tracked manifest；manifest 不得写绝对用户路径或不稳定时间戳。
- 第二次从同一 clean 输入生成到另一个全新临时目录，对规范化后的完整桌面集合逐文件比较 SHA-256；任何不一致都要停止并报告，不能把 nondeterminism 写进 manifest。

### 3. 配置与自动校验

- `bundle.icon` 明确列出桌面集合；macOS 必须包含 `icon.icns`，Windows 后续移植入口必须包含 `icon.ico`。
- 新增 `pnpm icon:verify`（名称可等价但必须清楚），仅使用现有依赖或 Node 标准库，并验证：
  - 母版 hash 与批准值一致；
  - tracked manifest 的每个规范化输出 hash、bytes、PNG IHDR 尺寸一致；ICNS parser 对损坏 header、错误总长度、越界/过短 chunk 必须 fail-closed；
  - PNG 为方形、尺寸正确并带 alpha；
  - 旧纯蓝占位 hash 不得出现；
  - `tauri.conf.json` 的每个 icon 路径存在，且必需的 ICNS/ICO 被引用；
  - 不允许 mobile/Appx 派生物进入 tracked desktop icon 目录。
- 校验必须对篡改、缺文件、错误尺寸和配置漏项 fail-closed，并有相称的正反测试。

### 4. 原生构建与视觉验证

- 运行 `pnpm format:check`、`pnpm typecheck`、`pnpm lint`、相关 unit/integration 测试、`pnpm icon:verify`、`pnpm build`、`cargo fmt --check`、`cargo test --locked`、`cargo clippy --all-targets --locked -- -D warnings`。
- 构建本卡专属 unsigned app（例如 `pnpm --filter @mindmap/desktop tauri build --bundles app`）；它是 PRR-068 诊断产物，不得写入或冒充 PRR-070 release evidence。
- 验证 `.app/Contents/Resources` 中实际存在 ICNS，`Info.plist` 的图标声明可解析；用 `iconutil` 解包检查至少 16/32/128/256/512/1024 等槽位。
- 保存白底和深/中性底的 `16 / 32 / 64 / 128 / 256 / 512 / 1024px` contact sheet；检查透明角、直线辨识度、中心点与六端点无裁切。
- 在 Finder 或 Quick Look 中检查一次构建出的 `.app` 图标；若启动应用检查 Dock，仅可从项目内本卡临时候选启动，不安装到 `/Applications`，不改变默认文件关联。

## 完成标准

- 旧纯蓝占位图不再被任何 Tauri 配置或 app bundle 使用。
- SVG 母版是唯一可编辑源；所有平台文件可由锁定工具复现且二次生成 hash 一致。
- 自动校验和正反测试通过；完整源码门无回归。
- unsigned `.app` 的 Info.plist、Resources/ICNS 与视觉检查都证明新图标生效。
- 证据仅位于 `.tmp/prr-068-*`，列出完整命令、exit code、hash 与截图路径。
- 一个本地 clean commit；`git status --short` 为 0 行。

## STOP

- 固定母版 hash 不一致，或需要改结构、节点数量、颜色家族、直线方向与比例。
- 16px/32px 无法读出中心点与放射连接，必须修改母版才能解决。
- 生成结果无法在两次独立目录中得到一致 hash。
- 需要新增依赖、全局安装、修改系统配置、写 `/Applications`、修改默认文件关联、签名、公证、访问凭据、push、上传或公开发布。
- 需要改性能协议、runner、预算、release evidence schema 或任何 PRR-067/070 验收口径。
- 构建后发现除图标外还需要生产代码修复；先交回，不得夹带。

## 交回格式

```text
Task: PRR-068
Status: COMPLETE / BLOCKED / FAILED
Base: <完整 clean HEAD>
Source: <SVG path + SHA-256 + 固定规格>
Generation: <命令/CLI version/两轮目录/逐文件一致性>
Changed: <逐文件>
Verification: <命令/exit code/测试数>
NativeCheck: <app path/Info.plist/ICNS slots/Finder或Quick Look/尺寸结论>
Evidence: <仅 .tmp/prr-068-* 路径 + SHA-256>
NotRun: <项目与原因>
Risks: <剩余风险>
Redlines: <确认未执行>
Next: STOP_FOR_INDEPENDENT_REVIEW
```
