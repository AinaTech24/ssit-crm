"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";

const ROLES = ["owner", "rm", "back_office", "marketing", "compliance", "branch_head"];

export default function NewSopPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    key: "",
    title: "",
    category: "operations",
    requiredRoles: ["rm"],
    body: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggleRole(r: string) {
    setForm((s) => ({
      ...s,
      requiredRoles: s.requiredRoles.includes(r)
        ? s.requiredRoles.filter((x) => x !== r)
        : [...s.requiredRoles, r],
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/sops", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Failed");
        return;
      }
      router.push("/dashboard/sops");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <Link href="/dashboard/sops" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to SOPs
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">New SOP</h1>

      <form onSubmit={submit} className="border rounded-lg bg-card p-5 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Key (lowercase)<span className="text-rose-600">*</span></div>
            <input
              required
              value={form.key}
              onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
              placeholder="lead_follow_up"
              className="w-full border rounded-md px-3 py-2 text-sm bg-background font-mono"
            />
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Category</div>
            <SelectField value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full">
              <option value="operations">Operations</option>
              <option value="compliance">Compliance</option>
              <option value="sales">Sales</option>
              <option value="service">Service</option>
              <option value="marketing">Marketing</option>
              <option value="internal">Internal</option>
            </SelectField>
          </label>
        </div>
        <label className="block">
          <div className="text-xs font-medium mb-1">Title<span className="text-rose-600">*</span></div>
          <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
        </label>
        <div>
          <div className="text-xs font-medium mb-2">Required for roles</div>
          <div className="flex flex-wrap gap-2">
            {ROLES.map((r) => (
              <label key={r} className="flex items-center gap-1.5 border rounded-md px-2 py-1 cursor-pointer hover:bg-accent text-xs">
                <input type="checkbox" checked={form.requiredRoles.includes(r)} onChange={() => toggleRole(r)} />
                <span>{r}</span>
              </label>
            ))}
          </div>
        </div>
        <label className="block">
          <div className="text-xs font-medium mb-1">SOP content (markdown)<span className="text-rose-600">*</span></div>
          <textarea
            required
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            rows={10}
            placeholder="## When this applies&#10;&#10;## Steps&#10;1. …&#10;2. …&#10;&#10;## Escalation"
            className="w-full border rounded-md px-3 py-2 text-sm bg-background font-mono"
          />
        </label>
        {err && <div className="text-sm text-rose-600">{err}</div>}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Link href="/dashboard/sops" className="rounded-md border px-4 py-2 text-sm">Cancel</Link>
          <button disabled={busy || !form.key || !form.title} className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50">
            {busy ? "Creating…" : "Create SOP draft"}
          </button>
        </div>
      </form>
    </div>
  );
}
