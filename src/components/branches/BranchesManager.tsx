"use client";

/**
 * Branches manager — list + add / edit / delete the tenant's branch offices.
 * Talks to /api/branches (collection) and /api/branches/[id] (item). On every
 * successful mutation it router.refresh()es so the server page re-renders.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, X, Building2 } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";

type BranchAddress = {
  line1?: string;
  city?: string;
  state?: string;
  pincode?: string;
} | null;

type BranchRow = {
  id: string;
  name: string;
  code: string;
  address: BranchAddress;
  phone: string | null;
  email: string | null;
  headUserId: string | null;
  isHq: string | null;
};

type UserLite = { id: string; name: string };

type FormState = {
  name: string;
  code: string;
  headUserId: string;
  phone: string;
  email: string;
  line1: string;
  city: string;
  state: string;
  pincode: string;
  isHq: boolean;
};

const emptyForm: FormState = {
  name: "",
  code: "",
  headUserId: "",
  phone: "",
  email: "",
  line1: "",
  city: "",
  state: "",
  pincode: "",
  isHq: false,
};

function toForm(b: BranchRow): FormState {
  return {
    name: b.name ?? "",
    code: b.code ?? "",
    headUserId: b.headUserId ?? "",
    phone: b.phone ?? "",
    email: b.email ?? "",
    line1: b.address?.line1 ?? "",
    city: b.address?.city ?? "",
    state: b.address?.state ?? "",
    pincode: b.address?.pincode ?? "",
    isHq: b.isHq === "true",
  };
}

export function BranchesManager({
  branches,
  users,
}: {
  branches: BranchRow[];
  users: UserLite[];
}) {
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BranchRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);

  const userName = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) m.set(u.id, u.name);
    return m;
  }, [users]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (b: BranchRow) => {
    setEditing(b);
    setForm(toForm(b));
    setOpen(true);
  };

  const close = () => {
    if (busy) return;
    setOpen(false);
    setEditing(null);
  };

  const save = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      toast.error("Name and code are required.", "Missing fields");
      return;
    }
    setBusy(true);
    const address = {
      line1: form.line1.trim() || undefined,
      city: form.city.trim() || undefined,
      state: form.state.trim() || undefined,
      pincode: form.pincode.trim() || undefined,
    };
    const hasAddress = Object.values(address).some(Boolean);
    const payload = {
      name: form.name.trim(),
      code: form.code.trim(),
      headUserId: form.headUserId || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || "",
      address: hasAddress ? address : null,
      isHq: form.isHq,
    };
    try {
      const res = await fetch(
        editing ? `/api/branches/${editing.id}` : "/api/branches",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Could not save the branch.");
      }
      toast.success(editing ? "Branch updated." : "Branch added.", "Saved");
      setOpen(false);
      setEditing(null);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message || "Could not save the branch.", "Failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (b: BranchRow) => {
    if (
      !window.confirm(
        `Delete branch "${b.name}"? This can't be undone.`
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/branches/${b.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Could not delete the branch.");
      }
      toast.success("Branch deleted.", "Deleted");
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message || "Could not delete the branch.", "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card-surface p-0 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Building2 className="size-4" />
          {branches.length} office{branches.length === 1 ? "" : "s"}
        </div>
        <button type="button" onClick={openAdd} className="btn-primary">
          <Plus className="size-4" /> Add branch
        </button>
      </div>

      {branches.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">
          No branches yet. Add your first office.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Head</th>
                <th className="px-4 py-2 font-medium">Contact</th>
                <th className="px-4 py-2 font-medium">City</th>
                <th className="px-4 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {branches.map((b) => (
                <tr key={b.id} className="align-top">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{b.name}</span>
                      {b.isHq === "true" && (
                        <span className="chip bg-violet-50 text-violet-700 text-[10px]">
                          HQ
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                    {b.code}
                  </td>
                  <td className="px-4 py-2.5">
                    {b.headUserId ? (
                      userName.get(b.headUserId) ?? (
                        <span className="text-muted-foreground">—</span>
                      )
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {b.phone && <div>{b.phone}</div>}
                    {b.email && (
                      <div className="text-muted-foreground">{b.email}</div>
                    )}
                    {!b.phone && !b.email && (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {b.address?.city || (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(b)}
                        className="text-muted-foreground hover:text-brand-cyan-deep"
                        aria-label="Edit branch"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => remove(b)}
                        className="text-muted-foreground hover:text-rose-600 disabled:opacity-50"
                        aria-label="Delete branch"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40"
          onMouseDown={close}
        >
          <div
            className="h-full w-full max-w-md overflow-y-auto bg-background shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">
                {editing ? "Edit branch" : "Add branch"}
              </h2>
              <button
                type="button"
                onClick={close}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-3 p-4">
              <Field label="Name" required>
                <input
                  className="input-base"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="e.g. Andheri Branch"
                />
              </Field>
              <Field label="Code" required>
                <input
                  className="input-base"
                  value={form.code}
                  onChange={(e) => set("code", e.target.value)}
                  placeholder="e.g. AND01"
                />
              </Field>
              <Field label="Branch head">
                <SelectField
                  className="w-full"
                  value={form.headUserId}
                  onChange={(e) => set("headUserId", e.target.value)}
                >
                  <option value="">— none —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </SelectField>
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Phone">
                  <input
                    className="input-base"
                    value={form.phone}
                    onChange={(e) => set("phone", e.target.value)}
                    placeholder="Phone"
                  />
                </Field>
                <Field label="Email">
                  <input
                    className="input-base"
                    type="email"
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                    placeholder="branch@firm.in"
                  />
                </Field>
              </div>

              <Field label="Address line">
                <input
                  className="input-base"
                  value={form.line1}
                  onChange={(e) => set("line1", e.target.value)}
                  placeholder="Street / building"
                />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="City">
                  <input
                    className="input-base"
                    value={form.city}
                    onChange={(e) => set("city", e.target.value)}
                  />
                </Field>
                <Field label="State">
                  <input
                    className="input-base"
                    value={form.state}
                    onChange={(e) => set("state", e.target.value)}
                  />
                </Field>
                <Field label="Pincode">
                  <input
                    className="input-base"
                    value={form.pincode}
                    onChange={(e) => set("pincode", e.target.value)}
                  />
                </Field>
              </div>

              <label className="flex items-center gap-2 text-sm pt-1">
                <input
                  type="checkbox"
                  checked={form.isHq}
                  onChange={(e) => set("isHq", e.target.checked)}
                  className="size-4 rounded border-border"
                />
                This is the HQ / registered office
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="btn-ghost"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={busy}
                className="btn-primary"
              >
                {busy ? "Saving…" : editing ? "Save changes" : "Add branch"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">
        {label}
        {required && <span className="text-rose-600"> *</span>}
      </label>
      {children}
    </div>
  );
}
