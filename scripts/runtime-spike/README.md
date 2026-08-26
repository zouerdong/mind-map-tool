# Runtime Spike Harness（MM-010）

> 用途：桌面 host、画布视图、导出 renderer、字体四轨的双平台评估 harness。
> 红线（G0 批准范围）：本目录是候选依赖唯一允许存在的地方；不发布、不改 CI/CD、不访问凭据、不签名/公证；产物输出到 `.tmp/runtime-spike/**`（可再生，不入库）。
> 假设：本 harness 是一次性实验代码，正式产品代码零复用假设。

## 结构

```text
scripts/runtime-spike/
├── README.md              # 本文件
├── package.json           # harness 依赖（实验性，非产品依赖）
├── tsconfig.json
├── fixtures/
│   └── generate-fixtures.mjs   # 确定性合成文档夹具（seeded，无随机漂移）
├── export/                # exportRenderer 轨：scene/SVG/PNG/PDF 候选与测量
├── canvas/                # canvasView 轨：React Flow vs 自研视图 + 性能/IME/a11y
├── fonts/                 # font 轨：候选许可/覆盖/包体评估
├── hosts/                 # desktopHost 轨：Electron / Tauri 最小应用
├── verify-decision.mjs    # fail-closed 决策登记验证器（三 profile）
├── run-macos.sh           # macOS 侧全轨执行入口
└── run-windows.ps1        # Windows 侧全轨执行入口
```

## 命令

```bash
# 安装 harness 依赖（仅本目录，不改全局）
npm install

# 生成夹具
node fixtures/generate-fixtures.mjs

# 各轨（详见各目录内说明）
node export/measure-export.mjs          # 导出轨测量
node fonts/evaluate-fonts.mjs           # 字体轨评估
node canvas/measure-canvas.mjs          # 画布轨测量（需先 build 两个 spike app）
node hosts/electron-spike/measure.mjs   # Electron host 测量

# 决策验证（spike-result profile；G1 正常 pending 时也应通过）
node verify-decision.mjs --phase spike-result \
  ../docs/quality/runtime-spike-decision.json \
  --sha256-sidecar ../docs/quality/runtime-spike-decision.sha256
```

## 夹具清单（与测试规格 §3.1 对齐）

| 夹具 | 用途 |
| --- | --- |
| `empty-document` | 空文档错误路径 |
| `two-linked-nodes` | 基础边界 |
| `negative-coordinates` | 负坐标与 content bounds |
| `chinese-multiline` | 中文/英文/标点/换行/XML 特殊字符 |
| `dark-theme` | 黑板主题对比 |
| `dense-300-450` | 300 节点/450 连接性能 |
| `large-bounds` | 极宽画布尺寸上限 |
| `missing-glyph` | 缺 glyph 合成码点 |

所有夹具由固定 seed 生成，跨机器 bytes 一致；输出到 `.tmp/runtime-spike/fixtures/`。

## 环境记录

每次测量必须记录：机型、OS build、CPU、内存、WebView/浏览器版本、构建类型、脚本版本。结果写入 `docs/quality/runtime-spike-results.md` 与聚合 `docs/quality/runtime-spike-decision.json`（冻结后计算 SHA-256 sidecar，不回写自哈希）。
