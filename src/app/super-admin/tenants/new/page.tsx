"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Building2, UserCog, Loader2, Plus } from "lucide-react";

export default function NewTenantPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    firmName: "",
    arn: "",
    ownerName: "",
    ownerEmail: "",
    ownerPassword: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/super-admin/tenants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Create failed");
        return;
      }
      router.push(`/super-admin/tenants/${j.tenantId}`);
    } finally {
      setBusy(false);
    }
  }

  function set(k: string, v: string | number) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <Link href="/super-admin/tenants" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to tenants
      </Link>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        {/* Branded header */}
        <div className="px-6 py-5 text-white" style={{ background: "linear-gradient(135deg, hsl(221 72% 20%) 0%, hsl(221 76% 13%) 100%)" }}>
          <div className="flex items-center gap-3">
            <div className="size-11 rounded-xl bg-white/15 grid place-items-center"><Building2 className="size-5" /></div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Create MFD tenant</h1>
              <p className="text-xs text-white/75">Sets up the firm, owner user and subscription in one step.</p>
            </div>
          </div>
        </div>

        <form onSubmit={submit} className="p-6 space-y-6">
          {/* Firm */}
          <Section icon={Building2} title="Firm">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Firm legal name" value={form.firmName} setValue={(v) => set("firmName", v)} required />
              <Field label="ARN (optional)" value={form.arn} setValue={(v) => set("arn", v)} placeholder="ARN-XXXXX — leave blank if not issued yet" />
            </div>
          </Section>

          {/* Owner */}
          <Section icon={UserCog} title="Owner account">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Owner name" value={form.ownerName} setValue={(v) => set("ownerName", v)} required />
              <Field label="Owner email" value={form.ownerEmail} setValue={(v) => set("ownerEmail", v)} required type="email" />
            </div>
            <Field label="Temporary password (8+)" value={form.ownerPassword} setValue={(v) => set("ownerPassword", v)} required type="password" />
          </Section>

          {err && <div className="rounded-lg border border-rose-300 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 px-3 py-2 text-sm">{err}</div>}

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Link href="/super-admin/tenants" className="rounded-lg border px-4 py-2 text-sm hover:bg-accent transition">Cancel</Link>
            <button disabled={busy} className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5 shadow-sm">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {busy ? "Creating…" : "Create tenant + owner"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="size-7 rounded-lg bg-primary/10 text-primary grid place-items-center"><Icon className="size-4" /></span>
        <div className="text-sm font-semibold">{title}</div>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium text-muted-foreground mb-1">{children}</div>;
}

function Field({
  label, value, setValue, type = "text", placeholder, required,
}: {
  label: string; value: string; setValue: (v: string) => void; type?: string; placeholder?: string; required?: boolean;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-muted-foreground mb-1">
        {label}
        {required && <span className="text-rose-600 ml-0.5">*</span>}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
      />
    </label>
  );
}
