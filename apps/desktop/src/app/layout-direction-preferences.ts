// 整理方向偏好（ADR 0019 v1.1.0 ③）：应用级记忆上次使用的整理方向。
// 方向是「整理命令的调用偏好」而非文档内容——整理结果坐标已落盘，
// 方向本身不进文档（ADR 0003：偏好绝不写入脑图文档）。
// 存储形状对齐 MM-060 PreferencesPort 标量 map；键 `layoutDirection`。

import type { OrganizeDirection } from "@mindmap/core";
import type { PreferenceStore } from "@mindmap/ui";

export const LAYOUT_DIRECTION_KEY = "layoutDirection";

/** v1.1.0 起默认方向：发散（横向/纵向保留可选）。 */
export const DEFAULT_ORGANIZE_DIRECTION: OrganizeDirection = "balanced";

/** 解析持久化值；非法/缺失返回 null（调用方回退默认）。 */
export function parseLayoutDirection(value: unknown): OrganizeDirection | null {
  return value === "horizontal" || value === "vertical" || value === "balanced" ? value : null;
}

/** 读取上次方向；无记录或非法值返回 null；读取失败向上抛（调用方容错）。 */
export async function loadLayoutDirection(
  store: PreferenceStore,
): Promise<OrganizeDirection | null> {
  const all = await store.load();
  return parseLayoutDirection(all[LAYOUT_DIRECTION_KEY]);
}

/** 持久化方向选择。 */
export async function storeLayoutDirection(
  store: PreferenceStore,
  direction: OrganizeDirection,
): Promise<void> {
  await store.store({ [LAYOUT_DIRECTION_KEY]: direction });
}
