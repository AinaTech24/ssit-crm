"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Copy } from "lucide-react";

const ROLES: { key: string; label: string; hint?: string }[] = [
  // A firm can have more than one admin. Each one signs in with their OWN email
  // and sets their OWN password when accepting the invite — no shared login.
  // The API and the employee editor already allowed this role; only this list
  // left it out, so the second admin could not be invited from the UI at all.
  { key: "owner", label: "Owner / Firm Admin", hint: "Full access to the firm, including billing and team" },
  { key: "rm", label: "Relationship Manager" },
  { key: "back_office", label: "Back Office" },
  { key: "marketing", label: "Marketing" },
  { key: "compliance", label: "Compliance / DDQ" },
  { key: "branch_head", label: "Branch Head" },
  { key: "sub_broker", label: "Sub Broker" },
  { key: "ra_research", label: "RA — Research" },
  { key: "ra_sales", label: "RA — Sales" },
  { key: "ria", label: "RIA" },
  { key: "insurance", label: "Insurance" },
  { key: "assistant", label: "Assistant" },
  { key: "gifting_hr", label: "Gifting / HR" },
];

export default function InviteEmployeePage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", roles: ["rm"] });
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggleRole(key: string) {
    setForm((s) => ({
      ...s,
      roles: s.roles.includes(key) ? s.roles.filter((r) => r !== key) : [...s.roles, key],
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/employees/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Failed");
        return;
      }
      setInviteUrl(j.inviteUrl);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <Link href="/dashboard/employees" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to employees
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">Invite team member</h1>
      <p className="text-sm text-muted-foreground">
        Generates a one-time invite link valid for 7 days. Share it with the invitee — they'll set their own password on accepting.
      </p>

      {!inviteUrl ? (
        <form onSubmit={submit} className="border rounded-lg bg-card p-5 space-y-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Name</div>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Work email<span className="text-rose-600">*</span></div>
            <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
          </label>
          <div>
            <div className="text-xs font-medium mb-2">Roles (one or more)</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ROLES.map((r) => (
                <label key={r.key} className="flex items-center gap-2 border rounded-md p-2 cursor-pointer hover:bg-accent">
                  <input
                    type="checkbox"
                    checked={form.roles.includes(r.key)}
                    onChange={() => toggleRole(r.key)}
                    className="size-3.5"
                  />
                  <span className="text-sm">
                    {r.label}
                    {r.hint && <span className="block text-[11px] text-muted-foreground">{r.hint}</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>
          {err && <div className="text-sm text-rose-600">{err}</div>}
          <div className="flex flex-wrap justify-end gap-2 pt-2 border-t">
            <Link href="/dashboard/employees" className="rounded-md border px-4 py-2 text-sm">Cancel</Link>
            <button disabled={busy || !form.email || form.roles.length === 0} className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50">
              {busy ? "Generating…" : "Generate invite link"}
            </button>
          </div>
        </form>
      ) : (
        <div className="border rounded-lg bg-card p-5 space-y-3">
          <div className="text-sm font-medium text-emerald-600">✓ Invite link generated. Share with {form.email}:</div>
          <div className="flex gap-2">
            <input readOnly value={inviteUrl} className="flex-1 border rounded-md px-3 py-2 text-xs font-mono bg-muted" />
            <button onClick={() => navigator.clipboard.writeText(inviteUrl)} className="rounded-md border px-3 text-sm flex items-center gap-1">
              <Copy className="size-3.5" /> Copy
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Valid for 7 days. The invitee will set their own password when they click the link.
          </p>
          <div className="flex flex-wrap justify-end gap-2 pt-2 border-t">
            <Link href="/dashboard/employees" className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium">Done</Link>
          </div>
        </div>
      )}
    </div>
  );
}
