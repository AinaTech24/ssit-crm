"use client";

/**
 * AMFI DDQ Audit Checklist — interactive, persisted. Renders the 40 items by
 * section, each with a status selector, search/filtering, collapsible note area,
 * compliance document vault linkages, and one-click database-backed auto-verification.
 */

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { 
  ShieldCheck, 
  ArrowUpRight, 
  Loader2, 
  Printer, 
  Search, 
  Filter, 
  ChevronDown, 
  ChevronUp, 
  FileText, 
  CheckCircle2, 
  Zap, 
  Save,
  FileCheck
} from "lucide-react";
import {
  DDQ_ITEMS,
  DDQ_SECTIONS,
  DDQ_STATUS_LABELS,
  ddqReadiness,
  type DdqStatus,
} from "@/lib/compliance/amfi-ddq-checklist";

export type ChecklistRecord = {
  itemKey: string;
  status: DdqStatus;
  note: string | null;
  documentId: string | null;
};

export type ComplianceDocSummary = {
  id: string;
  title: string;
  category: string;
};

const STATUS_ORDER: DdqStatus[] = ["in_place", "in_progress", "pending", "not_applicable"];

const STATUS_TONE: Record<DdqStatus, string> = {
  in_place: "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/50",
  in_progress: "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/50",
  pending: "bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900/50",
  not_applicable: "bg-slate-50 text-slate-600 border-slate-300 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800",
};

