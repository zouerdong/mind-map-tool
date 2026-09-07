// 偏好 port（MM-060 步骤⑧）：主题/引导等应用偏好的读写。
// 偏好存放在 host 管理的独立文件（app config dir），绝不写入脑图文档
// （PRD/ADR 0003：文档无 onboarding/preferences 字段）。
// 值域 v1 限制为原始标量（theme、onboarding flags 等 MM-070 消费）。

export type PreferenceValue = string | number | boolean | null;
export type PreferencesSnapshot = Readonly<Record<string, PreferenceValue>>;

export interface PreferencesPort {
  /** 读取全部偏好；无存储时返回空对象（首启）。 */
  load(): Promise<PreferencesSnapshot>;
  /** 合并写入（delta 只覆盖出现的键；null 值删除键）。 */
  store(delta: PreferencesSnapshot): Promise<void>;
  /** 可选的一次性恢复提示；不参与偏好值语义。 */
  consumeWarning?(): string | null;
}
