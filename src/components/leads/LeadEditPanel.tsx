"use client";

/**
 * In-place edit panel for the Lead detail page.
 *
 * Renders the "Lead details" + "Source attribution" + "Internal notes" cards
 * as read-only by default. Clicking "Edit" swaps them for editable inputs;
 * Save patches the lead via /api/leads/[id] and refreshes the route.
 *
 * Only fields the spec calls out as editable show inputs — `lastFollowUpAt`,
 * `convertedAt`, `lostAt`, `createdAt` stay read-only (set by the backend).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Save, X, Loader2 } from "lucide-react";

const SOURCES = [
  ["referral", "Referral"],
  ["website", "Website"],
  ["social_media", "Social Media"],
  ["webinar", "Webinar"],
  ["seminar", "Seminar"],
  ["walk_in", "Walk-in"],
  ["existing_client", "Existing Client Reference"],
  ["google", "Google"],
  ["cold_call", "Cold Call"],
  ["other", "Other"],
  ["meta_ads", "Meta Ads"],
  ["linkedin", "LinkedIn"],
  ["youtube", "YouTube"],
  ["event", "Event"],
  ["manual", "Manual"],
] as const;

export function LeadEditPanel({ lead }: { lead: any }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isConverted = !!lead.convertedInvestorId;

  const [form, setForm] = useState({
    name: lead.name ?? "",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    city: lead.city ?? "",
    source: lead.source ?? "manual",
    sourceCampaign: lead.sourceCampaign ?? "",
    intendedAmount: lead.intendedAmount ?? "",
    score: String(lead.score ?? ""),
    nextFollowUpAt: lead.nextFollowUpAt ? toDateInput(lead.nextFollowUpAt) : "",
    followUpNotes: lead.followUpNotes ?? "",
    notes: lead.notes ?? "",
    lostReason: lead.lostReason ?? "",
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const payload: any = {
        name: form.name,
        email: form.email || "",
        phone: form.phone || undefined,
        city: form.city || undefined,
        source: form.source,
        sourceCampaign: form.sourceCampaign || undefined,
        intendedAmount: form.intendedAmount || undefined,
        followUpNotes: form.followUpNotes || undefined,
        notes: form.notes || undefined,
      };
      if (form.nextFollowUpAt) payload.nextFollowUpAt = new Date(form.nextFollowUpAt).toISOString();
      if (lead.stage === "lost") payload.lostReason = form.lostReason;

      const res = await fetch(`/api/leads/${lead.id}`, {
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
    setForm({
      name: lead.name ?? "",
      email: lead.email ?? "",
      phone: lead.phone ?? "",
      city: lead.city ?? "",
      source: lead.source ?? "manual",
      sourceCampaign: lead.sourceCampaign ?? "",
      intendedAmount: lead.intendedAmount ?? "",
      score: String(lead.score ?? ""),
      nextFollowUpAt: lead.nextFollowUpAt ? toDateInput(lead.nextFollowUpAt) : "",
      followUpNotes: lead.followUpNotes ?? "",
      notes: lead.notes ?? "",
      lostReason: lead.lostReason ?? "",
    });
    setEditing(false);
    setErr(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Lead record
        </h2>
        {isConverted ? (
          <span className="text-xs text-muted-foreground italic bg-secondary/50 px-2 py-1 rounded">
            ReadOnly · Converted to client
          </span>
        ) : !editing ? (
          <button
            onClick={() => setEditing(true)}
            className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-accent"
          >
            <Pencil className="size-3.5" /> Edit lead
          </button>
        ) : (
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
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        )}
      </div>

      {err && (
        <div className="border border-rose-300 bg-rose-50 text-rose-900 rounded-md p-2 text-sm">{err}</div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* ----------------- Lead details ----------------- */}
        <div className="border rounded-lg bg-card p-5 space-y-3">
          <h3 className="font-semibold">Lead details</h3>

          <Row label="Lead name">
            {editing ? (
              <input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                className="w-full border rounded-md px-2 py-1 text-sm bg-background"
              />
            ) : (
              <span className="font-medium">{lead.name}</span>
            )}
          </Row>

          <Row label="Mobile">
            {editing ? (
              <input
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="+91…"
                className="w-full border rounded-md px-2 py-1 text-sm bg-background"
              />
            ) : (
              <span>{lead.phone ?? "—"}</span>
            )}
          </Row>

          <Row label="Email">
            {editing ? (
              <input
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                className="w-full border rounded-md px-2 py-1 text-sm bg-background"
              />
            ) : (
              <span>{lead.email ?? "—"}</span>
            )}
          </Row>

          <Row label="City">
            {editing ? (
              <input
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
                className="w-full border rounded-md px-2 py-1 text-sm bg-background"
              />
            ) : (
              <span>{lead.city ?? "—"}</span>
            )}
          </Row>

          <Row label="Lead score">
            <span className="font-medium">{lead.score ?? "—"}</span>
          </Row>

          <Row label="Intended amount">
            {editing ? (
              <input
                value={form.intendedAmount}
                onChange={(e) => set("intendedAmount", e.target.value)}
                placeholder="500000"
                className="w-full border rounded-md px-2 py-1 text-sm bg-background tabular-nums"
              />
            ) : (
              <span className="tabular-nums">
                {lead.intendedAmount ? `₹${Number(lead.intendedAmount).toLocaleString("en-IN")}` : "—"}
              </span>
            )}
          </Row>

          <Row label="Next follow-up">
            {editing ? (
              <input
                type="date"
                value={form.nextFollowUpAt}
                onChange={(e) => set("nextFollowUpAt", e.target.value)}
                className="w-full border rounded-md px-2 py-1 text-sm bg-background"
              />
            ) : (
              <span>{lead.nextFollowUpAt ? fmt(lead.nextFollowUpAt) : "—"}</span>
            )}
          </Row>

          <Row label="Last follow-up">
            <span className="text-muted-foreground">
              {lead.lastFollowUpAt ? fmt(lead.lastFollowUpAt) : "—"}
            </span>
          </Row>

          {lead.stage === "lost" && (
            <Row label="Lost reason">
              {editing ? (
                <input
                  value={form.lostReason}
                  onChange={(e) => set("lostReason", e.target.value)}
                  className="w-full border rounded-md px-2 py-1 text-sm bg-background"
                />
              ) : (
                <span>{lead.lostReason ?? "—"}</span>
              )}
            </Row>
          )}
        </div>

        {/* ----------------- Source attribution ----------------- */}
        <div className="border rounded-lg bg-card p-5 space-y-3">
          <h3 className="font-semibold">Source attribution</h3>

          <Row label="Source">
            {editing ? (
              <select
                value={form.source}
                onChange={(e) => set("source", e.target.value)}
                className="w-full border rounded-md px-2 py-1 text-sm bg-background"
              >
                {SOURCES.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            ) : (
              <span className="capitalize">{lead.source.replace(/_/g, " ")}</span>
            )}
          </Row>

          <Row label="Campaign">
            {editing ? (
              <input
                value={form.sourceCampaign}
                onChange={(e) => set("sourceCampaign", e.target.value)}
                placeholder="e.g. Diwali-2026"
                className="w-full border rounded-md px-2 py-1 text-sm bg-background"
              />
            ) : (
              <span>{lead.sourceCampaign ?? "—"}</span>
            )}
          </Row>

          {lead.utmParams && (
            <>
              <Row label="UTM source">
                <span className="text-muted-foreground">{(lead.utmParams as any).source ?? "—"}</span>
              </Row>
              <Row label="UTM campaign">
                <span className="text-muted-foreground">{(lead.utmParams as any).campaign ?? "—"}</span>
              </Row>
            </>
          )}
          {lead.referredByName && (
            <Row label="Referred by">
              <span>{lead.referredByName}</span>
            </Row>
          )}
        </div>
      </div>

      {/* ----------------- Follow-up notes + Internal notes ----------------- */}
      <div className="border rounded-lg bg-card p-5 space-y-3">
        <h3 className="font-semibold">Notes</h3>
        <div>
          <div className="text-xs text-muted-foreground mb-1">Follow-up notes (latest first)</div>
          {editing ? (
            <textarea
              value={form.followUpNotes}
              onChange={(e) => set("followUpNotes", e.target.value)}
              rows={5}
              className="w-full border rounded-md px-2 py-1 text-sm bg-background"
              placeholder="What did you discuss with this lead?"
            />
          ) : (
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">
              {lead.followUpNotes || <em>No notes yet.</em>}
            </p>
          )}
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">Internal notes</div>
          {editing ? (
            <textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
              className="w-full border rounded-md px-2 py-1 text-sm bg-background"
            />
          ) : (
            <p className="text-sm whitespace-pre-wrap">{lead.notes || <em>No internal notes.</em>}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 items-center py-1.5 border-b last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function toDateInput(d: any): string {
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function fmt(d: any): string {
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
