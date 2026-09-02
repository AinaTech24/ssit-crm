/**
 * Session store (Zustand). The single source of truth for "are we logged in".
 * Holds the JWT, persists it in the device keychain, and exposes signIn/signOut.
 *
 * Importable outside React (`useSession.getState()`) so the API client can read
 * the token and force a sign-out on an unrecoverable 401 without prop-drilling.
 */

import { create } from "zustand";
import { storageGet, storageSet, storageDelete } from "../lib/storage";
import { TOKEN_KEY, PUSH_TOKEN_KEY } from "../config";
import { refreshToken, unregisterDevice } from "../api";
import { useRecentlyViewed } from "./recentlyViewed";

type Status = "loading" | "authed" | "guest";

interface SessionState {
  token: string | null;
  status: Status;
  /** Cold-start: read keychain, refresh once; sets status. Call from root layout. */
  hydrate: () => Promise<void>;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Swap in a freshly-refreshed token (called by the API client interceptor). */
  setToken: (token: string) => Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  token: null,
  status: "loading",

  hydrate: async () => {
    try {
      const saved = await storageGet(TOKEN_KEY);
      if (!saved) return set({ status: "guest", token: null });
      const fresh = await refreshToken(saved);
      if (fresh) {
        await storageSet(TOKEN_KEY, fresh);
        set({ token: fresh, status: "authed" });
      } else {
        await storageDelete(TOKEN_KEY);
        set({ token: null, status: "guest" });
      }
    } catch {
      set({ token: null, status: "guest" });
    }
  },

  signIn: async (token) => {
    await storageSet(TOKEN_KEY, token);
    set({ token, status: "authed" });
  },

  setToken: async (token) => {
    await storageSet(TOKEN_KEY, token);
    set({ token });
  },

  signOut: async () => {
    try {
      const [sessionToken, pushToken] = await Promise.all([
        storageGet(TOKEN_KEY),
        storageGet(PUSH_TOKEN_KEY),
      ]);
      if (sessionToken && pushToken) await unregisterDevice(sessionToken, pushToken);
    } catch {
      /* best-effort */
    }
    await storageDelete(PUSH_TOKEN_KEY);
    await storageDelete(TOKEN_KEY);
    // Client names cached for the Home rail are PII — they must not outlive the
    // session (or greet the next user to sign in on this device).
    await useRecentlyViewed.getState().clear();
    set({ token: null, status: "guest" });
  },
}));
