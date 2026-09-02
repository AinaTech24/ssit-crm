"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { RmSelector } from "@/components/common/RmSelector";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { FAMILY_REVIEW_FREQUENCIES } from "@/lib/families/cadence";

const CATEGORIES = ["HNI", "Affluent", "Retail", "NRI", "Corporate"] as const;

export default function NewFamilyPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    headName: "",
    familyCode: "",
    familyCategory: "",
    rmId: "",
    reviewFrequency: "",
    firstMeetingDate: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.headName.trim()) {
      setErr("Family name is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const payload: any = { headName: form.headName, notes: form.notes || undefined };
      if (form.familyCode) payload.familyCode = form.familyCode;
      if (form.familyCategory) payload.familyCategory = form.familyCategory;
      if (form.rmId) payload.rmId = form.rmId;
      if (form.reviewFrequency) payload.reviewFrequency = form.reviewFrequency;
      if (form.firstMeetingDate) payload.firstMeetingDate = form.firstMeetingDate;

      const res = await fetch("/api/families", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        // A raw "forbidden: missing family.create" tells the user nothing they
        // can act on — name the setting an owner has to switch on, and where.
        if (res.status === 403) {
          setErr(
            "You don’t have permission to create households. Ask your firm admin to enable “Create households” for you under Team → your profile → Customize Access Permissions."
          );
        } else if (res.status === 401) {
          setErr("Your session has expired. Please sign in again.");
        } else if (Array.isArray(j?.issues) && j.issues.length) {
          const fields = j.issues
            .map((i: any) => (Array.isArray(i?.path) ? i.path.join(".") : ""))
            .filter(Boolean)
            .join(", ");
          setErr(fields ? `Please check: ${fields}` : (j.error ?? "Create failed"));
        } else {
          setErr(j.error ?? `Create failed (HTTP ${res.status})`);
        }
        return;
      }
      router.push("/dashboard/families");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <Link href="/dashboard/families" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to families
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">New family</h1>
      <form onSubmit={submit} className="border rounded-lg bg-card p-5 space-y-4">
        {/* Identity */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">
              Family / organisation name<span className="text-rose-600">*</span>
            </div>
            <input
              value={form.headName}
              onChange={(e) => set("headName", e.target.value)}
              required
              // placeholder="e.g. Patel Family"
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            />
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Family code</div>
            <input
              value={form.familyCode}
              onChange={(e) => set("familyCode", e.target.value)}
              // placeholder="e.g. PATEL-001"
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            />
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Category</div>
            <SelectField
              value={form.familyCategory}
              onChange={(e) => set("familyCategory", e.target.value)}
            >
              <option value="">Select</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </SelectField>
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">
              Relationship Manager
              <span className="ml-1 text-[10px] text-muted-foreground font-normal">· defaults to you</span>
            </div>
            <RmSelector
              value={form.rmId || null}
              onChange={(id) => set("rmId", id ?? "")}
              placeholder="Assign to myself"
            />
          </label>
        </div>

        {/* Review cadence */}
        <div className="rounded-lg border border-border bg-secondary/30 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Review cadence
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <div className="text-xs font-medium mb-1">Meeting frequency</div>
              <SelectField
                value={form.reviewFrequency}
                onChange={(e) => set("reviewFrequency", e.target.value)}
              >
                <option value="">None</option>
                {FAMILY_REVIEW_FREQUENCIES.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </SelectField>
            </label>
            <label className="block">
              <div className="text-xs font-medium mb-1">First meeting date</div>
              <DateField
                value={form.firstMeetingDate}
                onChange={(e) => set("firstMeetingDate", e.target.value)}
              />
            </label>
          </div>
          {form.reviewFrequency && form.firstMeetingDate && (
            <p className="text-[11px] text-muted-foreground mt-2">
              The next household review date is computed automatically from this cadence and surfaces
              in the Command Center / Team Dashboard "reviews due".
            </p>
          )}
        </div>

        <label className="block">
          <div className="text-xs font-medium mb-1">Notes</div>
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={3}
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          />
        </label>

        {err && <div className="text-sm text-rose-600">{err}</div>}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Link href="/dashboard/families" className="rounded-md border px-4 py-2 text-sm">Cancel</Link>
          <button disabled={busy || !form.headName} className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50">
            {busy ? "Creating…" : "Create family"}
          </button>
        </div>
      </form>
    </div>
  );
}
