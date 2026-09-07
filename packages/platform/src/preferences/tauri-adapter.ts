// PreferencesPort 的 Tauri 实现（MM-060）：invoke host 命令，错误映射。

import { invoke } from "@tauri-apps/api/core";
import { IPC_COMMANDS } from "../ipc/types.js";
import { toPlatformError } from "../file/errors.js";
import type { PreferencesPort, PreferencesSnapshot } from "./types.js";

export class TauriPreferencesAdapter implements PreferencesPort {
  private warning: string | null = null;

  async load(): Promise<PreferencesSnapshot> {
    try {
      return await invoke<PreferencesSnapshot>(IPC_COMMANDS.loadPreferences);
    } catch (raw) {
      const error = toPlatformError(raw);
      if (error.code === "PREFERENCES_CORRUPT") {
        this.warning = "本机偏好文件损坏，已回退默认设置；下次保存时会自动修复。";
        return {};
      }
      throw error;
    }
  }

  async store(delta: PreferencesSnapshot): Promise<void> {
    try {
      await invoke(IPC_COMMANDS.storePreferences, { delta });
    } catch (raw) {
      throw toPlatformError(raw);
    }
  }

  consumeWarning(): string | null {
    const warning = this.warning;
    this.warning = null;
    return warning;
  }
}
