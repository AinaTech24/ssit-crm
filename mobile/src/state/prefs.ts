/**
 * Device preferences — per-phone, per-user settings that aren't firm config.
 * Persisted locally (not on the server) because they describe how THIS person
 * wants the app to behave on THIS device.
 */

import { create } from "zustand";
import { storageGet, storageSet } from "../lib/storage";

const KEY = "device_prefs_v1";

export interface Prefs {
  /**
   * Log calls automatically instead of asking. When on, returning to the app
   * after a call places the log immediately (duration ≈ time away), so nothing
   * is ever lost to a dismissed prompt. Notes can be added afterwards from the
   * call's detail screen.
   */
  autoLogCalls: boolean;
  /** Outcome recorded by an auto-log, since we can't detect it. */
  autoLogOutcome: string;
}

const DEFAULTS: Prefs = { autoLogCalls: false, autoLogOutcome: "answered" };

interface PrefsState extends Prefs {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  set: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
}

export const usePrefs = create<PrefsState>((set, get) => ({
  ...DEFAULTS,
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await storageGet(KEY);
      if (raw) {
        const p = JSON.parse(raw);
        set({
          autoLogCalls: typeof p?.autoLogCalls === "boolean" ? p.autoLogCalls : DEFAULTS.autoLogCalls,
          autoLogOutcome: typeof p?.autoLogOutcome === "string" ? p.autoLogOutcome : DEFAULTS.autoLogOutcome,
        });
      }
    } catch {
      /* corrupt payload — fall back to defaults rather than crash the shell */
    } finally {
      set({ hydrated: true });
    }
  },

  set: (key, value) => {
    set({ [key]: value } as any);
    const { autoLogCalls, autoLogOutcome } = get();
    storageSet(KEY, JSON.stringify({ autoLogCalls, autoLogOutcome, [key]: value })).catch(() => {});
  },
}));
