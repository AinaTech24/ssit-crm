"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export function NewPlatformStaffForm({ superAdminExists }: { superAdminExists: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    // Only one Super Admin exists at a time, so when the seat is taken the form
    // opens on Admin — the option that will actually save.
    role: superAdminExists ? "platform_support" : "platform_admin",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/super-admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Create failed");
        return;
      }
      router.push("/super-admin/users");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <Link href="/super-admin/users" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to platform staff
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">Add admin</h1>
      <p className="text-sm text-muted-foreground">
        Admins get full cross-tenant access to the SaaS. There is exactly one Super Admin;
        everyone else is an Admin. The email must not already be in use.
      </p>

      <form onSubmit={submit} className="border rounded-lg bg-card p-5 space-y-3">
        <label className="block">
          <div className="text-xs font-medium mb-1">Name<span className="text-rose-600">*</span></div>
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
        </label>
        <label className="block">
          <div className="text-xs font-medium mb-1">Work email<span className="text-rose-600">*</span></div>
          <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@ssit.com" className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
        </label>
        <label className="block">
          <div className="text-xs font-medium mb-1">Initial password (8+)<span className="text-rose-600">*</span></div>
          <input required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
        </label>
        <div>
          <div className="text-xs font-medium mb-2">Role</div>
          <div className="space-y-2">
            <label
              className={`flex items-start gap-2 border rounded p-3 ${
                superAdminExists ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-accent/40"
              }`}
            >
              <input
                type="radio"
                name="role"
                disabled={superAdminExists}
                checked={form.role === "platform_admin"}
                onChange={() => setForm({ ...form, role: "platform_admin" })}
                className="mt-1"
              />
              <div>
                <div className="font-medium text-sm">Super Admin</div>
                <div className="text-xs text-muted-foreground">
                  Full cross-tenant read + write — tenants, packages, billing, staff. The top tier.
                </div>
                {superAdminExists && (
                  <div className="text-xs text-amber-700 mt-1">
                    Taken — there is one Super Admin. Suspend the current one first to hand the role over.
                  </div>
                )}
              </div>
            </label>
            <label className="flex items-start gap-2 border rounded p-3 cursor-pointer hover:bg-accent/40">
              <input type="radio" name="role" checked={form.role === "platform_support"} onChange={() => setForm({ ...form, role: "platform_support" })} className="mt-1" />
              <div>
                <div className="font-medium text-sm">Admin</div>
                <div className="text-xs text-muted-foreground">Same full powers as Super Admin — including creating other Admins and Super Admins.</div>
              </div>
            </label>
          </div>
        </div>
        {err && <div className="text-sm text-rose-600">{err}</div>}
        <div className="flex flex-wrap justify-end gap-2 pt-2 border-t">
          <Link href="/super-admin/users" className="rounded-md border px-4 py-2 text-sm">Cancel</Link>
          <button disabled={busy || !form.email || form.password.length < 8} className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50">
            {busy ? "Creating…" : "Add staff member"}
          </button>
        </div>
      </form>
    </div>
  );
}
