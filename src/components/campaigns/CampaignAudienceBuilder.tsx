"use client";

/**
 * CampaignAudienceBuilder — Zoho-style "select recipients" for a broadcast,
 * without needing the Segments module.
 *
 * Modes:
 *   - All clients        → every investor in the tenant
 *   - All leads          → every lead
 *   - Specific clients   → hand-pick investors via search
 *   - Existing segment   → any saved segment that still exists
 *
 * On "Set audience" it materializes an ad-hoc segment (POST /api/segments/adhoc)
 * and reports { segmentId, count, label } to the parent. The campaign just
 * stores the segmentId, so the existing dispatcher works unchanged.
 */

import { useState } from "react";
import { Users, UserPlus, Loader2, Check, X, Layers, SlidersHorizontal } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { InvestorLookup } from "@/components/common/InvestorLookup";
import { FilterBuilder } from "@/components/filter/FilterBuilder";

type ExistingSegment = { id: string; name: string; memberCount?: number };
export type AudienceSelection = { segmentId: string; count: number; label: string };

type Mode = "all_clients" | "all_leads" | "criteria" | "specific" | "existing";
type FilterGroup = { type: "group"; op: "AND" | "OR"; not?: boolean; children: any[] };
const EMPTY_GROUP: FilterGroup = { type: "group", op: "AND", children: [] };

export function CampaignAudienceBuilder({
  existingSegments,
  selected,
  onSelect,
}: {
  existingSegments: ExistingSegment[];
  selected: AudienceSelection | null;
  onSelect: (sel: AudienceSelection | null) => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("all_clients");
  const [picked, setPicked] = useState<{ id: string; name: string }[]>([]);
  const [existingId, setExistingId] = useState("");
  const [busy, setBusy] = useState(false);
  // "By criteria" mode — target Clients or Leads by a filter.
  const [subject, setSubject] = useState<"investor" | "lead">("investor");
  const [group, setGroup] = useState<FilterGroup>(EMPTY_GROUP);

  const MODES: { key: Mode; label: string; icon: any; hide?: boolean }[] = [
    { key: "all_clients", label: "All clients", icon: Users },
    { key: "all_leads", label: "All leads", icon: Users },
    { key: "criteria", label: "By criteria", icon: SlidersHorizontal },
    { key: "specific", label: "Specific clients", icon: UserPlus },
    { key: "existing", label: "Existing segment", icon: Layers, hide: existingSegments.length === 0 },
  ];

  async function setAudience(overrideMode?: Mode) {
    const m = overrideMode ?? mode;
    setBusy(true);
    try {
      if (m === "existing") {
        const seg = existingSegments.find((s) => s.id === existingId);
        if (!seg) {
          toast.error("Pick a segment first.");
          return;
        }
        onSelect({ segmentId: seg.id, count: seg.memberCount ?? 0, label: seg.name });
        return;
      }

      const criteriaLabel = `${subject === "lead" ? "Leads" : "Clients"} by criteria`;
      const body =
        m === "all_clients"
          ? { subjectType: "investor", mode: "all", name: "All clients" }
          : m === "all_leads"
            ? { subjectType: "lead", mode: "all", name: "All leads" }
            : m === "criteria"
              ? { subjectType: subject, mode: "filter", ast: group, name: criteriaLabel }
              : { subjectType: "investor", mode: "manual", subjectIds: picked.map((p) => p.id), name: "Selected clients" };

      if (m === "specific" && picked.length === 0) {
        toast.error("Add at least one client.");
        return;
      }

      const res = await fetch("/api/segments/adhoc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) {
        toast.error(j.error ?? "Couldn't build audience");
        return;
      }
      const label =
        m === "all_clients" ? "All clients"
        : m === "all_leads" ? "All leads"
        : m === "criteria" ? criteriaLabel
        : `${picked.length} selected client${picked.length === 1 ? "" : "s"}`;
      onSelect({ segmentId: j.segmentId, count: j.memberCount, label });
      toast.success(`Audience set — ${Number(j.memberCount).toLocaleString("en-IN")} recipient${j.memberCount === 1 ? "" : "s"}.`);
    } catch (e: any) {
      toast.error(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  // Resolved state — show the chosen audience with a Change button.
  if (selected) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 flex items-center gap-2">
        <Check className="size-4 text-emerald-600 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-emerald-900 truncate">{selected.label}</div>
          <div className="text-[11px] text-emerald-700">{Number(selected.count).toLocaleString("en-IN")} recipient{selected.count === 1 ? "" : "s"} will receive this</div>
        </div>
        <button type="button" onClick={() => onSelect(null)} className="text-xs font-medium text-emerald-800 hover:underline">
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        {MODES.filter((m) => !m.hide).map((m) => {
          const Icon = m.icon;
          const active = mode === m.key;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => {
                setMode(m.key);
                // "All clients"/"All leads" need no extra input — apply on click so
                // selecting them IS setting the audience (no easy-to-miss 2nd step).
                if (m.key === "all_clients" || m.key === "all_leads") void setAudience(m.key);
              }}
              disabled={busy}
              className={`rounded-md border px-2.5 py-1.5 text-xs font-medium flex items-center gap-1.5 transition disabled:opacity-60 ${
                active ? "border-brand-cyan bg-brand-cyan/5 ring-1 ring-brand-cyan/20" : "hover:bg-secondary"
              }`}
            >
              <Icon className="size-3.5" /> {m.label}
            </button>
          );
        })}
      </div>

      {mode === "specific" && (
        <div className="space-y-2">
          <InvestorLookup
            onSelect={(id, name) => {
              if (!picked.some((p) => p.id === id)) setPicked((s) => [...s, { id, name }]);
            }}
            placeholder="Search a client to add…"
          />
          {picked.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {picked.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-secondary border border-border px-2 py-0.5 text-xs">
                  {p.name}
                  <button type="button" onClick={() => setPicked((s) => s.filter((x) => x.id !== p.id))} className="text-muted-foreground hover:text-rose-600">
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === "criteria" && (
        <div className="space-y-2">
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-xs font-medium">
            {([["investor", "Clients"], ["lead", "Leads"]] as const).map(([val, lbl]) => (
              <button
                key={val}
                type="button"
                onClick={() => {
                  setSubject(val);
                  setGroup(EMPTY_GROUP); // conditions reference the subject's fields — reset on switch
                }}
                className={`px-3 py-1 rounded-md transition-colors ${subject === val ? "bg-brand-navy text-white" : "text-muted-foreground hover:text-foreground"}`}
              >
                {lbl}
              </button>
            ))}
          </div>
          <FilterBuilder subject={subject} value={group} onChange={setGroup} />
          <p className="text-[11px] text-muted-foreground">
            No conditions = everyone in {subject === "lead" ? "Leads" : "Clients"}. Add conditions to narrow it (e.g. segment,
            city, AUM, stage…).
          </p>
        </div>
      )}

      {mode === "existing" && (
        <select value={existingId} onChange={(e) => setExistingId(e.target.value)} className="input-base">
          <option value="">Select a saved segment…</option>
          {existingSegments.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.memberCount ?? 0} members)
            </option>
          ))}
        </select>
      )}

      <button
        type="button"
        onClick={() => setAudience()}
        disabled={busy}
        className="btn-secondary text-xs disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
        {busy ? "Building audience…" : "Set audience"}
      </button>
      <p className="text-[11px] text-muted-foreground">
        Recipients without a valid contact or consent are skipped automatically (and audited).
      </p>
    </div>
  );
}
