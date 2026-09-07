"use client";

/**
 * Birthday gifts & budget — per-client relationship widget.
 *
 * Shows the client's next birthday (computed client-side from dob, ignoring
 * year), an allocate-able gift budget with spent/remaining, and a log of gifts
 * given. All mutations hit /api/investors/[id]/gifts and refetch local state.
 */

import { useCallback, useEffect, useState } from "react";
import { Cake, Gift, Trash2, Plus, Loader2, Check, Truck } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";

type GiftRow = {
  id: string;
  occasion: string;
  title: string;
  amount: number;
  givenOn: string;
  deliveredOn: string | null;
  notes: string | null;
  createdAt: string;
};

type GiftsData = {
  dob: string | null;
  budget: number | null;
  spent: number;
  gifts: GiftRow[];
};

const inr = (n: number) => n.toLocaleString("en-IN");

function fmtDayMonth(dob: string): string {
  // dob is yyyy-mm-dd — parse the parts directly to avoid TZ drift.
  const [, m, d] = dob.split("-").map(Number);
  const date = new Date(2000, (m || 1) - 1, d || 1);
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** Days until the next birthday (ignoring year). 0 = today. */
function daysUntilBirthday(dob: string): number {
  const [, m, d] = dob.split("-").map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), (m || 1) - 1, d || 1);
  if (next.getTime() < today.getTime()) {
    next = new Date(now.getFullYear() + 1, (m || 1) - 1, d || 1);
  }
  return Math.round((next.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ClientGifts({ investorId, clientName }: { investorId: string; clientName: string }) {
  const [data, setData] = useState<GiftsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Budget editor
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");
  const [savingBudget, setSavingBudget] = useState(false);

  // Add-gift form
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [occasion, setOccasion] = useState("birthday");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [givenOn, setGivenOn] = useState(() => new Date().toISOString().slice(0, 10));
  // Blank = logged but not delivered yet. Setting it intimates the client's RM.
  const [deliveredOn, setDeliveredOn] = useState("");
  const [deliveringId, setDeliveringId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/investors/${investorId}/gifts`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to load gifts");
      setData((await res.json()) as GiftsData);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [investorId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveBudget() {
    setSavingBudget(true);
    setError(null);
    try {
      const trimmed = budgetInput.trim();
      const budget = trimmed === "" ? null : Math.max(0, Math.round(Number(trimmed)));
      if (budget != null && Number.isNaN(budget)) throw new Error("Enter a valid amount");
      const res = await fetch(`/api/investors/${investorId}/gifts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budget }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to save budget");
      setEditingBudget(false);
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to save budget");
    } finally {
      setSavingBudget(false);
    }
  }

  async function addGift(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/investors/${investorId}/gifts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          occasion,
          title: title.trim(),
          deliveredOn: deliveredOn || null,
          amount: amount.trim() === "" ? 0 : Math.max(0, Math.round(Number(amount))),
          givenOn,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to add gift");
      // reset
      setOccasion("birthday");
      setTitle("");
      setAmount("");
      setGivenOn(new Date().toISOString().slice(0, 10));
      setDeliveredOn("");
      setNotes("");
      setShowForm(false);
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to add gift");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Records delivery for a gift already in the log. The API intimates the
   * client's RM exactly once (rm_notified_at), so pressing this twice is safe.
   */
  async function markDelivered(giftId: string) {
    setError(null);
    setDeliveringId(giftId);
    try {
      const res = await fetch(`/api/investors/${investorId}/gifts/${giftId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deliveredOn: new Date().toISOString().slice(0, 10) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to update");
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to mark delivered");
    } finally {
      setDeliveringId(null);
    }
  }

  async function removeGift(giftId: string) {
    setError(null);
    try {
      const res = await fetch(`/api/investors/${investorId}/gifts/${giftId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to delete");
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to delete gift");
    }
  }

  const remaining = data && data.budget != null ? data.budget - data.spent : null;

  return (
    <div className="card-surface border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4 gap-2">
        <h2 className="font-semibold flex items-center gap-2">
          <div className="size-7 rounded-lg bg-pink-50 grid place-items-center">
            <Cake className="size-3.5 text-pink-600" />
          </div>
          Birthday gifts &amp; budget
        </h2>
        {!loading && (
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md border hover:bg-muted transition-colors"
          >
            <Plus className="size-3.5" />
            Add gift
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {error && (
            <div className="mb-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          {/* Birthday line */}
          <div className="mb-4 text-sm">
            {data?.dob ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-muted-foreground">Birthday</span>
                <span className="font-medium">{fmtDayMonth(data.dob)}</span>
                {(() => {
                  const n = daysUntilBirthday(data.dob);
                  const today = n === 0;
                  return (
                    <span
                      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-semibold ${
                        today
                          ? "bg-pink-100 text-pink-700 border-pink-200"
                          : "bg-muted text-foreground/80 border-border"
                      }`}
                    >
                      {today ? "🎂 Today!" : `🎂 in ${n} day${n === 1 ? "" : "s"}`}
                    </span>
                  );
                })()}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No date of birth on record — add it in Client details.
              </p>
            )}
          </div>

          {/* Budget row */}
          <div className="mb-4 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm">
                <span className="text-muted-foreground">Gift budget</span>{" "}
                <span className="font-semibold tabular-nums">
                  {data?.budget != null ? `₹${inr(data.budget)}` : "Not set"}
                </span>
              </div>
              {!editingBudget && (
                <button
                  type="button"
                  onClick={() => {
                    setBudgetInput(data?.budget != null ? String(data.budget) : "");
                    setEditingBudget(true);
                  }}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  {data?.budget != null ? "Edit" : "Allocate"}
                </button>
              )}
            </div>

            {editingBudget && (
              <div className="mt-2 flex items-center gap-2">
                <div className="relative flex-1 max-w-[180px]">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">₹</span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={budgetInput}
                    onChange={(e) => setBudgetInput(e.target.value)}
                    placeholder="Amount"
                    className="input-base pl-6 w-full"
                    autoFocus
                  />
                </div>
                <button
                  type="button"
                  onClick={saveBudget}
                  disabled={savingBudget}
                  className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {savingBudget && <Loader2 className="size-3 animate-spin" />}
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditingBudget(false)}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  Cancel
                </button>
              </div>
            )}

            {data?.budget != null && (
              <div className="mt-2 flex items-center gap-4 text-xs">
                <span className="text-muted-foreground">
                  Spent <span className="font-semibold text-foreground tabular-nums">₹{inr(data.spent)}</span>
                </span>
                <span className="text-muted-foreground">
                  Remaining{" "}
                  <span
                    className={`font-semibold tabular-nums ${
                      remaining != null && remaining <= 0 ? "text-rose-600" : "text-emerald-700"
                    }`}
                  >
                    ₹{inr(remaining ?? 0)}
                  </span>
                </span>
              </div>
            )}
          </div>

          {/* Add gift form */}
          {showForm && (
            <form onSubmit={addGift} className="mb-4 rounded-lg border bg-card p-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Occasion</label>
                  <SelectField value={occasion} onChange={(e) => setOccasion(e.target.value)}>
                    <option value="birthday">Birthday</option>
                    <option value="anniversary">Anniversary</option>
                    <option value="festival">Festival</option>
                    <option value="other">Other</option>
                  </SelectField>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Given on</label>
                  <DateField value={givenOn} onChange={(e) => setGivenOn(e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Delivered on <span className="font-normal">(optional)</span>
                  </label>
                  <DateField value={deliveredOn} onChange={(e) => setDeliveredOn(e.target.value)} />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Leave blank if it has not reached the client yet — you can mark it delivered later. Setting
                    a date notifies the client&apos;s RM.
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Title</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Sweet box & card"
                    maxLength={120}
                    required
                    className="input-base w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Amount (₹)</label>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                    className="input-base w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Optional"
                    maxLength={500}
                    className="input-base w-full"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {busy && <Loader2 className="size-3 animate-spin" />}
                  Save gift
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Gifts list */}
          {data && data.gifts.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              No gifts logged yet for {clientName}.
            </p>
          ) : (
            <ul className="space-y-2">
              {data?.gifts.map((g) => (
                <li
                  key={g.id}
                  className="flex items-start gap-3 rounded-lg border bg-card px-3 py-2"
                >
                  <div className="size-7 rounded-lg bg-pink-50 grid place-items-center flex-shrink-0 mt-0.5">
                    <Gift className="size-3.5 text-pink-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-semibold">
                        {cap(g.occasion)}
                      </span>
                      <span className="font-medium text-sm truncate">{g.title}</span>
                      <span className="text-sm font-semibold tabular-nums">₹{inr(g.amount)}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>{fmtDate(g.givenOn)}</span>
                      {g.deliveredOn ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <Check className="size-3" /> Delivered {fmtDate(g.deliveredOn)}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => markDelivered(g.id)}
                          disabled={deliveringId === g.id}
                          className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 hover:bg-accent disabled:opacity-50"
                          title="Records delivery and notifies the client's RM"
                        >
                          {deliveringId === g.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Truck className="size-3" />
                          )}
                          Mark delivered
                        </button>
                      )}
                      {g.notes ? <span className="italic">{g.notes}</span> : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeGift(g.id)}
                    aria-label="Delete gift"
                    className="text-muted-foreground hover:text-rose-600 transition-colors flex-shrink-0 mt-0.5"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
