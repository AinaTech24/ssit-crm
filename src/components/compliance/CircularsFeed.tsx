"use client";

import { useState, useMemo } from "react";
import { 
  ScrollText, 
  AlertTriangle, 
  AlertOctagon, 
  Info, 
  ExternalLink, 
  BookMarked, 
  Search, 
  Filter 
} from "lucide-react";
import { DeleteCircularButton } from "@/components/compliance/DeleteCircularButton";
import { SelectField } from "@/components/ui/SelectField";

type CircularItem = {
  id: string;
  title: string;
  issuer?: string | null;
  category?: string | null;
  summary: string;
  mfdAction?: string | null;
  severity: string;
  sourceUrl?: string | null;
  publishedOn?: string | Date | null;
  createdAt?: string | Date | null;
};

/**
 * Only emit a link for http(s) URLs. Defends the rendered `<a href>` against
 * stored `javascript:` / `data:` values (covers legacy rows + SSIT-curated data,
 * not just freshly-validated writes).
 */
function safeHref(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, "http://x"); // base lets relative URLs resolve, then we check scheme
    return /^https?:$/i.test(u.protocol) && /^https?:\/\//i.test(url) ? url : null;
  } catch {
    return null;
  }
}

const SEVERITY = {
  critical: { icon: AlertOctagon, chip: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900/50", label: "Critical" },
  action_required: { icon: AlertTriangle, chip: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/50", label: "Action required" },
  info: { icon: Info, chip: "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800", label: "Info" },
} as const;

export function CircularsFeed({
  myCirculars,
  amfiCirculars,
  canDraft,
}: {
  myCirculars: CircularItem[];
  amfiCirculars: CircularItem[];
  canDraft: boolean;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [issuerFilter, setIssuerFilter] = useState("all");

  const filterCirculars = (list: CircularItem[]) => {
    return list.filter((c) => {
      const titleMatch = c.title.toLowerCase().includes(searchQuery.toLowerCase());
      const summaryMatch = c.summary.toLowerCase().includes(searchQuery.toLowerCase());
      const categoryMatch = c.category ? c.category.toLowerCase().includes(searchQuery.toLowerCase()) : false;
      const actionMatch = c.mfdAction ? c.mfdAction.toLowerCase().includes(searchQuery.toLowerCase()) : false;
      const searchMatch = titleMatch || summaryMatch || categoryMatch || actionMatch;

      const severityMatch = severityFilter === "all" || c.severity === severityFilter;
      const issuerMatch = issuerFilter === "all" || (c.issuer && c.issuer.toUpperCase() === issuerFilter.toUpperCase());

      return searchMatch && severityMatch && issuerMatch;
    });
  };

  const filteredMyCirculars = useMemo(() => filterCirculars(myCirculars), [myCirculars, searchQuery, severityFilter, issuerFilter]);
  const filteredAmfiCirculars = useMemo(() => filterCirculars(amfiCirculars), [amfiCirculars, searchQuery, severityFilter, issuerFilter]);

  return (
    <div className="space-y-6">
      {/* Search and Filters */}
      <div className="flex items-center justify-between gap-4 flex-wrap bg-secondary/10 p-3 rounded-lg border border-border/40 print:hidden">
        <div className="flex-1 min-w-[240px] relative">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search circulars by keyword, category, or actions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-background border rounded-md pl-9 pr-4 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-cyan"
          />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
            <Filter className="size-3.5" /> Filter:
          </div>

          <SelectField
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            size="sm"
            className="w-40"
          >
            <option value="all">All Severities</option>
            <option value="critical">Critical</option>
            <option value="action_required">Action Required</option>
            <option value="info">Info</option>
          </SelectField>

          <SelectField
            value={issuerFilter}
            onChange={(e) => setIssuerFilter(e.target.value)}
            size="sm"
            className="w-40"
          >
            <option value="all">All Issuers</option>
            <option value="AMFI">AMFI</option>
            <option value="SEBI">SEBI</option>
            <option value="RBI">RBI</option>
            <option value="CBDT">CBDT</option>
            <option value="OTHER">Other</option>
          </SelectField>
        </div>
      </div>

      {/* Tenant Saved Circulars */}
      {filteredMyCirculars.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2 mb-2">
            <BookMarked className="size-4 text-brand-cyan" /> My saved circulars ({filteredMyCirculars.length})
          </h2>
          <div className="space-y-3">
            {filteredMyCirculars.map((c) => {
              const sev = SEVERITY[(c.severity ?? "info") as keyof typeof SEVERITY] ?? SEVERITY.info;
              const SevIcon = sev.icon;
              const actions = (c.mfdAction ?? "").split("\n").map((l) => l.replace(/^-\s*/, "").trim()).filter(Boolean);
              return (
                <div key={c.id} className="card-surface p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`chip border ${sev.chip} inline-flex items-center gap-1`}>
                        <SevIcon className="size-3" /> {sev.label}
                      </span>
                      {c.issuer && <span className="chip bg-secondary text-[10px] uppercase">{c.issuer}</span>}
                      {c.category && <span className="chip bg-secondary text-[10px]">{c.category}</span>}
                      {c.publishedOn && (
                        <span className="text-[11px] text-muted-foreground">{new Date(c.publishedOn).toLocaleDateString("en-IN")}</span>
                      )}
                    </div>
                    {canDraft && <DeleteCircularButton id={c.id} />}
                  </div>
                  <h3 className="font-semibold mt-2">{c.title}</h3>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{c.summary}</p>
                  {actions.length > 0 && (
                    <div className="mt-3 rounded-lg bg-secondary/50 border border-border/60 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                        What you must do
                      </div>
                      <ul className="space-y-1">
                        {actions.map((a, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <span className="mt-1.5 size-1.5 rounded-full bg-brand-cyan shrink-0" />
                            {a}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {safeHref(c.sourceUrl) && (
                    <div className="mt-3 text-[11px]">
                      <a href={safeHref(c.sourceUrl)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-cyan hover:underline">
                        Official source <ExternalLink className="size-3" />
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SSIT Curated Circulars */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <ScrollText className="size-4 text-muted-foreground" /> SSIT-curated digest ({filteredAmfiCirculars.length})
        </h2>
        <div className="space-y-3">
          {filteredAmfiCirculars.length === 0 ? (
            <div className="card-surface p-10 text-center text-sm text-muted-foreground">
              No matching circulars found in the digest.
            </div>
          ) : (
            filteredAmfiCirculars.map((c) => {
              const sev = SEVERITY[(c.severity ?? "info") as keyof typeof SEVERITY] ?? SEVERITY.info;
              const SevIcon = sev.icon;
              const actions = (c.mfdAction ?? "").split("\n").map((l) => l.replace(/^-\s*/, "").trim()).filter(Boolean);
              return (
                <div key={c.id} className="card-surface p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`chip border ${sev.chip} inline-flex items-center gap-1`}>
                          <SevIcon className="size-3" /> {sev.label}
                        </span>
                        <span className="chip bg-secondary text-[10px] uppercase">{c.issuer}</span>
                        {c.category && <span className="chip bg-secondary text-[10px]">{c.category}</span>}
                        {c.publishedOn && (
                          <span className="text-[11px] text-muted-foreground">{new Date(c.publishedOn).toLocaleDateString("en-IN")}</span>
                        )}
                      </div>
                      <h3 className="font-semibold mt-2">{c.title}</h3>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{c.summary}</p>
                  {actions.length > 0 && (
                    <div className="mt-3 rounded-lg bg-secondary/50 border border-border/60 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                        What you must do
                      </div>
                      <ul className="space-y-1">
                        {actions.map((a, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <span className="mt-1.5 size-1.5 rounded-full bg-brand-cyan shrink-0" />
                            {a}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
                    {safeHref(c.sourceUrl) && (
                      <a href={safeHref(c.sourceUrl)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-cyan hover:underline">
                        Official source <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
