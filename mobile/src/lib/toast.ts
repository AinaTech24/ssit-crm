/**
 * Toast — lightweight global snackbar. Call `toast.success(msg)` /
 * `toast.error(msg)` / `toast.info(msg)` from anywhere (React or not). A single
 * <ToastHost/> mounted at the app root renders + auto-dismisses them.
 */

import { create } from "zustand";

export type ToastTone = "success" | "danger" | "info";
export interface ToastItem { id: number; message: string; tone: ToastTone }

interface ToastState {
  items: ToastItem[];
  push: (message: string, tone: ToastTone) => void;
  dismiss: (id: number) => void;
}

let seq = 1;

export const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (message, tone) => set((s) => {
    // Collapse duplicate back-to-back messages.
    if (s.items.some((t) => t.message === message)) return s;
    return { items: [...s.items, { id: seq++, message, tone }].slice(-3) };
  }),
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (m: string) => useToastStore.getState().push(m, "success"),
  error: (m: string) => useToastStore.getState().push(m, "danger"),
  info: (m: string) => useToastStore.getState().push(m, "info"),
};
