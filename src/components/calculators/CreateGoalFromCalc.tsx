"use client";

/**
 * "Create Goal from this calculation" — turns a calculator result into a real
 * client goal in one step.
 *
 * Note on the client picker: CommandClientPicker is a URL-driven filter
 * (selectedId/selectedName → router.push(?client=…)), not a value/onChange
 * field, so it doesn't fit a controlled modal. We fall back to a labelled
 * typeahead backed by GET /api/investors?q=… as the prompt allows.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Save, Search, User, X } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";

type Investor = { id: string; name: string; pan?: string | null };

const CATEGORY_OPTIONS = [
  { value: "retirement", label: "Retirement" },
  { value: "child_education", label: "Child education" },
  { value: "child_marriage", label: "Child marriage" },
  { value: "house", label: "House" },
  { value: "car", label: "Car" },
  { value: "vacation", label: "Vacation" },
  { value: "emergency_fund", label: "Emergency fund" },
  { value: "wealth_creation", label: "Wealth creation" },
  { value: "other", label: "Other" },
];

export function CreateGoalFromCalc({
  open,
  onClose,
  defaults,
  prefill,
  clientName,
}: {
  open: boolean;
  onClose: () => void;
  defaults: { returnPct: number; inflationPct: number };
  prefill?: { name?: string; targetAmount?: number; targetYears?: number };
  clientName?: string;
}) {
  const toast = useToast();

  const [investorId, setInvestorId] = useState("");
  const [investorName, setInvestorName] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Investor[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("wealth_creation");
  const [targetAmount, setTargetAmount] = useState<number>(0);
  const [targetYears, setTargetYears] = useState<number>(10);
  const [expectedReturnPct, setExpectedReturnPct] = useState<number>(defaults.returnPct);
  const [inflationPct, setInflationPct] = useState<number>(defaults.inflationPct);
  const [currentValue, setCurrentValue] = useState<number>(0);
  const [existingMonthlySip, setExistingMonthlySip] = useState<number>(0);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // (Re)seed defaults each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setInvestorId("");
    setInvestorName("");
    setQ("");
    setHits([]);
    setPickerOpen(false);
    setName(prefill?.name ?? (clientName ? `${clientName}'s goal` : ""));
    setCategory("wealth_creation");
    setTargetAmount(prefill?.targetAmount ?? 0);
    setTargetYears(prefill?.targetYears ?? 10);
    setExpectedReturnPct(defaults.returnPct);
    setInflationPct(defaults.inflationPct);
    setCurrentValue(0);
    setExistingMonthlySip(0);
    setBusy(false);
    setErr(null);
  }, [open, prefill, clientName, defaults.returnPct, defaults.inflationPct]);

  // Close the picker dropdown on outside click.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Escape closes the modal (unless busy).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  // Debounced investor search.
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    let active = true;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/investors?q=${encodeURIComponent(q)}`);
        const j = await r.json();
        if (active) setHits(((j.rows ?? []) as Investor[]).slice(0, 8));
      } catch {
        if (active) setHits([]);
      }
    }, 220);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [q]);

  if (!open) return null;

  function pick(inv: Investor) {
    setInvestorId(inv.id);
    setInvestorName(inv.name);
    setPickerOpen(false);
    setQ("");
    setHits([]);
  }

  const canSubmit = !!investorId && targetAmount > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    const targetDate = new Date();
    targetDate.setFullYear(targetDate.getFullYear() + (Number(targetYears) || 0));
    try {
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          investorId,
          name: name.trim() || `${investorName} goal`,
          category,
          targetAmount: Number(targetAmount),
          targetDate: targetDate.toISOString(),
          targetMode: "future",
          expectedReturnPct: Number(expectedReturnPct),
          inflationPct: Number(inflationPct),
          currentValue: Number(currentValue) || 0,
          existingMonthlySip: Number(existingMonthlySip) || 0,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `Could not create goal (${res.status})`);
        return;
      }
      const sip = Number(j.requiredMonthlySipTotal ?? 0);
      toast.success(
        `Goal created for ${investorName} — ₹${Math.round(sip).toLocaleString("en-IN")}/mo needed`,
        "Goal created"
      );
      onClose();
    } catch {
      setErr("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 grid place-items-center p-4"
      onClick={busy ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create goal from calculation"
        className="card-surface w-full max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h3 className="font-semibold text-foreground">Create goal from this calculation</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Client picker */}
        <Field label="Client">
          {investorId ? (
            <div className="input-base flex items-center gap-2">
              <User className="size-4 text-muted-foreground shrink-0" />
              <span className="font-medium truncate flex-1">{investorName}</span>
              <button
                type="button"
                onClick={() => {
                  setInvestorId("");
                  setInvestorName("");
                }}
                aria-label="Change client"
                className="text-muted-foreground hover:text-rose-600 shrink-0"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : (
            <div ref={pickerRef} className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPickerOpen(true);
                }}
                onFocus={() => hits.length > 0 && setPickerOpen(true)}
                placeholder="Search client by name or PAN…"
                className="input-base pl-8"
              />
              {pickerOpen && hits.length > 0 && (
                <div className="absolute left-0 right-0 mt-1 z-10 card-elevated bg-card max-h-56 overflow-y-auto scrollbar-thin">
                  <ul className="py-1">
                    {hits.map((h) => (
                      <li key={h.id}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pick(h)}
                          className="w-full text-left px-3 py-1.5 hover:bg-brand-cyan-light/40 transition-colors"
                        >
                          <span className="font-medium text-sm">{h.name}</span>
                          {h.pan && (
                            <span className="text-[11px] text-muted-foreground ml-2 font-mono">{h.pan}</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Field>

        <Field label="Goal name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Retirement corpus"
            className="input-base"
          />
        </Field>

        <Field label="Category">
          <SelectField value={category} onChange={(e) => setCategory(e.target.value)} options={CATEGORY_OPTIONS} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Target amount ₹">
            <input
              type="number"
              min={0}
              value={targetAmount}
              onChange={(e) => setTargetAmount(Number(e.target.value))}
              className="input-base"
            />
          </Field>
          <Field label="Target in (years)">
            <input
              type="number"
              min={0}
              value={targetYears}
              onChange={(e) => setTargetYears(Number(e.target.value))}
              className="input-base"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Expected return %">
            <input
              type="number"
              step="0.1"
              value={expectedReturnPct}
              onChange={(e) => setExpectedReturnPct(Number(e.target.value))}
              className="input-base"
            />
          </Field>
          <Field label="Inflation %">
            <input
              type="number"
              step="0.1"
              value={inflationPct}
              onChange={(e) => setInflationPct(Number(e.target.value))}
              className="input-base"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Current value ₹">
            <input
              type="number"
              min={0}
              value={currentValue}
              onChange={(e) => setCurrentValue(Number(e.target.value))}
              className="input-base"
            />
          </Field>
          <Field label="Existing monthly SIP ₹">
            <input
              type="number"
              min={0}
              value={existingMonthlySip}
              onChange={(e) => setExistingMonthlySip(Number(e.target.value))}
              className="input-base"
            />
          </Field>
        </div>

        {err && (
          <div className="border border-destructive/30 bg-destructive/5 text-destructive rounded-lg px-3 py-2 text-sm">
            {err}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <a href="/dashboard/goals" className="text-xs text-muted-foreground hover:text-foreground underline">
            View all goals
          </a>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="btn-secondary text-sm disabled:opacity-50">
              Cancel
            </button>
            <button type="button" onClick={submit} disabled={!canSubmit} className="btn-primary disabled:opacity-50">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Create goal
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-foreground/80 mb-1.5">{label}</div>
      {children}
    </label>
  );
}
