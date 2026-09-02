"use client";

/**
 * Branded confirmation dialog — a custom replacement for window.confirm().
 * Controlled: the parent owns `open` and supplies onConfirm / onCancel.
 *
 *   const [open, setOpen] = useState(false);
 *   <ConfirmDialog open={open} title="Log out?" message="…"
 *      confirmLabel="Log out" tone="danger"
 *      onConfirm={doLogout} onCancel={() => setOpen(false)} />
 *
 * A11y: focuses Cancel on open (safe default), Escape cancels, and focus
 * returns to the previously-focused element on close.
 */

import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const danger = tone === "danger";
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      <DialogContent role="alertdialog" className="max-w-sm" showClose={false} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}>
        <div className="flex items-start gap-3">
          <div
            className={`size-10 rounded-lg grid place-items-center shrink-0 ${
              danger
                ? "bg-destructive/10 text-destructive"
                : "bg-brand-navy-light text-primary"
            }`}
          >
            <AlertTriangle className="size-5" />
          </div>
          <DialogHeader className="min-w-0 pr-0">
            <DialogTitle className="text-sm">{title}</DialogTitle>
            {message && <DialogDescription className="leading-relaxed">{message}</DialogDescription>}
          </DialogHeader>
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn-secondary text-sm disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            aria-live="polite"
            className={`text-sm rounded-lg px-3.5 py-2 font-medium transition-colors disabled:opacity-50 ${danger ? "bg-destructive text-destructive-foreground hover:opacity-90" : "bg-primary text-primary-foreground hover:opacity-90"}`}
          >
            {busy ? "Please wait…" : confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
