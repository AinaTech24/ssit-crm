"use client";

/**
 * Detail-page calculator. Loads the goal's saved values, lets RM dial in
 * assumptions (return, inflation, step-up), and patches the goal on Save.
 *
 * Same visual language as the create form — sensitivity strip, three-way plan
 * tiles, year-by-year projection, formula explainer.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Loader2, TrendingUp, BarChart3, Calculator, RotateCcw } from "lucide-react";
import {
  computeGoal,
  monthsBetween,
  projectYearly,
  sensitivitySipRates,
} from "@/lib/goal-planning/calc";
import { formatINR } from "@/lib/utils";
import { SelectField } from "@/components/ui/SelectField";
import { GLIDE_PATH_LABELS, type GlidePath } from "@/lib/goal-planning/glide-path";

const STATUS_TONE: Record<string, string> = {
  not_started: "bg-gray-100 text-gray-700 border-gray-200",
  on_track: "bg-emerald-50 text-emerald-700 border-emerald-200",
  behind_track: "bg-amber-50 text-amber-700 border-amber-200",
  achieved: "bg-blue-50 text-blue-700 border-blue-200",
};

export function GoalDetailCalculator({ goal }: { goal: any }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const initial = () => {
    const mode = goal.targetMode ?? "future";
    return {
      name: goal.name ?? "",
      targetMode: mode as "today" | "future",
      targetAmount: mode === "today"
        ? String(Math.round(Number(goal.presentTargetAmount ?? goal.targetAmount ?? 0)))
        : String(Math.round(Number(goal.targetAmount ?? 0))),
      targetYear: String(new Date(goal.targetDate).getFullYear()),
      currentValue: String(Math.round(Number(goal.currentValue ?? 0))),
      existingMonthlySip: String(Math.round(Number(goal.existingMonthlySip ?? goal.monthlyContribution ?? 0))),
      expectedReturnPct: String(Number(goal.expectedReturn ?? 12)),
      inflationPct: goal.inflationPct ? String(Number(goal.inflationPct)) : "6",
      stepUpPct: goal.stepUpPct ? String(Number(goal.stepUpPct)) : "10",
      glidePath: (goal.glidePath ?? "none") as GlidePath,
      remarks: goal.remarks ?? "",
    };
  };

  const [form, setForm] = useState(initial);

  function set<K extends keyof ReturnType<typeof initial>>(k: K, v: ReturnType<typeof initial>[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  const calc = useMemo(() => {
    const targetVal = parseFloat(form.targetAmount) || 0;
    const cur = parseFloat(form.currentValue) || 0;
    const sip = parseFloat(form.existingMonthlySip) || 0;
    const ret = parseFloat(form.expectedReturnPct) || 12;
    const infl = parseFloat(form.inflationPct) || 0;
    const step = parseFloat(form.stepUpPct) || 0;
    const year = parseInt(form.targetYear, 10);
    if (!targetVal || !year) return null;
    const targetDate = new Date(year, 11, 31);
    const monthsLeft = monthsBetween(new Date(), targetDate);
    return computeGoal({
      presentTarget: form.targetMode === "today" ? targetVal : undefined,
      futureTarget: form.targetMode === "future" ? targetVal : undefined,
      currentValue: cur,
      existingMonthlySip: sip,
      monthsLeft,
      expectedReturnPct: ret,
      inflationPct: infl,
      stepUpPct: step,
    });
  }, [form]);

  const sensitivity = useMemo(
    () => (calc ? sensitivitySipRates(calc.futureTarget, parseFloat(form.currentValue) || 0, calc.monthsLeft) : []),
    [calc, form.currentValue]
  );

  const projection = useMemo(() => {
    if (!calc) return [];
    return projectYearly({
      currentValue: parseFloat(form.currentValue) || 0,
      initialMonthlySip: calc.requiredStepUpInitialSip || calc.requiredMonthlySipTotal,
      annualReturnPct: calc.expectedReturnPct,
      stepUpPct: calc.stepUpPct,
      months: calc.monthsLeft,
    });
  }, [calc, form.currentValue]);

  const maxCorpus = useMemo(
    () => projection.reduce((mx, r) => Math.max(mx, r.endOfYearCorpus), 0),
    [projection]
  );

  async function save() {
    if (!calc) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const year = parseInt(form.targetYear, 10);
      const targetDateIso = new Date(year, 11, 31).toISOString().slice(0, 10);
      const res = await fetch(`/api/goals/${goal.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          targetAmount: Math.round(calc.futureTarget),
          targetMode: form.targetMode,
          presentTargetAmount: form.targetMode === "today" ? (parseFloat(form.targetAmount) || undefined) : undefined,
          inflationPct: parseFloat(form.inflationPct) || 0,
          stepUpPct: parseFloat(form.stepUpPct) || 0,
          glidePath: form.glidePath,
          targetDate: targetDateIso,
          currentValue: parseFloat(form.currentValue) || 0,
          existingMonthlySip: parseFloat(form.existingMonthlySip) || 0,
          expectedReturnPct: parseFloat(form.expectedReturnPct) || 12,
          remarks: form.remarks || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      setOk("Saved.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setForm(initial());
    setOk(null);
    setErr(null);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      {/* Editable assumptions */}
      <div className="lg:col-span-2 card-surface p-6 space-y-3 h-fit lg:sticky lg:top-20">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <Calculator className="size-4 text-brand-cyan" /> Assumptions
          </h2>
          <button onClick={reset} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            <RotateCcw className="size-3" /> Reset
          </button>
        </div>

        <Field label="Goal name">
          <input value={form.name} onChange={(e) => set("name", e.target.value)} className="input-base" />
        </Field>

        <div className="pt-1 border-t">
          <div className="text-xs font-semibold mb-1.5">Target amount expressed in</div>
          <div className="grid grid-cols-2 gap-2">
            <ToggleBtn active={form.targetMode === "today"} onClick={() => set("targetMode", "today")}>
              Today's value
            </ToggleBtn>
            <ToggleBtn active={form.targetMode === "future"} onClick={() => set("targetMode", "future")}>
              Target-date value
            </ToggleBtn>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">
            {form.targetMode === "today"
              ? "We'll inflate this to the target year using the inflation rate below."
              : "Amount is already in target-year rupees — no inflation applied."}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-2">
          <Field label={form.targetMode === "today" ? "Target amount (₹, today's)" : "Target amount (₹, future)"}>
            <input
              type="number"
              value={form.targetAmount}
              onChange={(e) => set("targetAmount", e.target.value)}
              className="input-base tabular-nums"
            />
          </Field>
          <Field label="Target year">
            <input
              type="number"
              value={form.targetYear}
              onChange={(e) => set("targetYear", e.target.value)}
              className="input-base tabular-nums"
            />
          </Field>
          <Field label="Current investment">
            <input
              type="number"
              value={form.currentValue}
              onChange={(e) => set("currentValue", e.target.value)}
              className="input-base tabular-nums"
            />
          </Field>
          <Field label="Existing monthly SIP">
            <input
              type="number"
              value={form.existingMonthlySip}
              onChange={(e) => set("existingMonthlySip", e.target.value)}
              className="input-base tabular-nums"
            />
          </Field>
          <Field label="Return % p.a.">
            <input
              type="number"
              value={form.expectedReturnPct}
              onChange={(e) => set("expectedReturnPct", e.target.value)}
              step={0.5}
              className="input-base tabular-nums"
            />
          </Field>
          <Field label="Inflation % p.a.">
            <input
              type="number"
              value={form.inflationPct}
              onChange={(e) => set("inflationPct", e.target.value)}
              step={0.5}
              className="input-base tabular-nums"
            />
          </Field>
          <Field label="SIP step-up % / yr">
            <input
              type="number"
              value={form.stepUpPct}
              onChange={(e) => set("stepUpPct", e.target.value)}
              step={1}
              className="input-base tabular-nums"
            />
          </Field>
        </div>

        <Field label="Glide path (de-risk near target)">
          <SelectField
            value={form.glidePath}
            onChange={(e) => set("glidePath", e.target.value as GlidePath)}
            className="w-full"
          >
            {(Object.entries(GLIDE_PATH_LABELS) as [GlidePath, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </SelectField>
          <p className="text-[11px] text-muted-foreground mt-1.5">
            Tapers the expected return as the target nears (shifts toward debt).
          </p>
        </Field>

        <Field label="Remarks">
          <textarea
            value={form.remarks}
            onChange={(e) => set("remarks", e.target.value)}
            rows={2}
            className="input-base"
          />
        </Field>

        {err && (
          <div className="border border-destructive/30 bg-destructive/5 text-destructive rounded-lg px-3 py-2 text-sm">
            {err}
          </div>
        )}
        {ok && (
          <div className="border border-emerald-200 bg-emerald-50 text-emerald-700 rounded-lg px-3 py-2 text-sm">
            {ok}
          </div>
        )}

        <div className="flex justify-end pt-2 border-t">
          <button onClick={save} disabled={busy} className="btn-primary">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {/* Live results — same layout as create form */}
      <div className="lg:col-span-3 space-y-4">
        {!calc ? (
          <div className="card-surface p-12 text-center text-sm text-muted-foreground">
            Provide target + year to see calculations.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className={`card-surface border-2 p-4 ${STATUS_TONE[calc.status]}`}>
                <div className="text-xs uppercase tracking-wide font-semibold opacity-70">Status</div>
                <div className="text-2xl font-bold capitalize mt-1">{calc.status.replace(/_/g, " ")}</div>
                <div className="text-xs mt-1 opacity-80">
                  {calc.monthsLeft} months · {calc.yearsLeft.toFixed(1)} years to target
                </div>
              </div>
              <div className="card-surface p-4">
                <div className="text-xs uppercase tracking-wide font-semibold text-muted-foreground">
                  Target at goal date
                </div>
                <div className="text-2xl font-bold mt-1 tabular-nums">
                  {formatINR(Math.round(calc.futureTarget))}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  ₹{Math.round(calc.futureTarget / Math.pow(1 + calc.inflationPct / 100, calc.yearsLeft)).toLocaleString("en-IN")}{" "}
                  in today's purchasing power · {calc.inflationPct}% inflation
                </div>
              </div>
            </div>

            <div className="card-surface p-5">
              <h3 className="font-semibold mb-3 text-sm flex items-center gap-2">
                <TrendingUp className="size-4 text-brand-cyan" /> Three ways to reach this goal
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <PlanCard
                  label="Flat monthly SIP"
                  value={formatINR(Math.round(calc.requiredMonthlySipTotal))}
                  sub="Same ₹ every month"
                  emphasis={calc.stepUpPct === 0}
                />
                <PlanCard
                  label="Step-up SIP (start)"
                  value={
                    calc.stepUpPct > 0
                      ? formatINR(Math.round(calc.requiredStepUpInitialSip))
                      : "—"
                  }
                  sub={
                    calc.stepUpPct > 0
                      ? `+${calc.stepUpPct}% every year`
                      : "Set step-up to see"
                  }
                  emphasis={calc.stepUpPct > 0}
                />
                <PlanCard
                  label="Lumpsum today"
                  value={formatINR(Math.round(calc.requiredLumpsumToday))}
                  sub="One-time, no SIP"
                />
              </div>
              {calc.additionalMonthlySipNeeded > 0 && (
                <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900 flex items-center justify-between">
                  <span>Additional flat SIP beyond existing ₹{Number(form.existingMonthlySip || 0).toLocaleString("en-IN")}/mo:</span>
                  <span className="font-bold tabular-nums">{formatINR(Math.round(calc.additionalMonthlySipNeeded))}/mo</span>
                </div>
              )}
              {calc.gapAmount > 0 && (
                <div className="mt-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-900 flex items-center justify-between">
                  <span>Gap if nothing changes:</span>
                  <span className="font-bold tabular-nums">{formatINR(Math.round(calc.gapAmount))}</span>
                </div>
              )}
            </div>

            <div className="card-surface p-5">
              <h3 className="font-semibold mb-3 text-sm flex items-center gap-2">
                <BarChart3 className="size-4 text-brand-cyan" /> Sensitivity — required SIP at different return rates
              </h3>
              <div className="grid grid-cols-4 gap-3">
                {sensitivity.map((s) => (
                  <div
                    key={s.ratePct}
                    className={`rounded-lg border p-3 text-center ${
                      Math.abs(s.ratePct - calc.expectedReturnPct) < 0.01
                        ? "border-brand-cyan bg-brand-cyan-light/30"
                        : "border-border"
                    }`}
                  >
                    <div className="text-xs text-muted-foreground">{s.ratePct}% p.a.</div>
                    <div className="text-lg font-bold tabular-nums mt-0.5">
                      {formatINR(Math.round(s.sip))}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">flat SIP</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card-surface p-5">
              <h3 className="font-semibold mb-3 text-sm">Year-by-year projection</h3>
              {projection.length > 0 && (
                <>
                  <div className="flex items-end gap-1 h-32 mb-3 border-b border-border pb-2">
                    {projection.map((row) => {
                      const h = maxCorpus > 0 ? (row.endOfYearCorpus / maxCorpus) * 100 : 0;
                      const filledByTarget = row.endOfYearCorpus / calc.futureTarget;
                      const color =
                        filledByTarget >= 1
                          ? "bg-emerald-500"
                          : filledByTarget >= 0.5
                          ? "bg-brand-cyan"
                          : "bg-brand-navy";
                      return (
                        <div
                          key={row.year}
                          className="flex-1 group relative"
                          style={{ minWidth: "4px" }}
                          title={`Year ${row.year}: ${formatINR(Math.round(row.endOfYearCorpus))}`}
                        >
                          <div
                            className={`${color} rounded-t transition-all`}
                            style={{ height: `${h}%`, minHeight: "2px" }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="max-h-64 overflow-y-auto scrollbar-thin rounded border border-border">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-secondary/60 text-muted-foreground">
                        <tr>
                          <th className="text-left px-2 py-1.5 font-medium">Year</th>
                          <th className="text-right px-2 py-1.5 font-medium">Monthly SIP</th>
                          <th className="text-right px-2 py-1.5 font-medium">Contributed</th>
                          <th className="text-right px-2 py-1.5 font-medium">Corpus EoY</th>
                          <th className="text-right px-2 py-1.5 font-medium">% to target</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projection.map((row) => {
                          const pct = (row.endOfYearCorpus / calc.futureTarget) * 100;
                          return (
                            <tr key={row.year} className="border-t border-border">
                              <td className="px-2 py-1.5 tabular-nums">{row.year}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">
                                {formatINR(Math.round(row.monthlySip))}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                                {formatINR(Math.round(row.cumulativeContributed))}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                                {formatINR(Math.round(row.endOfYearCorpus))}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums">
                                <span className={pct >= 100 ? "text-emerald-600" : "text-muted-foreground"}>
                                  {pct.toFixed(0)}%
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </>
        )}
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

function PlanCard({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: string;
  sub: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border-2 p-3 ${
        emphasis ? "border-brand-cyan bg-brand-cyan-light/30" : "border-border"
      }`}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold tabular-nums mt-0.5">{value}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{sub}</div>
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border-2 px-3 py-2 text-sm font-medium transition-all ${
        active
          ? "border-brand-cyan bg-brand-cyan-light/40 text-foreground"
          : "border-border bg-card text-muted-foreground hover:border-brand-cyan/40"
      }`}
    >
      {children}
    </button>
  );
}
