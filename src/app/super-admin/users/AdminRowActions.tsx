"use client";

/**
 * Row actions for the Admins table — edit (name / role / status / password)
 * and delete.
 *
 * The server enforces every rule; this component only mirrors them so the UI
 * doesn't offer an action that is going to come back as a 409. The "you" case
 * is hidden rather than disabled because a self-delete button is never the
 * thing an admin meant to click.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, Loader2 } from "lucide-react";

type Props = {
  id: string;
  name: string;
  role: string;
  status: string;
  isSelf: boolean;
  /** False when this is the only active Super Admin left — server blocks it too. */
  canRemove: boolean;
};

export function AdminRowActions({ id, name, role, status, isSelf, canRemove }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({ name, role, status, password: "" });

  async function save() {
    setBusy(true);
    setError(null);
    const body: Record<string, string> = {};
    if (form.name !== name) body.name = form.name;
    if (form.role !== role) body.role = form.role;
    if (form.status !== status) body.status = form.status;
    if (form.password) body.password = form.password;

    if (Object.keys(body).length === 0) {
      setOpen(false);
      setBusy(false);
      return;
    }
    const res = await fetch(`/api/super-admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({})))?.error ?? "Update failed.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  async function remove() {
    if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/super-admin/users/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      alert((await res.json().catch(() => ({})))?.error ?? "Delete failed.");
      return;
    }
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center justify-end gap-1">
        <button
          onClick={() => { setForm({ name, role, status, password: "" }); setError(null); setOpen(true); }}
          className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
          aria-label={`Edit ${name}`}
        >
          <Pencil className="size-4" />
        </button>
        {!isSelf && canRemove && (
          <button
            onClick={remove}
            disabled={busy}
            className="p-1.5 rounded hover:bg-rose-50 text-muted-foreground hover:text-rose-600 disabled:opacity-50"
            aria-label={`Delete ${name}`}
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="bg-card border rounded-lg shadow-lg w-full max-w-sm p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-semibold">Edit admin</h2>

            <label className="block text-sm">
              <span className="text-muted-foreground text-xs">Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1 w-full border rounded-md px-3 py-2 text-sm bg-background"
              />
            </label>

            <label className="block text-sm">
              <span className="text-muted-foreground text-xs">Role</span>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="mt-1 w-full border rounded-md px-3 py-2 text-sm bg-background"
              >
                <option value="platform_admin">Super Admin</option>
                <option value="platform_support">Admin</option>
              </select>
            </label>

            <label className="block text-sm">
              <span className="text-muted-foreground text-xs">Status</span>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="mt-1 w-full border rounded-md px-3 py-2 text-sm bg-background"
              >
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </label>

            <label className="block text-sm">
              <span className="text-muted-foreground text-xs">
                New password <span className="opacity-70">(leave blank to keep current)</span>
              </span>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                autoComplete="new-password"
                className="mt-1 w-full border rounded-md px-3 py-2 text-sm bg-background"
              />
            </label>

            {isSelf && (
              <p className="text-xs text-muted-foreground">
                This is your own account — you can rename it or change your password, but not
                suspend or demote it.
              </p>
            )}
            {error && <p className="text-xs text-rose-600">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="px-3 py-1.5 text-sm rounded-md border disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={busy}
                className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground font-medium flex items-center gap-1.5 disabled:opacity-50"
              >
                {busy && <Loader2 className="size-3.5 animate-spin" />} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
