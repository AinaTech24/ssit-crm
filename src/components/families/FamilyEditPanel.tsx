"use client";

/**
 * Inline edit panel for the Family detail page.
 *
 * Edits the family-level fields: name, primary client (dropdown of members),
 * RM (dropdown of users), review dates, notes. Member CRUD lives in the
 * AddMemberDialog / RemoveMemberButton — out of scope here.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Save, X, Loader2 } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { DatePicker } from "@/components/ui/DatePicker";

export function FamilyEditPanel({
  family,
  members,
  rms,
}: {
  family: any;
  members: Array<{ id: string; name: string; pan: string }>;
  rms: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const initial = () => ({
    familyName: family.familyName ?? family.headName ?? "",
    headName: family.headName ?? "",
    primaryInvestorId: family.primaryInvestorId ?? "",
    rmId: family.rmId ?? "",
    lastReviewAt: family.lastReviewAt ? toDateInput(family.lastReviewAt) : "",
    nextReviewAt: family.nextReviewAt ? toDateInput(family.nextReviewAt) : "",
    notes: family.notes ?? "",
  });

  const [form, setForm] = useState(initial);

  function set(k: keyof ReturnType<typeof initial>, v: string) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const payload: any = {
        familyName: form.familyName,
        headName: form.headName || form.familyName,
        primaryInvestorId: form.primaryInvestorId || null,
        rmId: form.rmId || null,
        notes: form.notes || undefined,
      };
      if (form.lastReviewAt) payload.lastReviewAt = new Date(form.lastReviewAt).toISOString();
      if (form.nextReviewAt) payload.nextReviewAt = new Date(form.nextReviewAt).toISOString();

      const res = await fetch(`/api/families/${family.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setForm(initial());
    setEditing(false);
    setErr(null);
  }

  if (!editing) {
    return (
      <div className="flex justify-end">
        <button
          onClick={() => setEditing(true)}
          className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-accent"
        >
          <Pencil className="size-3.5" /> Edit family
        </button>
      </div>
    );
  }

  return (
    <div className="border rounded-lg bg-card p-5 space-y-3">
      <div className="flex items-center justify-between border-b pb-3">
        <h2 className="font-semibold">Edit family</h2>
        <div className="flex gap-2">
          <button
            onClick={cancel}
            disabled={busy}
            className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-accent disabled:opacity-50"
          >
            <X className="size-3.5" /> Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {err && (
        <div className="border border-rose-300 bg-rose-50 text-rose-900 rounded-md p-2 text-sm">{err}</div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Family name">
          <input value={form.familyName} onChange={(e) => set("familyName", e.target.value)} className={inputCls} />
        </Field>
        <Field label="Head name (legacy)">
          <input value={form.headName} onChange={(e) => set("headName", e.target.value)} className={inputCls} />
        </Field>
        <Field label="Primary client">
          <SelectField
            value={form.primaryInvestorId}
            onChange={(e) => set("primaryInvestorId", e.target.value)}
            className="w-full"
            aria-label="Primary client"
          >
            <option value="">— None set —</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name} · {m.pan}</option>
            ))}
          </SelectField>
        </Field>
        <Field label="Family RM">
          <SelectField
            value={form.rmId}
            onChange={(e) => set("rmId", e.target.value)}
            className="w-full"
            aria-label="Family RM"
          >
            <option value="">— None assigned —</option>
            {rms.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </SelectField>
        </Field>
        <Field label="Last review">
          <DatePicker value={form.lastReviewAt} onChange={(iso) => set("lastReviewAt", iso)} className="w-full" ariaLabel="Last review date" />
        </Field>
        <Field label="Next review">
          <DatePicker value={form.nextReviewAt} onChange={(iso) => set("nextReviewAt", iso)} className="w-full" ariaLabel="Next review date" />
        </Field>
      </div>
      <Field label="Notes">
        <textarea
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          rows={3}
          className={inputCls}
        />
      </Field>
    </div>
  );
}

const inputCls = "w-full border rounded-md px-2 py-1 text-sm bg-background";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1">{label}</div>
      {children}
    </label>
  );
}

function toDateInput(d: any): string {
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}
