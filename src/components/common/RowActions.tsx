"use client";

/**
 * Reusable Edit / Delete actions menu for list rows.
 *
 *   <RowActions
 *      editHref="/dashboard/leads/<id>"
 *      deleteUrl="/api/leads/<id>"
 *      itemLabel="lead"
 *      itemName={lead.name}
 *   />
 *
 * Edit is a plain link to the detail/edit page. Delete posts a DELETE to the
 * resource URL after a branded ConfirmDialog (no native confirm()); success +
 * failure are surfaced via the toast system (no native alert()).
 *
 * Variants:
 *   - `permanent`: if true, says "Permanently delete" (for hard delete paths)
 *   - `verb`: override "Delete" label (e.g. "Archive", "Deactivate")
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MoreHorizontal, Pencil, Trash2, Loader2, type LucideIcon } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

export function RowActions({
  editHref,
  deleteUrl,
  itemLabel = "item",
  itemName,
  verb = "Delete",
  permanent = false,
  onDeleted,
  redirectTo,
  inline = false,
  deleteIcon: DeleteIcon = Trash2,
  items,
}: {
  editHref?: string;
  deleteUrl?: string;
  itemLabel?: string;
  itemName?: string;
  verb?: string;
  permanent?: boolean;
  onDeleted?: () => void;
  /** When set, navigate here after a successful delete (e.g. back to the list
   *  from a detail page) instead of refreshing the current — now gone — record. */
  redirectTo?: string;
  /** Render Edit + Delete as two side-by-side icon buttons instead of a "⋯" menu. */
  inline?: boolean;
  /** Icon for the destructive action in inline mode (e.g. Archive, Ban). Defaults to Trash2. */
  deleteIcon?: LucideIcon;
  /** Extra navigation entries shown at the top of the ⋯ menu (menu mode only). */
  items?: { label: string; href: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const subject = itemName ? `"${itemName}"` : itemLabel;
  const past = verb.endsWith("e") ? `${verb}d` : `${verb}ed`; // Delete→Deleted, Archive→Archived, Lock→Locked
  const confirmMessage = permanent
    ? `Permanently delete ${subject}? This cannot be undone.`
    : `${verb} ${subject}?`;

  async function doDelete() {
    if (!deleteUrl) return;
    setBusy(true);
    try {
      const res = await fetch(deleteUrl, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? `Request failed (HTTP ${res.status})`, `${verb} failed`);
        return;
      }
      toast.success(`${past} ${subject}`);
      onDeleted?.();
      setConfirmOpen(false);
      setOpen(false);
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", `${verb} failed`);
    } finally {
      setBusy(false);
    }
  }

  // Inline variant — two explicit icon buttons (no dropdown). The ConfirmDialog
  // still gates the delete; success/failure still go through the toast system.
  if (inline) {
    return (
      <div className="inline-flex items-center justify-end gap-1" data-no-row-nav>
        {editHref && (
          <Link
            href={editHref}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={`Edit ${itemLabel}`}
            title="Edit"
          >
            <Pencil className="size-4" />
          </Link>
        )}
        {deleteUrl && (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={busy}
            className="rounded-md p-1.5 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
            aria-label={`${verb} ${itemLabel}`}
            title={verb}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <DeleteIcon className="size-4" />}
          </button>
        )}
        <ConfirmDialog
          open={confirmOpen}
          title={`${verb} ${itemLabel}?`}
          message={confirmMessage}
          confirmLabel={verb}
          tone="danger"
          busy={busy}
          onConfirm={doDelete}
          onCancel={() => setConfirmOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="rounded-md p-1 hover:bg-accent text-muted-foreground hover:text-foreground"
        aria-label={`Actions for ${itemLabel}`}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-10 w-48 rounded-md border bg-popover shadow-md py-1 text-sm">
          {items?.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent"
              onMouseDown={(e) => e.preventDefault()}
            >
              {it.label}
            </Link>
          ))}
          {items && items.length > 0 && (editHref || deleteUrl) && <div className="my-1 border-t border-border" />}
          {editHref && (
            <Link
              href={editHref}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent"
              onMouseDown={(e) => e.preventDefault()}
            >
              <Pencil className="size-3.5" /> Edit
            </Link>
          )}
          {deleteUrl && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false);
                setConfirmOpen(true);
              }}
              disabled={busy}
              className="w-full text-left flex items-center gap-2 px-3 py-1.5 hover:bg-rose-50 text-rose-700 disabled:opacity-50"
            >
              <Trash2 className="size-3.5" /> {verb}
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`${verb} ${itemLabel}?`}
        message={confirmMessage}
        confirmLabel={verb}
        tone="danger"
        busy={busy}
        onConfirm={doDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
