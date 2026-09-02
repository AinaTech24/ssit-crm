"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { DiscoveryForm } from "@/components/discovery/DiscoveryForm";
import type { DiscoveryData } from "@/lib/discovery/calc";

/** Public client wrapper around DiscoveryForm — clientMode (no advisor
 *  assessment), submits to the public endpoint, then shows a thank-you. */
export function PublicDiscoveryForm({ token, initialData, firmName }: { token: string; initialData: DiscoveryData; firmName: string }) {
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(data: DiscoveryData) {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/public/discovery/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data }),
      });
      if (res.ok) {
        setDone(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? "Could not submit — please try again.");
      }
    } catch {
      setErr("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="card-surface p-8 text-center">
        <CheckCircle2 className="size-10 mx-auto text-emerald-500" />
        <h2 className="font-semibold mt-3">Thank you!</h2>
        <p className="text-sm text-muted-foreground mt-2">Your details are with {firmName}. They&apos;ll review them before your meeting. You can close this page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {err && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
      <DiscoveryForm initialData={initialData} clientMode onSubmit={submit} submitLabel="Submit to my advisor" saving={saving} />
    </div>
  );
}
