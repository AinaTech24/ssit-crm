/**
 * Recently-viewed store — the last clients/leads the user opened, for quick
 * re-access from Home. Most-recent first, de-duped, capped at 8.
 *
 * Persisted, deliberately: an RM reopens the app between meetings, and a
 * session-scoped rail would be empty at exactly the moment it's most useful.
 * Client names are PII, so this rides the same secure storage as the token
 * (keychain on native) rather than plain async storage, and is cleared on
 * sign-out along with the session.
 */

import { create } from "zustand";
import { storageGet, storageSet, storageDelete } from "../lib/storage";

const KEY = "recently_viewed_v1";

export interface RecentItem {
  type: "investor" | "lead";
  id: string;
  name: string;
  at: number;
}

interface RecentState {
  items: RecentItem[];
  add: (item: Omit<RecentItem, "at">) => void;
  hydrate: () => Promise<void>;
  clear: () => Promise<void>;
}

// Fire-and-forget: the rail is a convenience, never worth blocking a tap or
// surfacing an error for.
const persist = (items: RecentItem[]) => {
  storageSet(KEY, JSON.stringify(items)).catch(() => {});
};

export const useRecentlyViewed = create<RecentState>((set) => ({
  items: [],
  add: (item) => set((s) => {
    if (!item.id || !item.name) return s;
    const rest = s.items.filter((r) => !(r.type === item.type && r.id === item.id));
    const items = [{ ...item, at: Date.now() }, ...rest].slice(0, 8);
    persist(items);
    return { items };
  }),
  hydrate: async () => {
    try {
      const raw = await storageGet(KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      // Re-validate: stored shape can outlive a schema change.
      const items = parsed
        .filter((r: any) => r && typeof r.id === "string" && typeof r.name === "string" && (r.type === "investor" || r.type === "lead"))
        .map((r: any) => ({ type: r.type, id: r.id, name: r.name, at: Number(r.at) || 0 }))
        .slice(0, 8);
      set({ items });
    } catch {
      /* corrupt payload — start empty rather than crash the shell */
    }
  },
  clear: async () => {
    set({ items: [] });
    await storageDelete(KEY).catch(() => {});
  },
}));
