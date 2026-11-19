"use client";

/**
 * "Export" beside Meeting details: pick a period (month / year / custom dates /
 * all time) and, where the person may, a department and an RM, then download the
 * meetings as Excel with the whole meeting record and the client's details.
 *
 * The filters are only a narrowing. Who may see which meetings is decided on the
 * server by the same wall as the list (an RM exports their own, a head their team's,
 * the owner everyone's), so nothing here can widen it.
 */

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { periodRange } from "@/lib/review-meetings/export-period";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";

type Unit = { value: string; label: string; depth: number };
type Rm = { value: string; label: string };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const STATUSES: Array<[string, string]> = [
  ["", "All statuses"],
  ["scheduled", "Scheduled"],
  ["confirmed", "Confirmed"],
  ["in_progress", "In progress"],
  ["completed", "Completed"],
  ["rescheduled", "Rescheduled"],
  ["cancelled", "Cancelled"],
  ["no_show", "No show"],
];
const CATEGORIES: Array<[string, string]> = [
  ["", "All types"],
  ["review", "Review"],
  ["new", "New"],
  ["follow_up", "Follow-up"],
];

export function ExportMeetingsButton({ units, rms }: { units: Unit[]; rms: Rm[] }) {
  const now = new Date();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"month" | "year" | "custom" | "all">("month");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [unit, setUnit] = useState("");
  const [rm, setRm] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const years = Array.from({ length: 7 }, (_, i) => now.getFullYear() - 5 + i).reverse();
  const customInvalid = mode === "custom" && (!from || !to || from > to);

  async function download() {
    setBusy(true);
    setErr(null);
    try {
      const p = new URLSearchParams();
      const range = periodRange(mode, year, month, from, to);
      if (range) {
        p.set("meeting_from", range.from);
        p.set("meeting_to", range.to);
      }
      if (unit) p.set("unit", unit);
      if (rm) p.set("rm", rm);
      if (status) p.set("status", status);
      if (category) p.set("category", category);
      const r = await fetch(`/api/review-meetings/export?${p.toString()}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Could not export");
      const rows = r.headers.get("X-Row-Count");
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `meetings-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      if (rows === "0") setErr("No meetings matched these filters - the file only has a header.");
      else setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not export");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
      >
        <Download className="size-3.5" /> Export
      </button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export meetings</DialogTitle>
            <DialogDescription>
              Excel file with every meeting detail and the client&apos;s details. Documents are not included.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-3 text-sm">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Period</span>
              <select className="input-base w-full" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="month">A month</option>
                <option value="year">A whole year</option>
                <option value="custom">Between two dates</option>
                <option value="all">All time</option>
              </select>
            </label>

            {(mode === "month" || mode === "year") && (
              <div className="grid grid-cols-2 gap-3">
                {mode === "month" && (
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">Month</span>
                    <select className="input-base w-full" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                      {MONTHS.map((m, i) => (
                        <option key={m} value={i + 1}>{m}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className={`block space-y-1 ${mode === "year" ? "col-span-2" : ""}`}>
                  <span className="text-xs font-medium text-muted-foreground">Year</span>
                  <select className="input-base w-full" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                    {years.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {mode === "custom" && (
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">From</span>
                  <input type="date" className="input-base w-full" value={from} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">To</span>
                  <input type="date" className="input-base w-full" value={to} onChange={(e) => setTo(e.target.value)} />
                </label>
              </div>
            )}

            {units.length > 0 && (
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Department / sub-branch</span>
                <select className="input-base w-full" value={unit} onChange={(e) => setUnit(e.target.value)}>
                  <option value="">All departments</option>
                  {units.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.depth > 0 ? "  " : ""}
                      {u.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {rms.length > 1 && (
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">RM</span>
                <select className="input-base w-full" value={rm} onChange={(e) => setRm(e.target.value)}>
                  <option value="">All RMs</option>
                  {rms.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </label>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Status</span>
                <select className="input-base w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
                  {STATUSES.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Meeting category</span>
                <select className="input-base w-full" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORIES.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </label>
            </div>

            {err && <div className="text-xs text-rose-600">{err}</div>}
          </div>

          <DialogFooter>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn-primary" disabled={busy || customInvalid} onClick={download}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Download Excel
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
