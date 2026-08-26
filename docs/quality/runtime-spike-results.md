# MM-010 双平台 Spike 结果

> 状态：**macOS 腿已完成（Apple M4 / 24 GB / macOS 26.6.2 (25G83) / arm64）；Windows 腿 BLOCKED——项目负责人确认当前无 Windows 设备（R-013）**。双平台聚合结论与 recommendation-ready 状态因此保持 BLOCKED，本文数据仅供 G1 讨论参考，不构成四轨推荐。
> Harness：`scripts/runtime-spike/**`（node v26.7.0 / rustc 1.98.0 / Chrome headless via Playwright）。
> 生成时间：2026-08-26。

## 1. 汇总表（macOS 实测）

| 指标 | Tauri 2 | Electron 33 | 预算（PRD §9 建议） |
| --- | ---: | ---: | ---: |
| 冷启动 p50（5 次，renderer-ready） | **362 ms** | **296 ms** | ≤ 1500 ms（双双 PASS） |
| 热启动（5 次分布） | 305–380 ms | 274–296 ms | ≤ 800 ms（双双 PASS） |
| RSS 稳定 p50 | **112 MB**（主进程；WKWebView WebContent 为系统 XPC 进程未计入，约 +36 MB） | **139 MB**（全进程树） | ≤ 120 MB（两者均在预算边缘） |
| 磁盘占用 | **8 MB** release 二进制（.app 打包后 MM-100 实测） | **233 MB** Electron.app 框架 | Tauri ≤ 25 MB ✓ |
| native 导出 | resvg PNG **21 ms** / 89.7 KB | printToPDF **323 ms** | — |

关键解读：Tauri 的优势在**分发体积**（8 MB vs 233 MB，约 29 倍差距）；启动与内存两者同级且都远优于预算（Electron 冷启动反而略快）。RSS 预算 120 MB 对两个方案都偏紧，最终判定应以真实产品页面（而非占位页）在 MM-090 重测为准。

画布轨（Chrome headless，dense-300-450，production build）：

| 候选 | bundle | pan p95 | nodeDrag p95 | zoom p95 |
| --- | ---: | ---: | ---: | ---: |
| React Flow 12 | 372 KB | 17.9 ms | 16.7 ms | 16.7 ms |
| 自研 SVG 视图 | 193 KB | 17.4 ms | 16.7 ms | 16.7 ms |

预算 300/450 帧时间 ≤ 32 ms：**两候选均 PASS**（headless Chrome 口径）。

## 2. desktopHost 轨（macOS）

- **Tauri 2**：release 二进制冷启动 379 ms p50（首次含磁盘冷缓存 1.4 s，后续 305–380 ms）；native resvg 导出可用；文件事件（Opened/Reopen）与 single-instance 插件已验证编译进 spike。`cargo build --release` 成功（46.7 s 增量）。
- **Electron 33**：数据见 electron-metrics.json（冷启动/RSS/框架体积/native printToPDF）。
- 两者均未测：Finder 文件关联（需打包应用 + UTI 注册）、IME、系统 DPI 矩阵——属 MM-060/MM-090 范围，已记录为 gap。
- **Windows 腿全部未测**（无设备）：WebView2 bootstrap、argv 冷启动路径、MSI/NSIS 打包。

## 3. canvasView 轨

- React Flow（`@xyflow/react` 12.6）：交互完整（拖拽/框选/缩放/连线内建）、300/450 性能达标、attribution 默认显示（MIT；隐藏决定属 G1 用户确认）。bundle +179 KB vs 自研。
- 自研最小 SVG 视图：同等帧率、体积减半；但当前只有 pan/zoom/单选拖动，**框选/多选/连线/键盘导航/命中测试未实现**（这些是 React Flow 免费提供而自研需重建的部分）。
- IME/焦点/a11y：headless 无法真实测 IME——记录为双平台人工矩阵项。两候选的 DOM a11y 探针数据见 canvas-metrics.json probes 字段。
- projection 隔离：两个 spike 应用均为纯投影实现（fixture → view model），core 未依赖画布库。

## 4. exportRenderer 轨（macOS）

TS/WASM 腿（`@resvg/resvg-wasm` 2.6 + `pdf-lib` 1.17 + `@pdf-lib/fontkit`）：

