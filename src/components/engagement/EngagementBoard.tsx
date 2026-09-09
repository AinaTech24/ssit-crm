"use client";

/**
 * Client engagement board.
 *
 * One screen for the gifting programme: log a gift against a client, see how
 * many went out (firm-wide and per RM, for today / this month / this year), and
 * read the month as a calendar so a week with nothing in it is visible at a
 * glance rather than inferred from a list.
 *
 * The assigned RM is not an input. Picking a client fills it in, read-only —
 * the server attributes the gift from the client record regardless of what the
 * form shows, and showing a field the server ignores would be a lie.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Gift, ChevronLeft, ChevronRight, Loader2, UserCircle2 } from "lucide-react";
import { InvestorLookup } from "@/components/common/InvestorLookup";
import { readApiError, readThrownError } from "@/lib/api/client-error";
import {
  GIFT_CATEGORIES,
  GIFT_CATEGORY_LABEL,
  GIFT_GRADES_BY_CATEGORY,
  type GiftCategory,
} from "@/lib/gifts/catalogue";
import { formatDate, formatINR } from "@/lib/utils";

type GiftRow = {
  id: string;
  investorId: string;
  clientName: string | null;
  rmName: string | null;
  category: string | null;
  grade: string | null;
  label: string;
  amount: number;
  givenOn: string;
  deliveredOn: string | null;
  notes: string | null;
};

type Payload = {
  month: string;
  gifts: GiftRow[];
  totals: { total: number; today: number; month: number; year: number; delivered: number; spendYtd: number };
  perRm: Array<{ rmId: string | null; rmName: string; day: number; month: number; year: number; total: number }>;
  byCategory: Array<{ category: string; grade: string; count: number }>;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

/** "2026-09" → "2026-08" / "2026-10", without tripping over year boundaries. */
function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function EngagementBoard({ canLog }: { canLog: boolean }) {
  const [month, setMonth] = useState(() => todayIso().slice(0, 7));
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // form
  const [investorId, setInvestorId] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);
  const [rmName, setRmName] = useState<string | null>(null);
  const [rmLoading, setRmLoading] = useState(false);
  const [category, setCategory] = useState<GiftCategory>("hamper");
  const [grade, setGrade] = useState<string>("A");
  const [givenOn, setGivenOn] = useState(todayIso);
  const [deliveredOn, setDeliveredOn] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/engagement/gifts?month=${m}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await readApiError(res, "load engagement data")).message);
      setData(await res.json());
    } catch (err) {
      setError(readThrownError(err, "load engagement data").message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(month);
  }, [month, load]);

  // Grades are per category — switching from hamper to cake must not leave a
  // AAA selected that the server would then reject.
  useEffect(() => {
    const allowed = GIFT_GRADES_BY_CATEGORY[category];
    if (!allowed.includes(grade)) setGrade(allowed[0]);
  }, [category, grade]);

  async function pickClient(id: string, name: string) {
    setInvestorId(id);
    setClientName(name);
    setRmName(null);
    setRmLoading(true);
    try {
      const res = await fetch(`/api/investors/${id}/rm`, { cache: "no-store" });
      if (res.ok) {
        const r = await res.json();
        // The servicing RM is who actually hands the gift over when one is set.
        setRmName(r.serviceRmName ?? r.rmName ?? null);
      }
    } catch {
      // A missing RM name is cosmetic — the server attributes the gift anyway.
    } finally {
      setRmLoading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!investorId) return;
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch("/api/engagement/gifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          investorId,
          category,
          grade,
          givenOn,
          deliveredOn: deliveredOn || null,
          amount: amount ? Number(amount) : 0,
          notes: notes || null,
        }),
      });
      if (!res.ok) throw new Error((await readApiError(res, "log the gift")).message);
      const g = await res.json();
      setSaved(`${g.label} logged for ${g.clientName ?? "client"}.`);
      setInvestorId(null);
      setClientName(null);
      setRmName(null);
      setAmount("");
      setNotes("");
      setDeliveredOn("");
      // A gift dated in the month on screen should appear without a manual
      // refresh; one dated elsewhere still updates the firm-wide counters.
      await load(month);
    } catch (err) {
      setError(readThrownError(err, "log the gift").message);
    } finally {
      setSaving(false);
    }
  }

  // ---- calendar ---------------------------------------------------------
  const calendar = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    // Monday-first, the way Indian office calendars read.
    const lead = (first.getUTCDay() + 6) % 7;
    const byDay = new Map<string, GiftRow[]>();
    for (const g of data?.gifts ?? []) {
      const key = String(g.givenOn).slice(0, 10);
      const list = byDay.get(key) ?? [];
      list.push(g);
      byDay.set(key, list);
    }
    const cells: Array<{ date: string | null; gifts: GiftRow[] }> = [];
    for (let i = 0; i < lead; i++) cells.push({ date: null, gifts: [] });
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${month}-${String(d).padStart(2, "0")}`;
      cells.push({ date, gifts: byDay.get(date) ?? [] });
    }
    while (cells.length % 7 !== 0) cells.push({ date: null, gifts: [] });
    return cells;
  }, [month, data]);

  const t = data?.totals;

  return (
    <div className="space-y-6">
      {error && (
        <div className="border border-danger/40 bg-danger/10 text-danger rounded-lg px-4 py-2.5 text-sm">{error}</div>
      )}
      {saved && (
        <div className="border border-success/40 bg-success/10 text-success rounded-lg px-4 py-2.5 text-sm">{saved}</div>
      )}

      {/* Firm-wide counters. */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label="Total gifts" value={t?.total ?? 0} />
        <Stat label="Today" value={t?.today ?? 0} />
        <Stat label="This month" value={t?.month ?? 0} />
        <Stat label="This year" value={t?.year ?? 0} />
        <Stat label="Spend (YTD)" value={formatINR(t?.spendYtd ?? 0)} />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* ---- log a gift ---- */}
        {canLog && (
          <form onSubmit={submit} className="border rounded-lg bg-card p-4 space-y-3 lg:col-span-1">
            <div className="font-medium flex items-center gap-2">
              <Gift className="size-4" /> Log a gift
            </div>

            <div>
              <label className="text-xs font-medium block mb-1">Client</label>
              <InvestorLookup
                value={investorId}
                displayName={clientName}
                onSelect={(id, name) => void pickClient(id, name)}
                onClear={() => {
                  setInvestorId(null);
                  setClientName(null);
                  setRmName(null);
                }}
                placeholder="Search client by name, PAN or mobile…"
              />
            </div>

            {/* Read-only: attribution comes from the client record, not this form. */}
            <div className="flex items-center gap-2 text-sm rounded-md border bg-muted/30 px-3 py-2">
              <UserCircle2 className="size-4 text-muted-foreground" />
              <span className="text-muted-foreground">Assigned RM</span>
              <span className="ml-auto font-medium">
                {rmLoading ? <Loader2 className="size-3.5 animate-spin" /> : (rmName ?? "—")}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium block mb-1">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as GiftCategory)}
                  className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
                >
                  {GIFT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {GIFT_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">Grade</label>
                <select
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                  className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
                >
                  {GIFT_GRADES_BY_CATEGORY[category].map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium block mb-1">Given on</label>
                <input
                  type="date"
                  value={givenOn}
                  onChange={(e) => setGivenOn(e.target.value)}
                  required
                  className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
                />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">
                  Delivered on
                  <span className="ml-1 text-[10px] text-muted-foreground font-normal">· notifies the RM</span>
                </label>
                <input
                  type="date"
                  value={deliveredOn}
                  onChange={(e) => setDeliveredOn(e.target.value)}
                  className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium block mb-1">Cost (₹)</label>
              <input
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
              />
            </div>

            <div>
              <label className="text-xs font-medium block mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
              />
            </div>

            <button
              type="submit"
              disabled={!investorId || saving}
              className="w-full rounded-md bg-brand-cyan-deep text-white text-sm font-medium py-2 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Log gift"}
            </button>
          </form>
        )}

        {/* ---- per-RM counts ---- */}
        <div className={`border rounded-lg bg-card ${canLog ? "lg:col-span-2" : "lg:col-span-3"}`}>
          <div className="border-b px-4 py-2.5 font-medium">Gifts per RM</div>
          {(data?.perRm.length ?? 0) === 0 ? (
            <div className="px-4 py-8 text-sm text-muted-foreground text-center">No gifts logged yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground bg-muted/40">
                  <tr>
                    <th className="text-left font-medium px-4 py-2">RM</th>
                    <th className="text-right font-medium px-3 py-2">Today</th>
                    <th className="text-right font-medium px-3 py-2">This month</th>
                    <th className="text-right font-medium px-3 py-2">This year</th>
                    <th className="text-right font-medium px-4 py-2">All time</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data!.perRm.map((r) => (
                    <tr key={r.rmId ?? "none"} className="hover:bg-accent/30">
                      <td className="px-4 py-2 font-medium">{r.rmName}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.day}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.month}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.year}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">{r.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ---- calendar ---- */}
      <div className="border rounded-lg bg-card">
        <div className="border-b px-4 py-2.5 flex items-center justify-between gap-2">
          <span className="font-medium">Engagement calendar</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMonth((m) => shiftMonth(m, -1))}
              className="p-1 rounded hover:bg-accent"
              aria-label="Previous month"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-sm font-medium w-36 text-center">{monthLabel(month)}</span>
            <button
              type="button"
              onClick={() => setMonth((m) => shiftMonth(m, 1))}
              className="p-1 rounded hover:bg-accent"
              aria-label="Next month"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
        {loading ? (
          <div className="px-4 py-10 text-sm text-muted-foreground text-center">Loading…</div>
        ) : (
          <div className="p-3">
            <div className="grid grid-cols-7 gap-1 text-[11px] text-muted-foreground mb-1">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <div key={d} className="px-1">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {calendar.map((cell, i) => (
                <div
                  key={i}
                  className={`min-h-20 rounded-md border p-1 text-xs ${
                    cell.date ? "bg-background" : "bg-muted/20 border-transparent"
                  }`}
                >
                  {cell.date && (
                    <>
                      <div className="text-[10px] text-muted-foreground mb-1">{Number(cell.date.slice(8))}</div>
                      {cell.gifts.slice(0, 3).map((g) => (
                        <div
                          key={g.id}
                          className="truncate rounded bg-brand-cyan-deep/10 text-brand-cyan-deep px-1 py-0.5 mb-0.5"
                          title={`${g.label} — ${g.clientName ?? ""}${g.rmName ? ` (${g.rmName})` : ""}`}
                        >
                          {g.clientName ?? g.label}
                        </div>
                      ))}
                      {cell.gifts.length > 3 && (
                        <div className="text-[10px] text-muted-foreground">+{cell.gifts.length - 3} more</div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ---- the month, as a list ---- */}
      <div className="border rounded-lg bg-card">
        <div className="border-b px-4 py-2.5 font-medium">
          Gifts in {monthLabel(month)}
          <span className="ml-2 text-xs text-muted-foreground font-normal">({data?.gifts.length ?? 0})</span>
        </div>
        {(data?.gifts.length ?? 0) === 0 ? (
          <div className="px-4 py-8 text-sm text-muted-foreground text-center">Nothing logged this month.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground bg-muted/40">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Client</th>
                  <th className="text-left font-medium px-3 py-2">Gift</th>
                  <th className="text-left font-medium px-3 py-2">RM</th>
                  <th className="text-left font-medium px-3 py-2">Given</th>
                  <th className="text-left font-medium px-3 py-2">Delivered</th>
                  <th className="text-right font-medium px-4 py-2">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data!.gifts.map((g) => (
                  <tr key={g.id} className="hover:bg-accent/30">
                    <td className="px-4 py-2 font-medium">{g.clientName ?? "—"}</td>
                    <td className="px-3 py-2">{g.label}</td>
                    <td className="px-3 py-2">{g.rmName ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(g.givenOn)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {g.deliveredOn ? (
                        formatDate(g.deliveredOn)
                      ) : (
                        <span className="text-muted-foreground">Pending</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{g.amount ? formatINR(g.amount) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="border rounded-lg bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
