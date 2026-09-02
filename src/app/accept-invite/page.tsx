"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function AcceptInviteInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/employees/accept-invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password, name: name || undefined }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Failed");
        return;
      }
      router.push("/dashboard");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <main className="min-h-screen grid place-items-center">
        <div className="max-w-sm text-center">
          <h1 className="text-xl font-bold">Invalid invite</h1>
          <p className="text-sm text-muted-foreground mt-2">No token provided.</p>
          <Link href="/login" className="text-sm text-primary hover:underline mt-4 inline-block">
            Go to sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold tracking-tight">Accept your invitation</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Set a password to join your firm's workspace.
        </p>
        <form onSubmit={submit} className="mt-6 space-y-3">
          <div>
            <label className="text-xs font-medium block mb-1">Your name (optional)</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1">Set a password (8+ chars)</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            />
          </div>
          {err && <div className="text-sm text-rose-600">{err}</div>}
          <button
            disabled={busy || password.length < 8}
            className="w-full rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? "Joining…" : "Join workspace"}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteInner />
    </Suspense>
  );
}