- **canonical SVG**：全部 8 个夹具 bytes 确定性 ✓；TZ=UTC/Asia-Shanghai、LANG=C/zh_CN 下 hash 不变 ✓；空文档返回 `EXPORT_EMPTY_DOCUMENT` ✓；无 `foreignObject`（序列化器不生成）✓。
- **2x PNG**：8 个夹具中 7 个通过（尺寸精确 ×2 ✓、bytes 确定性 ✓）；`large-bounds` 正确前置拒绝 `EXPORT_SIZE_LIMIT`（80000×32000 = 2.56e9 px 超过 1.2e8 px 预算）✓。中文渲染经像素级验证（节点内 2961 个文字笔画像素）。
- **PDF**：全部夹具生成 ✓、bytes 确定性 ✓（注意：pdf-lib 必须每文档重新 embedFont，跨文档复用内嵌对象会破坏确定性——已在 harness 修复并记录）；Noto CFF-OTF 内嵌成功（需 `registerFontkit(@pdf-lib/fontkit)`）。
- 发现并修复的坑：① pdf-lib 需显式注册 fontkit 实例；② resvg-wasm 必须传 `fontBuffers`（字节），`fontFiles` 路径仅 native 版支持；③ resvg-wasm 输出无背景时 alpha 透明（背景由 scene `<rect>` 提供，已确认）。

native 腿：

- Tauri/Rust resvg 0.45：chinese-multiline 2x PNG 46 ms / 89.7 KB ✓（与 WASM 版同源库，输出 hash 见各自 metrics）。
- Electron printToPDF：见 electron-metrics.json（native PDF 对照）。
- native PDF（Tauri/Rust 路线）：not-tested——需要额外 Rust PDF 栈（如 krilla），若 G1 选 native-host 再评估。

## 5. font 轨（macOS）

| 候选 | 许可 | 体积 | 语料覆盖 | 缺字行为 |
| --- | --- | ---: | ---: | --- |
| **Noto Sans SC Regular（SubsetOTF）** | SIL OFL 1.1 | 7.9 MB | 100%（398 字符语料） | PUA 正确缺失（3/3） |
| LXGW WenKai（霞鹜文楷）Regular | SIL OFL 1.1 | 23.6 MB | 100% | PUA 部分映射（记录在案） |
| Source Han Sans SC | SIL OFL 1.1 | — | 与 Noto SC 同源设计（subset 分发路径 404，未重复测） | — |
| MiSans | Xiaomi 自有许可（非 OFL） | 217 MB（全字重 zip） | 未测（fontkit 无法直接读 zip；且再分发条款需人工审阅） | — |

结论：**Noto Sans SC 为 PASS 候选**（OFL、可再分发/嵌入、体积最小、覆盖完整）；LXGW WenKai 为风格化备选（手写感，体积 3 倍）——最终选择属 G1/视觉方向决定。Windows WebView2 下字体行为待 Windows 腿。

## 6. 与预算对照（macOS 口径）

| 预算项 | 目标 | macOS 实测 | 判定 |
| --- | ---: | ---: | --- |
| 300/450 帧时间 p95 | ≤ 32 ms | React Flow 17.9 / 自研 17.4 | PASS（headless 口径） |
| 热启动 | ≤ 800 ms | Tauri ~380 ms（Electron 见 json） | Tauri PASS |
| 冷启动 | ≤ 1500 ms | Tauri 1.4 s（首次）/ 379 ms（p50） | PASS |
| 导出 2x PNG（标准规模） | ≤ 3 s | WASM dense-300-450（8900×4240）见 metrics / native 46 ms（小夹具） | 见 metrics |
| 空窗 RSS | ≤ 120 MB | 见两份 host metrics | 待汇总 |

## 7. 未测项与 Windows 腿缺口

1. **Windows 全平台数据缺失（无设备，R-013 BLOCKED）**：WebView2 bootstrap、argv/single-instance、IME、DPI 100/150/200、MSI/NSIS、大小写/等价路径。
2. 20 次启动 P95 协议、30 s 稳定 RSS 采样未执行（本次为 5 次中位数 + 8 s 稳定窗）——MM-090 补全。
3. IME 组合输入（中文）真实行为——需双平台人工矩阵。
4. Finder/Explorer 文件关联与 UTI/ProgID——需打包应用（MM-100 前置）。
5. native PDF（Rust 路线）与 SVG 查看器容差矩阵。

## 8. 机器可读登记

聚合登记：`docs/quality/runtime-spike-decision.json`（冻结后 SHA-256 写入 `runtime-spike-decision.sha256`，不回写自哈希）。四轨在 Windows 报告补齐前全部保持 `blocked`；本文件仅为证据索引，不改变登记状态。
