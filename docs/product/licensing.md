# 许可与产品身份记录（PRC-050 记录 / PRR 补正）

状态：**G2 APPROVED (LOCAL PACKAGING SCOPE ONLY)**。
G2 已由项目负责人 ErDong Zou 于 2026-09-08 批准（原始 `[from-user]` 批准语句、精确范围与排除动作见 `docs/decisions/decision-register.json` 的 G2 evidence；`verify-decision --phase packaging` 复算通过）。PRC 批次曾因占位批准人与缺失原文被降级为 RECORDED，该缺口已由 PRR-000 关闭。

## 产品身份已批准清单

| 决策项 | 批准值 | 说明 |
| --- | --- | --- |
| 产品显示名 | `Mind Map` | 菜单栏、窗口标题、安装包命名完全一致 |
| Bundle Identifier | `com.mindmap.desktop` | 统一反向域名标识 |
| 版本与构建号 | `0.1.0` (build 1) | package.json / Cargo.toml / tauri.conf.json 一致 |
| 目标系统与架构 | macOS 11.0+ (Apple Silicon: aarch64-apple-darwin) + Windows x64 (x86_64-pc-windows-msvc) | Windows 于 2026-09-17 进入首发（ADR 0017，含降级阀门）；Intel Mac / ARM Windows 不承诺 |
| 文件关联 | `.mindmap` | JSON 结构；MIME: `application/x-mindmap+json`；UTI: `com.mindmap.document`（macOS）；Windows 由 NSIS 安装器写注册表 |
| 应用图标 | `apps/desktop/src-tauri/icons/icon.png` | 512x512 PNG，随 Tauri bundle 生成 icns/ico |
| 软件许可 | **MIT License**（ADR 0016，2026-09-17；取代 ADR 0007 专有许可） | 根 `LICENSE`（© 2026 ErDong Zou）；完全开源免费发布 |
| 候选格式 | Unsigned `.app` / `.dmg`（macOS）与 unsigned NSIS `.exe`（Windows） | 严格禁止签名与公证；SmartScreen/Gatekeeper 绕过说明入 release notes |

## 随应用分发的字体

字体来源、版本、用途和许可证记录在 [`assets/fonts/README.md`](../../assets/fonts/README.md)。
当前受控资源为 Noto Sans SC Regular/Bold 与 LXGW WenKai Regular，均按仓库记录以
SIL Open Font License 1.1 管理，并随 `assets/fonts/OFL-1.1.txt` 保留许可证文本。

字体资源不得脱离应用单独出售；如果未来重新子集化或修改字体，必须重新核对
Reserved Font Name、来源和许可证义务，不能仅沿用当前记录。

## 依赖审计

工程筛查覆盖直接 JS、传递 JS 与全部 Cargo package（口径以 `pnpm license:scan` 输出为准）；当前枚举范围内没有未知或禁用的依赖许可。根 `LICENSE` 与 `THIRD_PARTY_NOTICES.md` 已按 ADR 0007 Accepted 方案 4 生成；scanner 会校验 notices 覆盖每个随包 package 与字体，缺条目或陈旧条目均 fail-closed。`THIRD_PARTY_NOTICES.md` 是生成文件，依赖或字体集合变化后必须重跑生成脚本。

```text
node scripts/quality/generate-third-party-notices.mjs
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
  - `launchservices-registration`
  - `dependency-advisory-scan`
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
  - `git push`

签名、公证、凭据访问、系统信任修改、上传和公开发布始终需要另行明确授权。
