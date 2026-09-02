"use client";

import { useEffect, useRef, useState } from "react";
import { X, Send, Search, Loader2, UserCircle2, Mail, MessageSquare, Sparkles, Users, ChevronDown, ChevronRight } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";

type Recipient = { type: "investor" | "lead"; id: string; name: string; details?: string };
type SegmentOpt = { id: string; name: string; memberCount: number };

type BulkResult = {
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  errors: { id: string; reason: string }[];
};

export type BulkSendDrawerProps = {
  open: boolean;
  onClose: () => void;
  assetId: string;
  assetType: string;
};

export function BulkSendDrawer({ open, onClose, assetId, assetType }: BulkSendDrawerProps) {
  const [mode, setMode] = useState<"segment" | "pick">("segment");
  const [segments, setSegments] = useState<SegmentOpt[]>([]);
  const [segmentsLoading, setSegmentsLoading] = useState(false);
  const [segmentId, setSegmentId] = useState("");

  const [q, setQ] = useState("");
  const [results, setResults] = useState<Recipient[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [picked, setPicked] = useState<Recipient[]>([]);

  const [channel, setChannel] = useState<"email" | "whatsapp">("email");
  const [customNote, setCustomNote] = useState("");
  const [generating, setGenerating] = useState(false);

  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [errorsOpen, setErrorsOpen] = useState(false);

  const toast = useToast();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Click outside closes the autocomplete dropdown.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Reset state when the drawer opens; load investor segments once.
  useEffect(() => {
    if (!open) return;
    setMode("segment");
    setSegmentId("");
    setQ("");
    setResults([]);
    setPicked([]);
    setCustomNote("");
    setResult(null);
    setErrorsOpen(false);

    setSegmentsLoading(true);
    fetch("/api/segments")
      .then((r) => r.json())
      .then((j) => {
        const list: SegmentOpt[] = (j.segments ?? [])
          .filter((s: any) => s.subjectType === "investor")
          .map((s: any) => ({ id: s.id, name: s.name, memberCount: s.memberCount ?? 0 }));
        setSegments(list);
      })
      .catch(() => toast.error("Could not load segments."))
      .finally(() => setSegmentsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Debounced investor/lead search (multi-select picker).
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearchBusy(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const j = await res.json();
        const invs: Recipient[] = (j.investors ?? []).map((r: any) => ({
          type: "investor" as const,
          id: r.id,
          name: r.name,
          details: r.pan ? `PAN: ${r.pan}` : (r.email ?? ""),
        }));
        const lds: Recipient[] = (j.leads ?? []).map((r: any) => ({
          type: "lead" as const,
          id: r.id,
          name: r.name,
          details: r.stage ? `Lead · ${r.stage}` : "Lead",
        }));
        setResults([...invs, ...lds]);
        setDropdownOpen(true);
      } catch {
        toast.error("Search query failed.");
      } finally {
        setSearchBusy(false);
      }
    }, 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  if (!open) return null;

  function addRecipient(r: Recipient) {
    setPicked((prev) => (prev.some((p) => p.type === r.type && p.id === r.id) ? prev : [...prev, r]));
    setQ("");
    setResults([]);
    setDropdownOpen(false);
  }
  function removeRecipient(r: Recipient) {
    setPicked((prev) => prev.filter((p) => !(p.type === r.type && p.id === r.id)));
  }

  async function handleGenerateCaption() {
    setGenerating(true);
    try {
      const res = await fetch(`/api/content-library/${assetId}/caption`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const j = await res.json();
      if (!res.ok || !j.caption) {
        toast.error(j.error ?? "Could not generate a caption.", "Generation failed");
        return;
      }
      setCustomNote(j.caption);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not generate a caption.", "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  const selectedSegment = segments.find((s) => s.id === segmentId);
  const sendCount = mode === "segment" ? (selectedSegment?.memberCount ?? 0) : picked.length;
  const canSend = mode === "segment" ? !!segmentId : picked.length > 0;

  async function handleSend() {
    setSending(true);
    try {
      const body: any = { channel, customNote };
      if (mode === "segment") {
        body.segmentId = segmentId;
      } else {
        body.recipients = picked.map((p) => ({ type: p.type, id: p.id }));
      }
      // Image assets carry sensible default branding params; non-images omit them.
      if (assetType === "image") {
        body.position = "bottom";
        body.heightPct = 18;
        body.variant = "solid";
        body.size = "original";
      }
      const res = await fetch(`/api/content-library/${assetId}/send-bulk`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok || !j.success) {
        toast.error(j.error ?? "Bulk send failed.", "Send failed");
        return;
      }
      setResult({
        total: j.total ?? 0,
        sent: j.sent ?? 0,
        skipped: j.skipped ?? 0,
        failed: j.failed ?? 0,
        errors: j.errors ?? [],
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Bulk send failed.", "Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" onClick={onClose} />

      {/* Drawer Body */}
      <div className="relative w-full max-w-lg h-full bg-background border-l shadow-2xl flex flex-col justify-between animate-slide-in">
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between bg-secondary/20">
          <div>
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Users className="size-4 text-brand-cyan" /> Send to many
            </h2>
            <p className="text-xs text-muted-foreground">Broadcast this co-branded asset.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground">
            <X className="size-5" />
          </button>
        </div>

        {result ? (
          /* ── Rollup ─────────────────────────────────────────────────────── */
          <div className="flex-1 p-5 overflow-y-auto space-y-4">
            <div className="card-surface p-4 text-center space-y-1">
              <h3 className="text-lg font-bold text-foreground">Broadcast complete</h3>
              <p className="text-sm text-muted-foreground">
                <span className="text-emerald-600 font-semibold">Sent {result.sent}</span>
                {" · "}
                <span className="text-amber-600 font-semibold">Skipped {result.skipped}</span>
                {" · "}
                <span className="text-rose-600 font-semibold">Failed {result.failed}</span>
              </p>
              <p className="text-[11px] text-muted-foreground">of {result.total} recipients</p>
            </div>

            {result.errors.length > 0 && (
              <div className="card-surface p-3">
                <button
                  type="button"
                  onClick={() => setErrorsOpen((v) => !v)}
                  className="w-full flex items-center justify-between text-xs font-semibold text-muted-foreground"
                >
                  <span>{result.errors.length} recipient note(s)</span>
                  {errorsOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                </button>
                {errorsOpen && (
                  <ul className="mt-2 space-y-1 max-h-56 overflow-y-auto scrollbar-thin">
                    {result.errors.map((e, i) => (
                      <li key={`${e.id}-${i}`} className="text-[11px] font-mono text-muted-foreground border-t border-dashed pt-1">
                        <span className="text-foreground">{e.id}</span>: {e.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ) : (
          /* ── Compose ────────────────────────────────────────────────────── */
          <div className="flex-1 p-5 overflow-y-auto space-y-5">
            {/* 1. Mode toggle */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                Audience
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode("segment")}
                  className={`py-1.5 text-xs font-medium rounded-lg border transition ${
                    mode === "segment"
                      ? "border-brand-cyan bg-brand-cyan-light/40 text-foreground ring-2 ring-brand-cyan/15"
                      : "border-border hover:bg-secondary text-muted-foreground"
                  }`}
                >
                  To a segment
                </button>
                <button
                  type="button"
                  onClick={() => setMode("pick")}
                  className={`py-1.5 text-xs font-medium rounded-lg border transition ${
                    mode === "pick"
                      ? "border-brand-cyan bg-brand-cyan-light/40 text-foreground ring-2 ring-brand-cyan/15"
                      : "border-border hover:bg-secondary text-muted-foreground"
                  }`}
                >
                  Pick recipients
                </button>
              </div>
            </div>

            {/* 2a. Segment picker */}
            {mode === "segment" ? (
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                  Investor Segment
                </label>
                {segmentsLoading ? (
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="size-3.5 animate-spin" /> Loading segments…
                  </div>
                ) : segments.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic">No investor segments found.</div>
                ) : (
                  <SelectField
                    value={segmentId}
                    onChange={(e) => setSegmentId(e.target.value)}
                    placeholder="Select a segment…"
                  >
                    {segments.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.memberCount} clients)
                      </option>
                    ))}
                  </SelectField>
                )}
              </div>
            ) : (
              /* 2b. Multi-select recipient picker */
              <div ref={dropdownRef} className="relative">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                  Recipients
                </label>
                {picked.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {picked.map((r) => (
                      <span
                        key={`${r.type}-${r.id}`}
                        className="chip text-[11px] bg-brand-cyan-light/40 text-foreground flex items-center gap-1"
                      >
                        {r.name}
                        <button
                          type="button"
                          onClick={() => removeRecipient(r)}
                          className="hover:text-destructive"
                          aria-label={`Remove ${r.name}`}
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search clients & leads by name, email, phone…"
                    className="input-base pl-9 text-sm"
                  />
                  {searchBusy && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-brand-cyan animate-spin" />
                  )}
                </div>

                {dropdownOpen && q.trim().length >= 2 && (
                  <div className="absolute left-0 right-0 mt-1 z-30 card-elevated max-h-56 overflow-y-auto scrollbar-thin">
                    {results.length === 0 && !searchBusy ? (
                      <div className="p-4 text-center text-xs text-muted-foreground">
                        <UserCircle2 className="size-6 mx-auto opacity-40 mb-1" />
                        No matching records found.
                      </div>
                    ) : (
                      <ul className="py-1">
                        {results.map((r) => (
                          <li key={`${r.type}-${r.id}`}>
                            <button
                              type="button"
                              onClick={() => addRecipient(r)}
                              className="w-full text-left flex items-center gap-2.5 px-3 py-2 hover:bg-brand-cyan-light/30 transition-colors"
                            >
                              <div className="size-7 rounded-full brand-gradient text-white grid place-items-center text-[10px] font-bold shrink-0 shadow-sm">
                                {r.name.slice(0, 2).toUpperCase()}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="font-semibold text-xs truncate">{r.name}</div>
                                {r.details && (
                                  <div className="text-[10px] text-muted-foreground truncate font-mono mt-0.5">
                                    {r.details}
                                  </div>
                                )}
                              </div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 3. Channel */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                Delivery Channel
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setChannel("email")}
                  className={`py-2 text-xs font-semibold rounded-lg border flex items-center justify-center gap-2 transition ${
                    channel === "email"
                      ? "border-brand-cyan bg-brand-cyan-light/40 text-foreground ring-2 ring-brand-cyan/15"
                      : "border-border hover:bg-secondary text-muted-foreground"
                  }`}
                >
                  <Mail className="size-4" /> Email
                </button>
                <button
                  type="button"
                  onClick={() => setChannel("whatsapp")}
                  className={`py-2 text-xs font-semibold rounded-lg border flex items-center justify-center gap-2 transition ${
                    channel === "whatsapp"
                      ? "border-brand-cyan bg-brand-cyan-light/40 text-foreground ring-2 ring-brand-cyan/15"
                      : "border-border hover:bg-secondary text-muted-foreground"
                  }`}
                >
                  <MessageSquare className="size-4" /> WhatsApp
                </button>
              </div>
            </div>

            {/* 4. Custom note + Generate caption */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                  Custom Message / Note
                </label>
                <button
                  type="button"
                  onClick={handleGenerateCaption}
                  disabled={generating}
                  className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-60"
                >
                  {generating ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                  {generating ? "Generating…" : "Generate caption"}
                </button>
              </div>
              <textarea
                value={customNote}
                onChange={(e) => setCustomNote(e.target.value)}
                rows={4}
                placeholder="Write a note to accompany the asset for every recipient…"
                className="input-base text-sm resize-none"
              />
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="p-4 border-t flex justify-end gap-2 bg-secondary/10">
          {result ? (
            <button type="button" onClick={onClose} className="btn-primary text-xs">
              Done
            </button>
          ) : (
            <>
              <button type="button" onClick={onClose} className="btn-secondary text-xs">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || !canSend}
                className="btn-primary text-xs flex items-center gap-1.5"
              >
                {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                {sending ? "Sending…" : `Send to ${sendCount}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
