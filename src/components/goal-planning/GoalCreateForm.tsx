"use client";

/**
 * Calculator-first goal-create form.
 *
 * Inputs (left column):
 *   - Goal name + category
 *   - Target mode: "in today's value" (auto-inflated) vs "in target-date value"
 *   - Target amount + target year
 *   - Current investment linked + Existing monthly SIP
 *   - Expected return % p.a. + Inflation % p.a. + Annual SIP step-up %
 *   - Remarks
 *
 * Live formula panel (right column):
 *   - Inflation-adjusted future target
 *   - Required flat SIP, Required step-up initial SIP, Lumpsum-today alternative
 *   - Sensitivity strip: 8/10/12/15 % return rates
 *   - Year-by-year projection mini-chart + table
 *
 * On submit we POST the future-target so the API doesn't double-inflate.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, TrendingUp, Calculator, BarChart3 } from "lucide-react";
import {
  computeGoal,
  monthsBetween,
  projectYearly,
  sensitivitySipRates,
  GOAL_CATEGORIES,
} from "@/lib/goal-planning/calc";
import { formatINR } from "@/lib/utils";
import { SelectField } from "@/components/ui/SelectField";
import { GLIDE_PATH_LABELS, type GlidePath } from "@/lib/goal-planning/glide-path";
import { GOAL_TEMPLATES } from "@/lib/goal-planning/templates";

const STATUS_TONE: Record<string, string> = {
  not_started: "bg-gray-100 text-gray-700 border-gray-200",
  on_track: "bg-emerald-50 text-emerald-700 border-emerald-200",
  behind_track: "bg-amber-50 text-amber-700 border-amber-200",
  achieved: "bg-blue-50 text-blue-700 border-blue-200",
};

export function GoalCreateForm({
  investorId,
}: {
  investorId: string;
  investorName?: string;
}) {
  const router = useRouter();
  const nextYear = new Date().getFullYear() + 10;

  const [form, setForm] = useState({
    name: "",
    category: "retirement",
    targetMode: "today" as "today" | "future", // is the target in present or future money?
    targetAmount: "",
    targetYear: String(nextYear),
    currentValue: "",
    existingMonthlySip: "",
    expectedReturnPct: "12",
    inflationPct: "6",
    stepUpPct: "10",
    glidePath: "none" as GlidePath,
    remarks: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  function applyTemplate(t: (typeof GOAL_TEMPLATES)[number]) {
    setForm((s) => ({
      ...s,
      name: t.defaultName,
      category: t.category,
      targetYear: String(new Date().getFullYear() + t.horizonYears),
      glidePath: t.glidePath,
    }));
  }

  // Live compute on every keystroke
  const calc = useMemo(() => {
    const targetAmount = parseFloat(form.targetAmount) || 0;
    const cur = parseFloat(form.currentValue) || 0;
    const sip = parseFloat(form.existingMonthlySip) || 0;
    const ret = parseFloat(form.expectedReturnPct) || 12;
    const infl = parseFloat(form.inflationPct) || 0;
    const step = parseFloat(form.stepUpPct) || 0;
    const year = parseInt(form.targetYear, 10);
    if (!targetAmount || !year) return null;
    const targetDate = new Date(year, 11, 31);
    const monthsLeft = monthsBetween(new Date(), targetDate);
    return computeGoal({
      presentTarget: form.targetMode === "today" ? targetAmount : undefined,
      futureTarget: form.targetMode === "future" ? targetAmount : undefined,
      currentValue: cur,
      existingMonthlySip: sip,
      monthsLeft,
      expectedReturnPct: ret,
      inflationPct: infl,
      stepUpPct: step,
    });
  }, [
    form.targetMode,
    form.targetAmount,
    form.targetYear,
    form.currentValue,
    form.existingMonthlySip,
    form.expectedReturnPct,
    form.inflationPct,
    form.stepUpPct,
  ]);

  const sensitivity = useMemo(() => {
    if (!calc) return [];
    return sensitivitySipRates(calc.futureTarget, parseFloat(form.currentValue) || 0, calc.monthsLeft);
  }, [calc, form.currentValue]);

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
    try {
      const year = parseInt(form.targetYear, 10);
      const targetDateIso = new Date(year, 11, 31).toISOString().slice(0, 10);
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          investorId,
          name: form.name,
          category: form.category,
          // Persist the future-target (after inflation)
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
      router.push("/dashboard/goals");
    } finally {
      setBusy(false);
    }
  }

  const canSave = !!form.name && !!form.targetAmount && !!form.targetYear;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      {/* ─────────────────── Inputs ─────────────────── */}
      <div className="lg:col-span-2 card-surface p-6 space-y-3 h-fit">
        <h2 className="font-semibold flex items-center gap-2">
          <Calculator className="size-4 text-brand-cyan" /> Inputs
        </h2>

        <div>
          <div className="text-xs font-semibold text-foreground/80 mb-1.5">Start from a template</div>
          <div className="flex flex-wrap gap-1.5">
            {GOAL_TEMPLATES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => applyTemplate(t)}
                title={t.hint}
                className="rounded-full border border-border bg-card hover:bg-brand-cyan-light/30 hover:border-brand-cyan/40 px-3 py-1 text-xs font-medium transition-all"
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <Field label="Goal name">
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Riya's college fund"
            className="input-base"
          />
        </Field>
        <Field label="Category">
          <select value={form.category} onChange={(e) => set("category", e.target.value)} className="input-base">
            {GOAL_CATEGORIES.map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </Field>

        <div className="pt-2 border-t">
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
          <Field label="Target amount (₹)">
            <input
              type="number"
              value={form.targetAmount}
              onChange={(e) => set("targetAmount", e.target.value)}
              placeholder="5000000"
              className="input-base tabular-nums"
            />
          </Field>
          <Field label="Target year">
            <input
              type="number"
              value={form.targetYear}
              onChange={(e) => set("targetYear", e.target.value)}
              min={new Date().getFullYear()}
              max={2099}
              className="input-base tabular-nums"
            />
          </Field>

          <Field label="Current investment (₹)">
            <input
              type="number"
              value={form.currentValue}
              onChange={(e) => set("currentValue", e.target.value)}
              placeholder="0"
              className="input-base tabular-nums"
            />
          </Field>
          <Field label="Existing monthly SIP (₹)">
            <input
              type="number"
              value={form.existingMonthlySip}
              onChange={(e) => set("existingMonthlySip", e.target.value)}
              placeholder="0"
              className="input-base tabular-nums"
            />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3 pt-2 border-t">
          <Field label="Return % p.a.">
            <input
              type="number"
              value={form.expectedReturnPct}
              onChange={(e) => set("expectedReturnPct", e.target.value)}
              min={1}
              max={30}
              step={0.5}
              className="input-base tabular-nums"
            />
          </Field>
          <Field label="Inflation % p.a.">
            <input
              type="number"
              value={form.inflationPct}
              onChange={(e) => set("inflationPct", e.target.value)}
              min={0}
              max={20}
              step={0.5}
              className="input-base tabular-nums"
            />
          </Field>
          <Field label="SIP step-up % / yr">
            <input
              type="number"
              value={form.stepUpPct}
              onChange={(e) => set("stepUpPct", e.target.value)}
              min={0}
              max={30}
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

        <div className="flex justify-end pt-2 border-t">
          <button onClick={save} disabled={!canSave || busy} className="btn-primary">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {busy ? "Saving…" : "Save goal"}
          </button>
        </div>
      </div>

      {/* ─────────────────── Live calculator ─────────────────── */}
      <div className="lg:col-span-3 space-y-4">
        {!calc ? (
          <div className="space-y-4">
            <div className="card-surface p-6">
              <div className="flex items-center gap-3 mb-1">
                <div className="size-9 rounded-lg bg-brand-cyan-light grid place-items-center">
                  <Calculator className="size-5 text-brand-cyan-deep" />
                </div>
                <div>
                  <h2 className="font-semibold">Live projection</h2>
                  <p className="text-xs text-muted-foreground">
                    Enter the target amount + year on the left to see the math here in real-time.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="card-surface p-4">
                <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
                  You'll see
                </div>
                <ul className="mt-2 text-xs text-muted-foreground space-y-1.5">
                  <li>· Inflation-adjusted future target</li>
                  <li>· Required flat-SIP / step-up SIP / lumpsum</li>
                  <li>· Sensitivity at 8 / 10 / 12 / 15 % returns</li>
                  <li>· Year-by-year corpus chart + table</li>
                </ul>
              </div>
              <div className="card-surface p-4">
                <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
                  Quick-start templates
                </div>
                <div className="mt-2 grid grid-cols-1 gap-1.5">
                  <TemplateBtn
                    label="Retirement"
                    sub="₹5 Cr in 25 years"
                    onClick={() => {
                      set("category", "retirement");
                      set("name", "Retirement corpus");
                      set("targetAmount", "50000000");
                      set("targetYear", String(new Date().getFullYear() + 25));
                    }}
                  />
                  <TemplateBtn
                    label="Child education"
                    sub="₹50 L in 15 years"
                    onClick={() => {
                      set("category", "child_education");
                      set("name", "Child's higher education");
                      set("targetAmount", "5000000");
                      set("targetYear", String(new Date().getFullYear() + 15));
                    }}
                  />
                  <TemplateBtn
                    label="Home down-payment"
                    sub="₹30 L in 5 years"
                    onClick={() => {
                      set("category", "home");
                      set("name", "Home down-payment");
                      set("targetAmount", "3000000");
                      set("targetYear", String(new Date().getFullYear() + 5));
                    }}
                  />
                  <TemplateBtn
                    label="Wealth-building"
                    sub="₹1 Cr in 10 years"
                    onClick={() => {
                      set("category", "wealth_building");
                      set("name", "Wealth-building corpus");
                      set("targetAmount", "10000000");
                      set("targetYear", String(new Date().getFullYear() + 10));
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="card-surface p-5">
              <h3 className="font-semibold text-sm mb-2">The math</h3>
              <ul className="text-xs text-muted-foreground font-mono space-y-1.5 leading-relaxed">
                <li>
                  <span className="text-foreground font-semibold">Inflated target:</span>{" "}
                  T<sub>future</sub> = T<sub>today</sub> × (1 + π)<sup>years</sup>
                </li>
                <li>
                  <span className="text-foreground font-semibold">FV of SIP:</span> FV = P × ((1 + r/12)
                  <sup>n</sup> − 1) / (r/12) × (1 + r/12)
                </li>
                <li>
                  <span className="text-foreground font-semibold">Required SIP:</span> solved for
                  P given Target, current value, and assumed return.
                </li>
              </ul>
            </div>
          </div>
        ) : (
          <>
            {/* Top row: status + future target */}
            <div className="grid grid-cols-2 gap-4">
              <div className={`card-surface border-2 p-4 ${STATUS_TONE[calc.status]}`}>
                <div className="text-xs uppercase tracking-wide font-semibold opacity-70">Status</div>
                <div className="text-2xl font-bold capitalize mt-1">{calc.status.replace(/_/g, " ")}</div>
                <div className="text-xs mt-1 opacity-80">{calc.monthsLeft} months · {calc.yearsLeft.toFixed(1)} years</div>
              </div>
              <div className="card-surface p-4">
                <div className="text-xs uppercase tracking-wide font-semibold text-muted-foreground">
                  Target at goal date (inflation-adjusted)
                </div>
                <div className="text-2xl font-bold mt-1 tabular-nums">{formatINR(Math.round(calc.futureTarget))}</div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  {form.targetMode === "today" ? (
                    <>From ₹{Number(form.targetAmount || 0).toLocaleString("en-IN")} today × ({1 + calc.inflationPct / 100})^{calc.yearsLeft.toFixed(1)}</>
                  ) : (
                    <>Target entered in target-date rupees · {calc.inflationPct}% inflation assumed for reference</>
                  )}
                </div>
              </div>
            </div>

            {/* 3 "what to do" tiles */}
            <div className="card-surface p-5">
              <h3 className="font-semibold mb-3 text-sm flex items-center gap-2">
                <TrendingUp className="size-4 text-brand-cyan" /> Three ways to reach this goal
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <PlanCard
                  label="Flat monthly SIP"
                  value={formatINR(Math.round(calc.requiredMonthlySipTotal))}
                  sub="Same ₹ every month till goal date"
                  emphasis={calc.stepUpPct === 0}
                />
                <PlanCard
                  label={`Step-up SIP (start)`}
                  value={
                    calc.stepUpPct > 0
                      ? formatINR(Math.round(calc.requiredStepUpInitialSip))
                      : "—"
                  }
                  sub={
                    calc.stepUpPct > 0
                      ? `Increases ${calc.stepUpPct}% every year`
                      : "Set step-up % to see"
                  }
                  emphasis={calc.stepUpPct > 0}
                />
                <PlanCard
                  label="Lumpsum today"
                  value={formatINR(Math.round(calc.requiredLumpsumToday))}
                  sub="One-time today, no SIP"
                />
              </div>
              {calc.additionalMonthlySipNeeded > 0 && (
                <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900 flex items-center justify-between">
                  <span>Additional flat SIP needed (over your existing ₹{Number(form.existingMonthlySip || 0).toLocaleString("en-IN")}/mo):</span>
                  <span className="font-bold tabular-nums">{formatINR(Math.round(calc.additionalMonthlySipNeeded))}/mo</span>
                </div>
              )}
              {calc.gapAmount > 0 && (
                <div className="mt-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-900 flex items-center justify-between">
                  <span>Gap at target date if nothing changes:</span>
                  <span className="font-bold tabular-nums">{formatINR(Math.round(calc.gapAmount))}</span>
                </div>
              )}
            </div>

            {/* Sensitivity strip */}
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
              <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
                Higher assumed return → lower SIP required. Conservative funds typically deliver 8–10 % p.a.,
                equity-tilted hybrids 10–12 %, pure equity 12–15 % over 10+ years.
              </p>
            </div>

            {/* Year-by-year projection */}
            <div className="card-surface p-5">
              <h3 className="font-semibold mb-3 text-sm">Year-by-year projection</h3>
              {projection.length === 0 ? (
                <p className="text-sm text-muted-foreground">No projection — target year is this year.</p>
              ) : (
                <>
                  {/* Mini bar chart */}
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

                  {/* Compact yearly table — show every Nth year for long horizons */}
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

            {/* Formula explainer */}
            <div className="card-surface p-5">
              <h3 className="font-semibold mb-2 text-sm">The math behind the numbers</h3>
              <ul className="text-xs space-y-2 text-muted-foreground font-mono leading-relaxed">
                <li>
                  <span className="text-foreground font-semibold">Inflated target:</span> T<sub>future</sub> = T<sub>today</sub> × (1 + π)<sup>years</sup>
                </li>
                <li>
                  <span className="text-foreground font-semibold">FV of lumpsum:</span> FV = PV × (1 + r/12)<sup>n</sup>
                </li>
                <li>
                  <span className="text-foreground font-semibold">FV of SIP:</span> FV = P × ((1 + r/12)<sup>n</sup> − 1) / (r/12) × (1 + r/12)
                </li>
                <li>
                  <span className="text-foreground font-semibold">Required SIP:</span> P = (Target − FV<sub>lump</sub>) × (r/12) / (((1 + r/12)<sup>n</sup> − 1) × (1 + r/12))
                </li>
                <li>
                  <span className="text-foreground font-semibold">Lumpsum-today:</span> L = Target / (1 + r/12)<sup>n</sup>
                </li>
              </ul>
              <p className="text-[11px] text-muted-foreground mt-3">
                r = expected annual return ({calc.expectedReturnPct.toFixed(1)}%). π = inflation ({calc.inflationPct.toFixed(1)}%).
                n = {calc.monthsLeft} months. Step-up SIP solved by bisection.
              </p>
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

function TemplateBtn({
  label,
  sub,
  onClick,
}: {
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-lg border border-border bg-card hover:bg-brand-cyan-light/30 hover:border-brand-cyan/40 px-3 py-2 text-xs transition-all"
    >
      <div className="font-semibold text-sm">{label}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </button>
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
