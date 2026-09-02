"use client";

/**
 * Custom toaster — branded, top-center, with success / error / warning / info
 * variants and a dismiss (X) button on every toast. Replaces ad-hoc inline
 * error banners and any reliance on the browser's alert().
 *
 * Usage:
 *   const toast = useToast();
 *   toast.success("Task updated");
 *   toast.error("Could not save", "Save failed");
 *
 * The <ToastProvider> is mounted once in the dashboard layout, wrapping the
 * whole shell, so any client component below can call useToast().
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";

type ToastType = "success" | "error" | "warning" | "info";
type ToastItem = { id: number; type: ToastType; message: string; title?: string };

type PushArgs = { type?: ToastType; message: string; title?: string; duration?: number };

export type ToastApi = {
  toast: (t: PushArgs) => void;
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  warning: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
  dismiss: (id: number) => void;
};

const ToastCtx = createContext<ToastApi | null>(null);

const NOOP: ToastApi = {
  toast() {},
  success() {},
  error() {},
  warning() {},
  info() {},
  dismiss() {},
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((p) => p.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: PushArgs) => {
      const id = ++counter.current;
      const type = t.type ?? "info";
      setItems((p) => [...p.slice(-4), { id, type, message: t.message, title: t.title }]);
      const duration = t.duration ?? (type === "error" ? 7000 : type === "warning" ? 5500 : 4000);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
    },
    [dismiss]
  );

  // Memoised so the context value is a STABLE reference across renders. Without
  // this, every pushed toast re-rendered the provider → a fresh `api` object →
  // any consumer whose effect deps include `toast` (e.g. a load-on-mount that
  // also toasts on error) would re-run, re-fetch, re-toast… an infinite loop.
  const api: ToastApi = useMemo(
    () => ({
      toast: push,
      success: (message, title) => push({ type: "success", message, title }),
      error: (message, title) => push({ type: "error", message, title }),
      warning: (message, title) => push({ type: "warning", message, title }),
      info: (message, title) => push({ type: "info", message, title }),
      dismiss,
    }),
    [push, dismiss]
  );

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 w-[min(92vw,26rem)] pointer-events-none print:hidden">
        {items.map((t) => (
          <ToastCard key={t.id} item={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Safe in any client component — falls back to a no-op if no provider mounted. */
export function useToast(): ToastApi {
  return useContext(ToastCtx) ?? NOOP;
}

const META: Record<
  ToastType,
  { icon: any; ring: string; bg: string; text: string; iconC: string }
> = {
  success: { icon: CheckCircle2, ring: "border-success/25", bg: "bg-success/10", text: "text-success-foreground", iconC: "text-success" },
  error: { icon: XCircle, ring: "border-destructive/25", bg: "bg-destructive/10", text: "text-destructive", iconC: "text-destructive" },
  warning: { icon: AlertTriangle, ring: "border-warning/25", bg: "bg-warning/10", text: "text-warning-foreground", iconC: "text-warning-foreground" },
  info: { icon: Info, ring: "border-info/25", bg: "bg-info/10", text: "text-info-foreground", iconC: "text-info" },
};

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const m = META[item.type];
  const Icon = m.icon;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto w-full rounded-xl border ${m.ring} ${m.bg} shadow-lg px-3.5 py-2.5 flex items-start gap-2.5 animate-scale-in`}
    >
      <Icon className={`size-5 ${m.iconC} mt-0.5 shrink-0`} />
      <div className="min-w-0 flex-1">
        {item.title && <div className={`text-sm font-semibold ${m.text}`}>{item.title}</div>}
        <div className={`text-xs ${m.text} ${item.title ? "mt-0.5 opacity-90" : "font-medium"} break-words`}>
          {item.message}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        className={`${m.iconC} hover:opacity-70 shrink-0 -mr-0.5`}
        aria-label="Dismiss"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
