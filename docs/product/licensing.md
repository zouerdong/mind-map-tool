# 许可与产品身份决策（PRC-050 / G2 批准）

状态：**G2 APPROVED (LOCAL PACKAGING SCOPE ONLY)**。
本文记录项目负责人已批准的 v1 产品身份、许可证方向及 G2 候选构建范围。

## 产品身份已批准清单

| 决策项 | 批准值 | 说明 |
| --- | --- | --- |
| 产品显示名 | `Mind Map` | 菜单栏、窗口标题、安装包命名完全一致 |
| Bundle Identifier | `com.mindmap.desktop` | 统一反向域名标识 |
| 版本与构建号 | `0.1.0` (build 1) | package.json / Cargo.toml / tauri.conf.json 一致 |
| 目标系统与架构 | macOS 11.0+ (Apple Silicon: aarch64-apple-darwin) | Windows 顺延至后续专门版本（非 v1 blocker） |
| 文件关联 | `.mindmap` | JSON 结构；MIME: `application/x-mindmap+json`；UTI: `com.mindmap.document` |
| 应用图标 | `apps/desktop/src-tauri/icons/icon.png` | 512x512 PNG，随 Tauri bundle 生成 icns |
| 软件许可 | Source-available 双重许可 (ADR 0007) | 终端用户自由免费使用；转售闭源包装需商业许可 |
| 候选格式 | Unsigned `.app` 与 `.dmg` | 严格禁止签名与公证 |

## 随应用分发的字体

字体来源、版本、用途和许可证记录在 [`assets/fonts/README.md`](../../assets/fonts/README.md)。
当前受控资源为 Noto Sans SC Regular/Bold 与 LXGW WenKai Regular，均按仓库记录以
SIL Open Font License 1.1 管理，并随 `assets/fonts/OFL-1.1.txt` 保留许可证文本。

字体资源不得脱离应用单独出售；如果未来重新子集化或修改字体，必须重新核对
Reserved Font Name、来源和许可证义务，不能仅沿用当前记录。

## 依赖审计

工程筛查通过 `pnpm license:scan` 自动执行，全部 29 项直接 JS 依赖与 487 项 Cargo 依赖均属于 MIT / Apache-2.0 / MPL-2.0 / OFL-1.1 许可，无未解释 copyleft。

```text
node scripts/quality/scan-dependency-licenses.mjs --output .tmp/quality/license-scan.json
```

## G2 批准范围 (Approved Scope)

- **selectedHost**: `tauri`
- **candidateOutputPaths**:
  - `apps/desktop/src-tauri/target/release/bundle/macos/Mind Map.app`
  - `apps/desktop/src-tauri/target/release/bundle/dmg/Mind Map_0.1.0_aarch64.dmg`
- **evidenceOutputPaths**:
  - `.tmp/release-candidate`
- **installationTargets**:
  - `.tmp/release-candidate/installed/Mind Map.app`
- **allowedActions**:
  - `build`
  - `launch`
  - `install`
  - `uninstall`
  - `measure-performance`
  - `permission-probe`
- **deletionBoundaries**:
  - `.tmp/release-candidate`
  - `apps/desktop/src-tauri/target/release/bundle`
- **explicitlyExcluded**:
  - `test-signing`
  - `signing`
  - `notarization`
  - `credential access`
  - `system trust changes`
  - `upload`
  - `publication`

签名、公证、凭据访问、系统信任修改、上传和公开发布始终需要另行明确授权。
