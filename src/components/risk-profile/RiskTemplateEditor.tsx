"use client";

/**
 * Risk Profile Template Editor.
 *
 * MFD owners customise:
 *   - Top-level: name + description + annual review interval
 *   - Questions: label / helper text / option label & score; add / remove / reorder
 *   - Bands: label / score range / colour / description; add / remove
 *
 * Live preview of:
 *   - Score range the template can produce (min/max)
 *   - Band coverage check (no gaps, no overlaps, full coverage)
 *
 * Publishes via PUT /api/risk-profile-template, which creates a new version.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Save,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  GripVertical,
  Download,
  X,
} from "lucide-react";
import { v4 as uuid } from "uuid";
import { DownloadButton } from "@/components/common/SecureLinkButtons";

type Option = { value: string; label: string; score: number };
type Question = { key: string; label: string; helperText?: string; type: "single"; options: Option[] };
type Band = { id: string; label: string; minScore: number; maxScore: number; color?: string; description?: string };
type Template = {
  name: string;
  description: string;
  questions: Question[];
  bands: Band[];
  reviewIntervalDays: number;
  requireEmailOtp: boolean;
};

const SWATCHES = ["#10b981", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#d22e32", "#64748b", "#ec4899"];

export function RiskTemplateEditor({
  initial,
  versionNumber,
}: {
  initial: Template;
  versionNumber: number | null;
}) {
  const router = useRouter();
  const [t, setT] = useState<Template>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // ── Derived: score range + band coverage validation ───────────────────────
  const range = useMemo(() => {
    let min = 0;
    let max = 0;
    for (const q of t.questions) {
      const s = q.options.map((o) => o.score);
      min += Math.min(...s);
      max += Math.max(...s);
    }
    return { min, max };
  }, [t.questions]);

  const bandIssues = useMemo(() => {
    const issues: string[] = [];
    const sorted = [...t.bands].sort((a, b) => a.minScore - b.minScore);
    for (const b of sorted) {
      if (b.minScore > b.maxScore) issues.push(`Band "${b.label}": min (${b.minScore}) > max (${b.maxScore}).`);
    }
    if (sorted.length) {
      if (sorted[0].minScore > range.min) {
        issues.push(`Bands don't cover the lowest possible score (${range.min}). First band starts at ${sorted[0].minScore}.`);
      }
      if (sorted[sorted.length - 1].maxScore < range.max) {
        issues.push(`Bands don't cover the highest possible score (${range.max}). Last band ends at ${sorted[sorted.length - 1].maxScore}.`);
      }
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        if (cur.minScore <= prev.maxScore) issues.push(`"${prev.label}" (..${prev.maxScore}) overlaps with "${cur.label}" (${cur.minScore}..)`);
        if (cur.minScore > prev.maxScore + 1) issues.push(`Gap between "${prev.label}" (..${prev.maxScore}) and "${cur.label}" (${cur.minScore}..) — score ${prev.maxScore + 1} unmapped.`);
      }
    }
    // Duplicate question keys
    const keys = new Set<string>();
    for (const q of t.questions) {
      if (keys.has(q.key)) issues.push(`Duplicate question key "${q.key}".`);
      keys.add(q.key);
    }
    return issues;
  }, [t.bands, t.questions, range]);

  const valid = bandIssues.length === 0 && t.questions.length > 0 && t.bands.length >= 2;

  // ── Top-level setters ─────────────────────────────────────────────────────
  function setMeta<K extends keyof Template>(k: K, v: Template[K]) {
    setT((p) => ({ ...p, [k]: v }));
    setSaved(false);
  }

  // ── Question helpers ──────────────────────────────────────────────────────
  function addQuestion() {
    setT((p) => ({
      ...p,
      questions: [
        ...p.questions,
        {
          key: `question_${p.questions.length + 1}`,
          label: "New question",
          helperText: "",
          type: "single",
          options: [
            { value: "low", label: "Low", score: 1 },
            { value: "high", label: "High", score: 5 },
          ],
        },
      ],
    }));
    setSaved(false);
  }
  function updateQuestion(i: number, patch: Partial<Question>) {
    setT((p) => ({ ...p, questions: p.questions.map((q, ix) => (ix === i ? { ...q, ...patch } : q)) }));
    setSaved(false);
  }
  function removeQuestion(i: number) {
    setT((p) => ({ ...p, questions: p.questions.filter((_, ix) => ix !== i) }));
    setSaved(false);
  }
  function moveQuestion(i: number, dir: -1 | 1) {
    setT((p) => {
      const arr = [...p.questions];
      const j = i + dir;
      if (j < 0 || j >= arr.length) return p;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...p, questions: arr };
    });
    setSaved(false);
  }

  function addOption(qi: number) {
    setT((p) => ({
      ...p,
      questions: p.questions.map((q, ix) =>
        ix === qi
          ? { ...q, options: [...q.options, { value: `opt_${q.options.length + 1}`, label: "New option", score: 0 }] }
          : q
      ),
    }));
    setSaved(false);
  }
  function updateOption(qi: number, oi: number, patch: Partial<Option>) {
    setT((p) => ({
      ...p,
      questions: p.questions.map((q, qix) =>
        qix === qi ? { ...q, options: q.options.map((o, oix) => (oix === oi ? { ...o, ...patch } : o)) } : q
      ),
    }));
    setSaved(false);
  }
  function removeOption(qi: number, oi: number) {
    setT((p) => ({
      ...p,
      questions: p.questions.map((q, qix) => (qix === qi ? { ...q, options: q.options.filter((_, oix) => oix !== oi) } : q)),
    }));
    setSaved(false);
  }

  // ── Band helpers ──────────────────────────────────────────────────────────
  function addBand() {
    setT((p) => ({
      ...p,
      bands: [
        ...p.bands,
        { id: `band_${p.bands.length + 1}`, label: "New band", minScore: 0, maxScore: 0, color: SWATCHES[p.bands.length % SWATCHES.length] },
      ],
    }));
    setSaved(false);
  }
  function updateBand(i: number, patch: Partial<Band>) {
    setT((p) => ({ ...p, bands: p.bands.map((b, ix) => (ix === i ? { ...b, ...patch } : b)) }));
    setSaved(false);
  }
  function removeBand(i: number) {
    setT((p) => ({ ...p, bands: p.bands.filter((_, ix) => ix !== i) }));
    setSaved(false);
  }

  // ── Save / reset ──────────────────────────────────────────────────────────
  async function publish() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const r = await fetch("/api/risk-profile-template", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: t.name,
          description: t.description || undefined,
          questions: t.questions,
          bands: t.bands,
          reviewIntervalDays: t.reviewIntervalDays,
          requireEmailOtp: t.requireEmailOtp,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? data?.issues?.join("; ") ?? `HTTP ${r.status}`);
      setSaved(true);
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Failed to publish");
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!confirm("Reset to the SEBI default questionnaire? Your current customisation will be archived as a previous version.")) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/risk-profile-template/reset", { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Failed to reset");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header / save bar */}
      <div className="card-surface p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[260px]">
          <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Template name</label>
          <input
            value={t.name}
            onChange={(e) => setMeta("name", e.target.value)}
            className="input-base text-sm w-full mt-1"
            placeholder="e.g. Acme Wealth Risk Profile"
          />
        </div>
        <div className="w-40">
          <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Review interval (days)</label>
          <input
            type="number"
            min={30}
            max={3650}
            value={t.reviewIntervalDays}
            onChange={(e) => setMeta("reviewIntervalDays", Number(e.target.value))}
            className="input-base text-sm w-full mt-1"
          />
        </div>
        <div className="flex items-center gap-2 self-end">
          <button onClick={reset} disabled={saving} className="btn-secondary text-xs" title="Reset to SEBI default">
            <RotateCcw className="size-3.5" /> Reset to default
          </button>
          <button onClick={publish} disabled={saving || !valid} className="btn-primary text-sm">
            <Save className="size-4" /> {saving ? "Publishing…" : "Publish new version"}
          </button>
        </div>
      </div>

      {/* Status row */}
      <div className="flex flex-wrap gap-2 text-xs">
        {versionNumber ? (
          <span className="chip bg-brand-cyan-light text-brand-cyan-deep">Active version: v{versionNumber}</span>
        ) : (
          <span className="chip bg-amber-50 text-amber-700">Not customised yet — falling back to SEBI default</span>
        )}
        <span className="chip bg-secondary">
          Score range: <strong className="ml-1 tabular-nums">{range.min}–{range.max}</strong>
        </span>
        <span className="chip bg-secondary">
          {t.questions.length} question{t.questions.length === 1 ? "" : "s"} · {t.bands.length} band{t.bands.length === 1 ? "" : "s"}
        </span>
        {valid ? (
          <span className="chip bg-emerald-50 text-emerald-700 inline-flex items-center gap-1">
            <CheckCircle2 className="size-3" /> Coverage OK
          </span>
        ) : (
          <span className="chip bg-rose-50 text-rose-700 inline-flex items-center gap-1">
            <AlertTriangle className="size-3" /> {bandIssues.length} issue{bandIssues.length === 1 ? "" : "s"}
          </span>
        )}
        {saved && <span className="chip bg-emerald-50 text-emerald-700">✓ Published</span>}
        <DownloadButton
          url="/api/risk-profile-template/pdf?download=1"
          className={`chip inline-flex items-center gap-1 ${saved ? "bg-brand-cyan text-white" : "bg-secondary hover:bg-accent"}`}
          title="Printable questionnaire of the published version — every department can download it"
        >
          <Download className="size-3" /> {saved ? "Download the published form (PDF)" : "Download form (PDF)"}
        </DownloadButton>
      </div>

      {error && (
        <div className="card-surface p-3 text-sm text-rose-700 bg-rose-50/40 flex items-start gap-2">
          <AlertTriangle className="size-4 mt-0.5" /> {error}
        </div>
      )}

      {bandIssues.length > 0 && (
        <div className="card-surface p-3 bg-amber-50/40 border border-amber-200">
          <div className="text-xs font-semibold text-amber-800 mb-1">Fix these before publishing:</div>
          <ul className="text-xs text-amber-800 list-disc list-inside space-y-0.5">
            {bandIssues.map((i, ix) => (
              <li key={ix}>{i}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Description */}
      <div>
        <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Description (shown on the wizard header)</label>
        <textarea
          rows={2}
          value={t.description}
          onChange={(e) => setMeta("description", e.target.value)}
          className="input-base text-sm w-full mt-1"
          placeholder="Optional — context shown to RMs when they run this questionnaire."
        />
      </div>

      {/* Client-submission email OTP */}
      <label className="card-surface p-4 flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={t.requireEmailOtp}
          onChange={(e) => setMeta("requireEmailOtp", e.target.checked)}
          className="mt-0.5 size-4 rounded border-input accent-brand-cyan"
        />
        <span>
          <span className="block text-sm font-semibold">Require email OTP verification on client submissions</span>
          <span className="block text-xs text-muted-foreground mt-0.5">
            Clients must confirm a 6-digit code sent to their email before the form is accepted — the
            verified email is stored on the profile.
          </span>
        </span>
      </label>

      {/* ── Questions ───────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Questions ({t.questions.length})</h2>
          <button onClick={addQuestion} className="btn-secondary text-xs">
            <Plus className="size-3.5" /> Add question
          </button>
        </div>

        <div className="space-y-3">
          {t.questions.map((q, qi) => (
            <div key={q.key + "_" + qi} className="card-surface p-4">
              <div className="flex items-center gap-2 mb-3">
                <GripVertical className="size-4 text-muted-foreground" />
                <span className="chip bg-secondary text-[10px]">Q{qi + 1}</span>
                <input
                  value={q.label}
                  onChange={(e) => updateQuestion(qi, { label: e.target.value })}
                  className="input-base text-sm flex-1 font-semibold"
                  placeholder="Question text"
                />
                <button onClick={() => moveQuestion(qi, -1)} disabled={qi === 0} className="btn-icon h-7 w-7 disabled:opacity-30">
                  <ChevronUp className="size-3.5" />
                </button>
                <button onClick={() => moveQuestion(qi, 1)} disabled={qi === t.questions.length - 1} className="btn-icon h-7 w-7 disabled:opacity-30">
                  <ChevronDown className="size-3.5" />
                </button>
                <button onClick={() => removeQuestion(qi)} className="btn-icon h-7 w-7 text-rose-600">
                  <Trash2 className="size-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-3">
                <Field label="Key (used in API + responses)">
                  <input
                    value={q.key}
                    onChange={(e) => updateQuestion(qi, { key: e.target.value.replace(/[^a-zA-Z0-9_]/g, "_") })}
                    className="input-base text-xs w-full font-mono"
                  />
                </Field>
                <Field label="Helper text (shown under the question)">
                  <input
                    value={q.helperText ?? ""}
                    onChange={(e) => updateQuestion(qi, { helperText: e.target.value })}
                    className="input-base text-xs w-full"
                    placeholder="Optional"
                  />
                </Field>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">
                  Options ({q.options.length})
                </div>
                <div className="space-y-1.5">
                  {q.options.map((o, oi) => (
                    <div key={oi} className="flex items-center gap-1.5">
                      <input
                        value={o.value}
                        onChange={(e) => updateOption(qi, oi, { value: e.target.value.replace(/[^a-zA-Z0-9_]/g, "_") })}
                        className="input-base text-xs w-32 font-mono"
                        placeholder="value"
                      />
                      <input
                        value={o.label}
                        onChange={(e) => updateOption(qi, oi, { label: e.target.value })}
                        className="input-base text-xs flex-1"
                        placeholder="Label shown to RM"
                      />
                      <input
                        type="number"
                        value={o.score}
                        onChange={(e) => updateOption(qi, oi, { score: Number(e.target.value) })}
                        className="input-base text-xs w-20 text-right tabular-nums"
                      />
                      <button onClick={() => removeOption(qi, oi)} disabled={q.options.length <= 2} className="btn-icon h-6 w-6 text-rose-600 disabled:opacity-30">
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                  <button onClick={() => addOption(qi)} disabled={q.options.length >= 10} className="btn-ghost text-[11px]">
                    <Plus className="size-3" /> Add option
                  </button>
                </div>
              </div>
            </div>
          ))}
          {t.questions.length === 0 && (
            <div className="card-surface p-8 text-center text-xs text-muted-foreground border-dashed border-2">
              No questions yet. Click <strong>Add question</strong> above.
            </div>
          )}
        </div>
      </div>

      {/* ── Bands ──────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Risk categories / bands ({t.bands.length})</h2>
          <button onClick={addBand} className="btn-secondary text-xs">
            <Plus className="size-3.5" /> Add band
          </button>
        </div>

        <div className="card-surface p-3 text-xs text-muted-foreground mb-2">
          Bands must cover the full score range <strong className="tabular-nums">{range.min}–{range.max}</strong> with no gaps and no overlaps.
          When a band's <code>id</code> matches one of the canonical investor enum values
          (<code>conservative</code> / <code>moderate</code> / <code>aggressive</code>), it maps to that
          value on the investor record. Any other band id falls back to <code>moderate</code> on the investor row
          but keeps the full band label in the questionnaire response.
        </div>

        <div className="space-y-2">
          {t.bands.map((b, bi) => (
            <div key={b.id + "_" + bi} className="card-surface p-3 flex items-center gap-2">
              <input
                type="color"
                value={b.color ?? "#d22e32"}
                onChange={(e) => updateBand(bi, { color: e.target.value })}
                className="h-9 w-10 rounded border"
              />
              <div className="flex-1 grid grid-cols-4 gap-2">
                <Field label="Label">
                  <input value={b.label} onChange={(e) => updateBand(bi, { label: e.target.value })} className="input-base text-xs w-full" />
                </Field>
                <Field label="ID (lowercase)">
                  <input
                    value={b.id}
                    onChange={(e) => updateBand(bi, { id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
                    className="input-base text-xs w-full font-mono"
                  />
                </Field>
                <Field label="Min score">
                  <input
                    type="number"
                    value={b.minScore}
                    onChange={(e) => updateBand(bi, { minScore: Number(e.target.value) })}
                    className="input-base text-xs w-full tabular-nums"
                  />
                </Field>
                <Field label="Max score">
                  <input
                    type="number"
                    value={b.maxScore}
                    onChange={(e) => updateBand(bi, { maxScore: Number(e.target.value) })}
                    className="input-base text-xs w-full tabular-nums"
                  />
                </Field>
              </div>
              <button onClick={() => removeBand(bi)} disabled={t.bands.length <= 2} className="btn-icon h-7 w-7 text-rose-600 disabled:opacity-30">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Description editor row per band */}
        <details className="mt-2">
          <summary className="text-xs text-muted-foreground cursor-pointer">Edit band descriptions →</summary>
          <div className="mt-2 space-y-2">
            {t.bands.map((b, bi) => (
              <div key={bi} className="flex items-start gap-2">
                <span className="chip text-[10px]" style={{ background: `${b.color ?? "#d22e32"}22`, color: b.color ?? "#841f21" }}>
                  {b.label}
                </span>
                <textarea
                  rows={2}
                  value={b.description ?? ""}
                  onChange={(e) => updateBand(bi, { description: e.target.value })}
                  className="input-base text-xs flex-1"
                  placeholder={`Description of the "${b.label}" category — shown to RMs on review.`}
                />
              </div>
            ))}
          </div>
        </details>

        {/* Visual coverage bar */}
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">Coverage map</div>
          <div className="flex h-7 rounded-md overflow-hidden border">
            {[...t.bands]
              .sort((a, b) => a.minScore - b.minScore)
              .map((b, i) => {
                const total = range.max - range.min;
                const pct = total > 0 ? ((b.maxScore - b.minScore + 1) / (total + 1)) * 100 : 100;
                return (
                  <div
                    key={i}
                    className="flex items-center justify-center text-[10px] font-semibold text-white"
                    style={{ background: b.color ?? "#d22e32", width: `${pct}%` }}
                    title={`${b.label} · ${b.minScore}–${b.maxScore}`}
                  >
                    {b.label}
                  </div>
                );
              })}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums mt-1">
            <span>{range.min}</span>
            <span>{range.max}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground mb-0.5">{label}</div>
      {children}
    </label>
  );
}