export function DdqAuditChecklist({
  initialRecords,
}: {
  initialRecords: ChecklistRecord[];
}) {
  const [records, setRecords] = useState<Record<string, { status: DdqStatus; note: string; documentId: string }>>(() => {
    const map: Record<string, { status: DdqStatus; note: string; documentId: string }> = {};
    for (const item of DDQ_ITEMS) {
      map[item.key] = { status: "pending", note: "", documentId: "" };
    }
    for (const r of initialRecords || []) {
      map[r.itemKey] = {
        status: r.status,
        note: r.note || "",
        documentId: r.documentId || "",
      };
    }
    return map;
  });

  const [docs, setDocs] = useState<ComplianceDocSummary[]>([]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [tempNotes, setTempNotes] = useState<Record<string, string>>({});

  // Search & Filtering
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [coverageFilter, setCoverageFilter] = useState<string>("all");

  // Fetch available compliance documents from vault
  useEffect(() => {
    async function loadDocs() {
      try {
        const res = await fetch("/api/ddq-checklist/documents");
        if (res.ok) {
          const data = await res.json();
          setDocs(data.documents || []);
        }
      } catch (err) {
        console.error("Failed to load compliance documents:", err);
      }
    }
    loadDocs();
  }, []);

  const readiness = useMemo(() => {
    const statusByKey: Record<string, DdqStatus> = {};
    for (const [k, v] of Object.entries(records)) {
      statusByKey[k] = v.status;
    }
    return ddqReadiness(statusByKey);
  }, [records]);

  // Update a single item's status, note, or linked document
  async function updateRecord(itemKey: string, fields: Partial<{ status: DdqStatus; note: string; documentId: string }>) {
    setSavingKey(itemKey);
    const current = records[itemKey];
    const next = { ...current, ...fields };

    // Optimistically update locally
    setRecords((prev) => ({ ...prev, [itemKey]: next }));

    try {
      const res = await fetch("/api/ddq-checklist", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemKey,
          status: next.status,
          note: next.note || null,
          documentId: next.documentId || null,
        }),
      });
      if (!res.ok) {
        // Revert
        setRecords((prev) => ({ ...prev, [itemKey]: current }));
        alert("Failed to save changes.");
      }
    } catch (err) {
      setRecords((prev) => ({ ...prev, [itemKey]: current }));
      console.error(err);
      alert("Error saving checklist status.");
    } finally {
      setSavingKey(null);
    }
  }

  // Trigger automated evidence scans
  async function runAutoVerify() {
    setVerifying(true);
    try {
      const res = await fetch("/api/ddq-checklist/autoverify", {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        const updatedList: ChecklistRecord[] = data.items || [];
        
        setRecords((prev) => {
          const next = { ...prev };
          for (const item of updatedList) {
            next[item.itemKey] = {
              status: item.status,
              note: item.note || "",
              documentId: item.documentId || "",
            };
          }
          return next;
        });
        
        // Refresh local text inputs
        const updatedTemp: Record<string, string> = {};
        for (const item of updatedList) {
          if (item.note) {
            updatedTemp[item.itemKey] = item.note;
          }
        }
        setTempNotes((prev) => ({ ...prev, ...updatedTemp }));
        
        alert("Verification check completed! Applicable in-app evidence was automatically promoted to 'In place'.");
      } else {
        alert("Failed to run automated verification.");
      }
    } catch (err) {
      console.error(err);
      alert("Error executing auto-verification scanning.");
    } finally {
      setVerifying(false);
    }
  }

  // Filtering Logic
  const filteredItems = useMemo(() => {
    return DDQ_ITEMS.filter((item) => {
      const state = records[item.key];
      
      const matchesSearch = 
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.ddqRef && item.ddqRef.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (state?.note && state.note.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesStatus = statusFilter === "all" || state?.status === statusFilter;
      const matchesCoverage = coverageFilter === "all" || item.coverage === coverageFilter;

      return matchesSearch && matchesStatus && matchesCoverage;
    });
  }, [records, searchQuery, statusFilter, coverageFilter]);

  const ring =
    readiness.pct >= 85 ? "text-emerald-600" : readiness.pct >= 60 ? "text-amber-600" : "text-rose-600";

  return (
    <div className="space-y-6">
      {/* Dynamic circular score indicator bar */}
      <div className="card-surface glass-card p-6 border border-border/60 bg-gradient-to-br from-background to-secondary/10 print:border">
        <div className="flex items-center justify-between gap-6 flex-wrap">
          <div className="flex items-center gap-5">
            <div className="relative size-24 grid place-items-center shrink-0">
              <svg className="size-full -rotate-90">
                <circle cx="48" cy="48" r="40" className="stroke-secondary/20 fill-none" strokeWidth="8" />
                <circle
                  cx="48" cy="48" r="40"
                  className={`fill-none transition-all duration-500 ${readiness.pct >= 85 ? "stroke-emerald-500" : readiness.pct >= 60 ? "stroke-amber-500" : "stroke-rose-500"}`}
                  strokeWidth="8" strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 40}`}
                  strokeDashoffset={`${2 * Math.PI * 40 * (1 - readiness.pct / 100)}`}
                />
              </svg>
              <div className={`absolute text-2xl font-bold tabular-nums ${ring}`}>{readiness.pct}%</div>
            </div>
            <div>
              <div className="font-bold text-base flex items-center gap-2">
                <ShieldCheck className="size-5 text-emerald-600" /> AMFI Audit Checklist Readiness
              </div>
              <div className="text-xs text-muted-foreground mt-1.5 flex items-center gap-2 flex-wrap">
                <span className="chip bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 border border-emerald-200/30 font-semibold px-2 py-0.5 rounded text-[10px]">
                  {readiness.inPlace} in place
                </span>
                <span className="chip bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400 border border-amber-200/30 font-semibold px-2 py-0.5 rounded text-[10px]">
                  {readiness.inProgress} in progress
                </span>
                <span className="chip bg-rose-50 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400 border border-rose-200/30 font-semibold px-2 py-0.5 rounded text-[10px]">
                  {readiness.pending} pending
                </span>
                {readiness.na > 0 && (
                  <span className="chip bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 font-semibold px-2 py-0.5 rounded text-[10px]">
                    {readiness.na} N/A
                  </span>
                )}
                <span className="text-muted-foreground font-mono">({DDQ_ITEMS.length} items total)</span>
              </div>
              <div className="text-[10px] text-muted-foreground mt-2">
                Readiness score computes dynamic in-app verifications and manual uploads. Excludes N/A items.
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 print:hidden">
            <button
              onClick={runAutoVerify}
              disabled={verifying}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs px-3.5 py-2 disabled:opacity-50 transition-colors shadow-sm"
              title="Queries the database to automatically verify and mark completed in-app configurations"
            >
              {verifying ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Zap className="size-3.5 fill-current" />
              )}
              {verifying ? "Scanning Database..." : "Auto-Verify In-App Evidence"}
            </button>

            <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-md border bg-background hover:bg-secondary/20 font-semibold text-xs px-3.5 py-2 transition-colors">
              <Printer className="size-3.5" /> Print Checklist
            </button>
          </div>
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="flex items-center justify-between gap-4 flex-wrap bg-secondary/10 p-3 rounded-lg border border-border/40 print:hidden">
        <div className="flex-1 min-w-[240px] relative">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by title, DDQ section, or notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-background border rounded-md pl-9 pr-4 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-cyan"
          />
        </div>
        
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
            <Filter className="size-3.5" /> Filter by:
          </div>
          
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-background border rounded-md px-2.5 py-1.5 text-xs font-semibold focus:outline-none"
          >
            <option value="all">All Statuses</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>{DDQ_STATUS_LABELS[s]}</option>
            ))}
          </select>

          <select
            value={coverageFilter}
            onChange={(e) => setCoverageFilter(e.target.value)}
            className="bg-background border rounded-md px-2.5 py-1.5 text-xs font-semibold focus:outline-none"
          >
            <option value="all">All Coverage</option>
            <option value="in_app">In-App</option>
            <option value="document">Document uploads</option>
          </select>
        </div>
      </div>

      {/* Sections and Items list */}
      <div className="space-y-4">
        {DDQ_SECTIONS.map((sec) => {
          const items = filteredItems.filter((i) => i.section === sec.key);
          if (items.length === 0) return null;

          return (
            <div key={sec.key} className="card-surface overflow-hidden border border-border/60 rounded-lg shadow-sm bg-card break-inside-avoid">
              <div className="border-b px-4 py-3 font-bold text-sm bg-secondary/30 flex items-center justify-between">
                <span>{sec.key}. {sec.title}</span>
                <span className="text-xs font-mono text-muted-foreground font-semibold">({items.length} items)</span>
              </div>
              <div className="divide-y">
                {items.map((item) => {
                  const state = records[item.key] || { status: "pending", note: "", documentId: "" };
                  const isExpanded = expandedKey === item.key;
                  const currentTempNote = tempNotes[item.key] !== undefined ? tempNotes[item.key] : state.note;

                  return (
                    <div key={item.key} className={`flex flex-col transition-colors ${isExpanded ? "bg-secondary/5" : "hover:bg-secondary/5"}`}>
                      {/* Main row summary */}
                      <div className="flex items-start justify-between gap-4 p-4">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <span className="text-xs font-mono text-muted-foreground shrink-0 mt-0.5 min-w-[32px]">{item.ddqRef || "—"}</span>
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-sm text-foreground/90">{item.title}</div>
                            <div className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-2 flex-wrap">
                              <span
                                className={`chip text-[9px] font-bold py-0.5 px-2 rounded-full border ${
                                  item.coverage === "in_app"
                                    ? "bg-brand-cyan-light text-brand-cyan-deep border-brand-cyan/20"
                                    : "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700"
                                }`}
                              >
                                {item.coverage === "in_app" ? "In-app evidence" : "Document vault"}
                              </span>
                              {item.note && (
                                <span className="text-[11px] text-muted-foreground italic truncate max-w-[350px]">
                                  Note: {item.note}
                                </span>
                              )}
                              {item.href && (
                                <Link
                                  href={item.href}
                                  className="inline-flex items-center gap-0.5 text-brand-cyan-deep hover:underline font-semibold print:hidden"
                                >
                                  {item.hrefLabel ?? "View report"} <ArrowUpRight className="size-3" />
                                </Link>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0 print:hidden">
                          {savingKey === item.key && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                          
                          <select
                            value={state.status}
                            onChange={(e) => updateRecord(item.key, { status: e.target.value as DdqStatus })}
                            className={`text-xs rounded-md border px-3 py-1.5 font-bold focus:outline-none ${STATUS_TONE[state.status]}`}
                          >
                            {STATUS_ORDER.map((s) => (
                              <option key={s} value={s}>{DDQ_STATUS_LABELS[s]}</option>
                            ))}
                          </select>

                          <button
                            onClick={() => setExpandedKey(isExpanded ? null : item.key)}
                            className="p-1.5 hover:bg-secondary/40 rounded border border-border/60 transition-colors"
                            aria-label="Expand notes and details"
                            title="Edit notes / Link files"
                          >
                            {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                          </button>
                        </div>

                        {/* Print-only fallback status */}
                        <div className="hidden print:block text-xs font-mono font-bold uppercase shrink-0 mt-0.5 border px-2 py-0.5 rounded">
                          {DDQ_STATUS_LABELS[state.status]}
                        </div>
                      </div>

                      {/* Expandable note and document linker */}
                      {isExpanded && (
                        <div className="px-11 pb-4 pt-1 border-t border-border/40 bg-secondary/5 grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="flex flex-col gap-2">
                            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                              Internal Audit Notes
                            </label>
                            <textarea
                              rows={3}
                              placeholder="Record compliance evidence notes, reasons for exclusion, or audit trail comments..."
                              value={currentTempNote}
                              onChange={(e) => setTempNotes((prev) => ({ ...prev, [item.key]: e.target.value }))}
                              className="w-full bg-background border rounded-md p-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand-cyan"
                            />
                            <div className="flex justify-end">
                              <button
                                onClick={() => updateRecord(item.key, { note: currentTempNote })}
                                disabled={savingKey === item.key}
                                className="inline-flex items-center gap-1 bg-brand-cyan text-brand-cyan-deep hover:bg-brand-cyan/80 text-[10px] font-bold px-2.5 py-1 rounded transition-colors"
                              >
                                <Save className="size-3" /> Save Notes
                              </button>
                            </div>
                          </div>

                          <div className="flex flex-col gap-2">
                            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                              Linked Compliance Document
                            </label>
                            {item.coverage === "document" ? (
                              <>
                                <select
                                  value={state.documentId}
                                  onChange={(e) => updateRecord(item.key, { documentId: e.target.value })}
                                  className="w-full bg-background border rounded-md p-2 text-xs focus:outline-none"
                                >
                                  <option value="">Unlinked (No file associated)</option>
                                  {docs.map((doc) => (
                                    <option key={doc.id} value={doc.id}>
                                      [{doc.category.toUpperCase()}] {doc.title}
                                    </option>
                                  ))}
                                </select>
                                <p className="text-[10px] text-muted-foreground">
                                  Link a validated document from your compliance folder for verification audits.
                                </p>
                              </>
                            ) : (
                              <div className="border border-dashed rounded p-3 text-center bg-secondary/15 flex flex-col items-center justify-center h-full">
                                <FileCheck className="size-5 text-emerald-600 mb-1" />
                                <span className="text-[11px] font-semibold text-emerald-800">In-App Automated Verification</span>
                                <span className="text-[10px] text-muted-foreground mt-0.5">Evidence resides directly in platform database modules.</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground border-t pt-3">
        Adapted from the AMFI Due-Diligence audit checklist. Mark each item as you assemble evidence;
        readiness updates live. "In-app" items are produced by this platform; "Document" items are
        files/SOPs you maintain (upload under Documents / SOP Library).
      </p>
    </div>
  );
}
