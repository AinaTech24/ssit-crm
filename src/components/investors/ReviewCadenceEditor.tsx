"use client";

/**
 * ReviewCadenceEditor — set how often a client should be reviewed, right on the
 * client detail page. Pick a preset (Monthly / Quarterly / Half-yearly / Annual)
 * or enter a custom number of days (e.g. 50, 100). Saving PATCHes the investor;
 * the API re-derives `nextReviewAt`, which is what surfaces the client in the
 * Command Center's "reviews due" reminder. Completing a review meeting bumps the
 * date forward automatically, so a reviewed client drops off the reminder.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, Loader2, Pencil, X } from "lucide-react";
import {
  PRESET_LABEL,
  describeCadence,
  type ReviewFrequency,
} from "@/lib/investors/review-cadence";

const PRESETS: ReviewFrequency[] = ["monthly", "quarterly", "half_yearly", "annual"];

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
}

export function ReviewCadenceEditor({
  investorId,
  reviewFrequency,
  reviewFrequencyDays,
  lastReviewAt,
  nextReviewAt,
  canEdit = true,
}: {
  investorId: string;
  reviewFrequency: ReviewFrequency | null;
  reviewFrequencyDays: number | null;
  lastReviewAt: string | Date | null;
  nextReviewAt: string | Date | null;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Draft state — either a preset OR a custom day count.
  const [mode, setMode] = useState<"preset" | "custom" | "none">(
    reviewFrequencyDays ? "custom" : reviewFrequency ? "preset" : "none"
  );
  const [preset, setPreset] = useState<ReviewFrequency>(reviewFrequency ?? "quarterly");
  const [days, setDays] = useState<string>(reviewFrequencyDays ? String(reviewFrequencyDays) : "100");

  const overdue = nextReviewAt ? new Date(nextReviewAt) < new Date() : false;

  async function save() {
    setBusy(true);
    setError(null);
    // Build the payload: presets clear custom days, custom clears the preset,
    // "none" clears both (and the API clears nextReviewAt → no more reminder).
    let payload: Record<string, unknown>;
    if (mode === "custom") {
      const n = Math.round(Number(days));
      if (!Number.isFinite(n) || n < 1 || n > 3650) {
        setError("Enter a number of days between 1 and 3650.");
        setBusy(false);
        return;
      }
      payload = { reviewFrequencyDays: n, reviewFrequency: null };
    } else if (mode === "preset") {
      payload = { reviewFrequency: preset, reviewFrequencyDays: null };
    } else {
      payload = { reviewFrequency: null, reviewFrequencyDays: null };
    }
    try {
      const res = await fetch(`/api/investors/${investorId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setEditing(false);
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-lg bg-brand-cyan-light grid place-items-center">
            <CalendarClock className="size-3.5 text-brand-cyan-deep" />
          </div>
          <div>
            <h3 className="text-sm font-semibold leading-tight">Review cadence</h3>
            <p className="text-[11px] text-muted-foreground">How often to review this client</p>
          </div>
        </div>
        {canEdit && !editing && (
          <button onClick={() => setEditing(true)} className="btn-ghost text-xs inline-flex items-center gap-1">
            <Pencil className="size-3" /> Edit
          </button>
        )}
      </div>

      {!editing ? (
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Field label="Frequency">
            <span className="font-semibold">{describeCadence(reviewFrequency, reviewFrequencyDays)}</span>
          </Field>
          <Field label="Last review">{fmtDate(lastReviewAt) === "—" ? <span className="text-muted-foreground">Never</span> : fmtDate(lastReviewAt)}</Field>
          <Field label="Next review due">
            {nextReviewAt ? (
              <span className={overdue ? "text-rose-600 font-semibold" : "font-medium"}>
                {fmtDate(nextReviewAt)}
                {overdue && <span className="ml-1 text-[10px] font-semibold uppercase">overdue</span>}
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Field>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => { setMode("preset"); setPreset(p); }}
                className={`text-xs px-2.5 py-1 rounded-md border ${
                  mode === "preset" && preset === p
                    ? "bg-brand-cyan text-white border-brand-cyan"
                    : "bg-card border-border hover:bg-secondary"
                }`}
              >
                {PRESET_LABEL[p]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setMode("custom")}
              className={`text-xs px-2.5 py-1 rounded-md border ${
                mode === "custom" ? "bg-brand-cyan text-white border-brand-cyan" : "bg-card border-border hover:bg-secondary"
              }`}
            >
              Custom days
            </button>
            <button
              type="button"
              onClick={() => setMode("none")}
              className={`text-xs px-2.5 py-1 rounded-md border ${
                mode === "none" ? "bg-slate-600 text-white border-slate-600" : "bg-card border-border hover:bg-secondary"
              }`}
            >
              No reminder
            </button>
          </div>

          {mode === "custom" && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Every</label>
              <input
                type="number"
                min={1}
                max={3650}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className="w-24 border rounded-md px-2 py-1 text-sm"
              />
              <span className="text-xs text-muted-foreground">days (e.g. 50, 100)</span>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            Next review is set from the last completed review (or onboarding date). The client appears in the Command
            Center when a review is due, and drops off automatically once a review meeting is marked completed.
          </p>

          {error && <div className="text-xs text-rose-700 bg-rose-50 rounded-md p-2">{error}</div>}

          <div className="flex items-center gap-2">
            <button onClick={save} disabled={busy} className="btn-primary text-xs inline-flex items-center gap-1.5 disabled:opacity-50">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save
            </button>
            <button onClick={() => { setEditing(false); setError(null); }} className="btn-secondary text-xs inline-flex items-center gap-1.5">
              <X className="size-3.5" /> Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm mt-0.5 truncate">{children}</div>
    </div>
  );
}
