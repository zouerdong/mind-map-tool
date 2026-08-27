// PreferencesPort 的 Tauri 实现（MM-060）：invoke host 命令，错误映射。

import { invoke } from "@tauri-apps/api/core";
import { IPC_COMMANDS } from "../ipc/types.js";
import { toPlatformError } from "../file/errors.js";
import type { PreferencesPort, PreferencesSnapshot } from "./types.js";

export class TauriPreferencesAdapter implements PreferencesPort {
  async load(): Promise<PreferencesSnapshot> {
    try {
      return await invoke<PreferencesSnapshot>(IPC_COMMANDS.loadPreferences);
    } catch (raw) {
      throw toPlatformError(raw);
    }
  }

  async store(delta: PreferencesSnapshot): Promise<void> {
    try {
      await invoke(IPC_COMMANDS.storePreferences, { delta });
    } catch (raw) {
      throw toPlatformError(raw);
    }
  }
}
