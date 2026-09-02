"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, ChevronDown, Save, Check } from "lucide-react";

type Draft = {
  title: string;
  summary: string;
  mfdActions: string[];
  category: string;
  severity: "info" | "action_required" | "critical";
};

/**
 * Paste-a-circular → AI digest draft. For compliance/owner to turn a dense
 * AMFI/SEBI PDF into a clean summary + MFD actions. Draft fields can be reviewed
 * and edited inline before saving to the tenant's library.
 */
export function CircularSummarizer() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Editable draft states
  const [draftTitle, setDraftTitle] = useState("");
  const [draftSummary, setDraftSummary] = useState("");
  const [draftActions, setDraftActions] = useState(""); // newline-separated string
  const [draftCategory, setDraftCategory] = useState("");
  const [draftSeverity, setDraftSeverity] = useState<"info" | "action_required" | "critical">("info");
  const [draftIssuer, setDraftIssuer] = useState("");

  async function save() {
    if (!draft) return;
    setSaving(true);
    setErr(null);

    // Normalize action items: remove leading bullet symbols, filter empty lines
    const cleanActions = draftActions
      .split("\n")
      .map((line) => line.replace(/^[-*•\s]+/, "").trim())
      .filter(Boolean);

    try {
      const res = await fetch("/api/tenant-circulars", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: draftTitle,
          category: draftCategory || null,
          issuer: draftIssuer || null,
          summary: draftSummary,
          mfdAction: cleanActions.map((a) => `- ${a}`).join("\n"),
          severity: draftSeverity,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Could not save");
        return;
      }
      setSaved(true);
      setDraft(null);
      setText("");
      router.refresh(); // re-render the page so the saved entry shows
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  async function run() {
    setErr(null);
    setBusy(true);
    setDraft(null);
    try {
      const res = await fetch("/api/ai/circular-summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Could not summarise");
        return;
      }
      
      setDraft(j);
      setDraftTitle(j.title || "");
      setDraftSummary(j.summary || "");
      setDraftActions((j.mfdActions || []).join("\n"));
      setDraftCategory(j.category || "");
      setDraftSeverity(j.severity || "info");
      setDraftIssuer(j.issuerHint || "AMFI");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-surface p-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-sm font-medium"
      >
        <span className="flex items-center gap-2">
          <Sparkles className="size-4 text-brand-cyan" /> Summarise a circular with AI
        </span>
        <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="Paste the circular / notification text here…"
            className="input-base w-full text-sm font-mono focus:ring-1 focus:ring-brand-cyan"
          />
          <div className="flex items-center gap-2">
            <button onClick={run} disabled={busy || text.trim().length < 40} className="btn-primary text-sm">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Summarise
            </button>
            {text.trim().length > 0 && text.trim().length < 40 && (
              <span className="text-[11px] text-muted-foreground">Paste at least a paragraph.</span>
            )}
          </div>
          {err && <p className="text-xs text-destructive">{err}</p>}
          
          {draft && (
            <div className="rounded-lg border bg-card p-4 space-y-4">
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b pb-1.5">
                Review & Edit AI Draft
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Title</label>
                  <input
                    type="text"
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    className="w-full bg-background border rounded-md p-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand-cyan"
                  />
                </div>
                
                <div className="grid grid-cols-3 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Category</label>
                    <input
                      type="text"
                      value={draftCategory}
                      onChange={(e) => setDraftCategory(e.target.value)}
                      className="w-full bg-background border rounded-md p-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand-cyan"
                    />
                  </div>
                  
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Issuer</label>
                    <input
                      type="text"
                      value={draftIssuer}
                      onChange={(e) => setDraftIssuer(e.target.value)}
                      className="w-full bg-background border rounded-md p-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand-cyan"
                      placeholder="e.g. SEBI, AMFI"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Severity</label>
                    <select
                      value={draftSeverity}
                      onChange={(e) => setDraftSeverity(e.target.value as any)}
                      className="w-full bg-background border rounded-md p-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand-cyan"
                    >
                      <option value="info">Info</option>
                      <option value="action_required">Action Required</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase">Summary</label>
                <textarea
                  value={draftSummary}
                  onChange={(e) => setDraftSummary(e.target.value)}
                  rows={3}
                  className="w-full bg-background border rounded-md p-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand-cyan"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase">MFD Actions (one action per line)</label>
                <textarea
                  value={draftActions}
                  onChange={(e) => setDraftActions(e.target.value)}
                  rows={3}
                  className="w-full bg-background border rounded-md p-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand-cyan"
                  placeholder="Record client details&#10;Verify bank details..."
                />
              </div>

              <div className="flex items-center gap-2 pt-2 border-t">
                <button onClick={save} disabled={saving} className="btn-primary text-xs flex items-center gap-1">
                  {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  Save to my library
                </button>
                <span className="text-[10px] text-muted-foreground italic">
                  Review and audit fields before saving.
                </span>
              </div>
            </div>
          )}
          {saved && (
            <p className="text-xs text-emerald-600 flex items-center gap-1">
              <Check className="size-3.5" /> Saved to your circular library.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
