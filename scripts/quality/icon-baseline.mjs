// icon-baseline.mjs — PRR-068 图标基线常量（单一事实源）。
// 被 verify-icons / generate-icons / 测试共同引用；变更须经任务卡与批准流程，不得随手改。

/** 权威母版：assets/app-icon/source/mind-map-app-icon.svg（PRR-068 任务卡固定输入）。 */
export const MASTER_SVG_REL = "assets/app-icon/source/mind-map-app-icon.svg";

/** 母版批准 SHA-256（任务卡固定输入，实施时已独立复算一致）。 */
export const EXPECTED_MASTER_SHA256 =
  "01c7ad41cefbe8f75439bc6ddab48e51fb81b8026f2e923132a411385d11b72e";

/** 旧纯蓝占位图标实测 SHA-256（集成前 apps/desktop/src-tauri/icons/icon.png）。 */
export const LEGACY_PLACEHOLDER_SHA256 =
  "8bcf350362516f983e05a6e34c0f7917351b444ca7d76889bbf4861cb9051b27";

/** 桌面交付集合（不得向 icons/ 目录混入移动/Store 派生物）。 */
export const ICON_FILE_NAMES = [
  "32x32.png",
  "64x64.png",
  "128x128.png",
  "128x128@2x.png",
  "icon.png",
  "icon.icns",
  "icon.ico",
];

export const DEFAULT_MANIFEST_NAME = "icon-set-manifest.json";
export const MANIFEST_SCHEMA_VERSION = 1;

/** tracked manifest 相对配置（tauri.conf.json）目录的路径，供 tauri.conf.json 引用校验使用。 */
export const ICONS_DIR_REL = "apps/desktop/src-tauri/icons";
export const TAURI_CONFIG_REL = "apps/desktop/src-tauri/tauri.conf.json";
