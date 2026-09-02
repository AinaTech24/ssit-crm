/**
 * Offline write queue — field reality: RMs log calls in basements, lifts and
 * client offices with no signal. Before this, a write that hit a dead network
 * threw and the work was simply lost.
 *
 * Now: writes wrapped in `queuedPost` / `queuedPatch` are persisted to disk when
 * the network is down and replayed, in order, as soon as a request succeeds
 * again. Only explicit call-sites opt in — reads and auth must never be queued.
 *
 * Deliberately simple: FIFO, capped, at-least-once. A replayed write can in
 * principle duplicate if the original actually reached the server before the
 * connection dropped; that's the accepted trade for never losing a call log.
 */

import { create } from "zustand";
import { api, ApiError } from "../api/client";
import { storageGet, storageSet } from "./storage";
import { useConnectivity } from "../state/connectivity";
import { toast } from "./toast";

const KEY = "offline_queue_v1";
const MAX = 100;

export interface QueuedWrite {
  id: string;
  method: "POST" | "PATCH";
  path: string;
  body: unknown;
  /** Shown to the user, e.g. "Call log". */
  label: string;
  at: number;
}

interface QueueState {
  items: QueuedWrite[];
  flushing: boolean;
  hydrate: () => Promise<void>;
  enqueue: (w: Omit<QueuedWrite, "id" | "at">) => void;
  flush: () => Promise<void>;
  clear: () => Promise<void>;
}

const persist = (items: QueuedWrite[]) => { storageSet(KEY, JSON.stringify(items)).catch(() => {}); };
// No Math.random/Date collision worry — a counter plus timestamp is enough here.
let seq = 0;
const nextId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;

export const useOfflineQueue = create<QueueState>((set, get) => ({
  items: [],
  flushing: false,

  hydrate: async () => {
    try {
      const raw = await storageGet(KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) set({ items: parsed.filter((w: any) => w?.path && w?.method) });
    } catch {
      /* corrupt payload — start clean rather than crash the shell */
    }
  },

  enqueue: (w) => {
    const items = [...get().items, { ...w, id: nextId(), at: Date.now() }].slice(-MAX);
    set({ items });
    persist(items);
  },

  flush: async () => {
    if (get().flushing) return;
    const queued = get().items;
    if (queued.length === 0) return;
    set({ flushing: true });

    const remaining: QueuedWrite[] = [];
    let sent = 0;
    for (let i = 0; i < queued.length; i++) {
      const w = queued[i];
      try {
        if (w.method === "POST") await api.post(w.path, w.body);
        else await api.patch(w.path, w.body);
        sent++;
      } catch (e: any) {
        const err = e as ApiError;
        if (err?.kind === "network" || err?.kind === "timeout") {
          // Still offline — keep this and everything after it, order intact.
          remaining.push(...queued.slice(i));
          break;
        }
        // A real server rejection (400/403/409…) will never succeed on replay —
        // drop it rather than retry forever.
      }
    }

    set({ items: remaining, flushing: false });
    persist(remaining);
    if (sent > 0) toast.success(`Synced ${sent} offline ${sent === 1 ? "change" : "changes"}`);
  },

  clear: async () => { set({ items: [] }); await storageSet(KEY, "[]").catch(() => {}); },
}));

/** POST that survives a dead network. Returns null when it was queued. */
export async function queuedPost<T = any>(path: string, body: unknown, label: string): Promise<T | null> {
  try {
    return await api.post<T>(path, body);
  } catch (e: any) {
    if (e?.kind === "network" || e?.kind === "timeout") {
      useOfflineQueue.getState().enqueue({ method: "POST", path, body, label });
      toast.info(`${label} saved — will sync when you're back online`);
      return null;
    }
    throw e;
  }
}

/** PATCH that survives a dead network. Returns null when it was queued. */
export async function queuedPatch<T = any>(path: string, body: unknown, label: string): Promise<T | null> {
  try {
    return await api.patch<T>(path, body);
  } catch (e: any) {
    if (e?.kind === "network" || e?.kind === "timeout") {
      useOfflineQueue.getState().enqueue({ method: "PATCH", path, body, label });
      toast.info(`${label} saved — will sync when you're back online`);
      return null;
    }
    throw e;
  }
}

/** Flush whenever connectivity flips back on. Call once, near the app root. */
export function watchConnectivityAndFlush(): () => void {
  return useConnectivity.subscribe((state, prev) => {
    if (state.online && !prev.online) useOfflineQueue.getState().flush();
  });
}
