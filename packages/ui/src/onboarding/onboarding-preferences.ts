// 引导偏好 port（MM-070 ②）：引导状态只存本机偏好（PRD §7.3），
// 绝不进脑图文档。存储形状与 MM-060 PreferencesPort 一致（标量 map），
// MM-080 注入真实实现（TauriPreferencesAdapter）即可；本文件的内存实现
// 供测试与接线前使用。
// 键：`onboardingStatus`（"completed"/"skipped"/"in-progress"）。

import type { OnboardingStatus } from "./onboarding-types.js";

/** 标量偏好存取（结构对齐 @mindmap/platform PreferencesPort）。 */
export interface PreferenceStore {
  load(): Promise<Readonly<Record<string, string | number | boolean | null>>>;
  store(delta: Readonly<Record<string, string | number | boolean | null>>): Promise<void>;
  consumeWarning?(): string | null;
}

export const ONBOARDING_STATUS_KEY = "onboardingStatus";

export interface OnboardingPreferencesPort {
  load(): Promise<OnboardingStatus>;
  /** completed/skipped/in-progress 时持久化（not-started 不写）。 */
  store(status: OnboardingStatus): Promise<void>;
  consumeWarning?(): string | null;
}

export function createOnboardingPreferences(store: PreferenceStore): OnboardingPreferencesPort {
  return {
    async load() {
      const all = await store.load();
      const v = all[ONBOARDING_STATUS_KEY];
      if (v === "completed" || v === "skipped" || v === "in-progress") return v;
      return "not-started";
    },
    async store(status) {
      if (status === "not-started") return;
      await store.store({ [ONBOARDING_STATUS_KEY]: status });
    },
    ...(store.consumeWarning ? { consumeWarning: () => store.consumeWarning!() } : {}),
  };
}

/** 内存实现（测试 / MM-080 接线前的默认）。 */
export class InMemoryPreferenceStore implements PreferenceStore {
  constructor(private data: Record<string, string | number | boolean | null> = {}) {}
  async load() {
    return { ...this.data };
  }
  async store(delta: Readonly<Record<string, string | number | boolean | null>>) {
    for (const [k, v] of Object.entries(delta)) {
      if (v === null) delete this.data[k];
      else this.data[k] = v;
    }
  }
  snapshot(): Readonly<Record<string, string | number | boolean | null>> {
    return { ...this.data };
  }
}
