"use client";

/**
 * Financial Discovery form — the shared fact-find UI used both in-meeting (RM,
 * full form incl. advisor assessment) and by the client via the public link
 * (clientMode hides the assessment). Every keystroke recomputes the live
 * Financial Health Snapshot. Adapted from the workbook's five sections.
 */

import { useMemo, useState } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { computeDiscovery, type DiscoveryData } from "@/lib/discovery/calc";
import { RISK_QUESTIONS } from "@/lib/discovery/risk";
import { HealthSnapshot } from "./HealthSnapshot";
import * as O from "@/lib/discovery/options";

type ColType = "text" | "num" | { select: readonly string[] };
type Col = { key: string; label: string; type: ColType; w?: string };

export function DiscoveryForm({
  initialData,
  clientMode = false,
  saving = false,
  onSave,
  onSubmit,
  submitLabel = "Submit",
}: {
  initialData: DiscoveryData;
  clientMode?: boolean;
  saving?: boolean;
  onSave?: (d: DiscoveryData) => void;
  onSubmit?: (d: DiscoveryData) => void;
  submitLabel?: string;
}) {
  const [data, setData] = useState<DiscoveryData>(() => ({ ...initialData }));
  const c = useMemo(() => computeDiscovery(data), [data]);

  const set = (patch: Partial<DiscoveryData>) => setData((d) => ({ ...d, ...patch }));
  const setId = (k: string, v: any) => set({ identification: { ...(data.identification ?? {}), [k]: v } });
  const setExp = (k: string, v: any) => set({ expenses: { ...(data.expenses ?? {}), [k]: v } });
  const setSurp = (k: string, v: any) => set({ surplusInputs: { ...(data.surplusInputs ?? {}), [k]: v } });
  const setRisk = (k: string, v: any) => set({ riskProfile: { ...(data.riskProfile ?? {}), [k]: v } });
  const setAssess = (k: string, v: any) => set({ assessment: { ...(data.assessment ?? {}), [k]: v } });

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
      <div className="space-y-5 min-w-0">
        {/* 1 · Identity */}
        <Section title="1 · Client identity">
          <Grid>
            <F label="Full name (as per PAN)"><T v={data.identification?.fullName} on={(x) => setId("fullName", x)} /></F>
            <F label="Date of birth"><input type="date" className="input-base text-sm w-full" value={data.identification?.dob ?? ""} onChange={(e) => setId("dob", e.target.value)} /></F>
            <F label="PAN"><T v={data.identification?.pan} on={(x) => setId("pan", x.toUpperCase())} mono /></F>
            <F label="Mobile"><T v={data.identification?.mobile} on={(x) => setId("mobile", x)} /></F>
            <F label="Email"><T v={data.identification?.email} on={(x) => setId("email", x)} /></F>
            <F label="City"><T v={data.identification?.city} on={(x) => setId("city", x)} /></F>
            <F label="Residency"><S v={data.identification?.residency} on={(x) => setId("residency", x)} opts={O.RESIDENCY} /></F>
            <F label="Occupation"><T v={data.identification?.occupation} on={(x) => setId("occupation", x)} /></F>
            <F label="Tax slab"><S v={data.identification?.taxSlab} on={(x) => setId("taxSlab", x)} opts={O.TAX_SLABS} /></F>
            <F label="Dependents"><N v={data.identification?.dependents} on={(x) => setId("dependents", x)} /></F>
            <F label="Nominee name"><T v={data.identification?.nomineeName} on={(x) => setId("nomineeName", x)} /></F>
            <F label="Nominee relation"><S v={data.identification?.nomineeRelation} on={(x) => setId("nomineeRelation", x)} opts={O.RELATIONS} /></F>
          </Grid>
        </Section>

        {/* 2 · Income */}
        <Section title="2 · Income & cash flow" subtitle={`Total gross annual income: ₹${Math.round(c.grossAnnualIncome).toLocaleString("en-IN")}`}>
          <Repeat
            rows={data.income ?? []}
            on={(rows) => set({ income: rows })}
            cols={[
              { key: "source", label: "Income source", type: "text", w: "minmax(8rem,1.5fr)" },
              { key: "annualAmount", label: "Annual ₹", type: "num", w: "8rem" },
              { key: "frequency", label: "Frequency", type: { select: O.FREQUENCY }, w: "7rem" },
              { key: "taxable", label: "Taxable?", type: { select: O.YES_NO }, w: "6rem" },
            ]}
            addLabel="Add income source"
          />
        </Section>

        {/* 3 · Monthly expenses */}
        <Section title="3 · Monthly household expenses" subtitle={`Total: ₹${Math.round(c.monthlyExpenses).toLocaleString("en-IN")}/mo · ₹${Math.round(c.annualExpenses).toLocaleString("en-IN")}/yr`}>
          <Grid>
            {([
              ["rent", "Rent / Home-loan EMI"], ["groceries", "Groceries & household"], ["education", "Children's education"],
              ["insurance", "Insurance premiums"], ["vehicle", "Vehicle / transport"], ["utilities", "Utilities, internet"],
              ["medical", "Medical / healthcare"], ["entertainment", "Entertainment & dining"], ["clothing", "Clothing & personal"],
              ["other", "Other regular"],
            ] as const).map(([k, label]) => (
              <F key={k} label={label}><N v={(data.expenses as any)?.[k]} on={(x) => setExp(k, x)} /></F>
            ))}
          </Grid>
        </Section>

        {/* 4 · Surplus */}
        <Section title="4 · Investable surplus" subtitle={`Net annual surplus: ₹${Math.round(c.netInvestableSurplus).toLocaleString("en-IN")} · ~₹${Math.round(c.monthlySipCapacity).toLocaleString("en-IN")}/mo`}>
          <Grid>
            <F label="Annual loan EMIs"><N v={data.surplusInputs?.annualLoanEmis} on={(x) => setSurp("annualLoanEmis", x)} /></F>
            <F label="Annual insurance premiums"><N v={data.surplusInputs?.annualInsurancePremiums} on={(x) => setSurp("annualInsurancePremiums", x)} /></F>
            <F label="Estimated annual tax"><N v={data.surplusInputs?.estimatedTax} on={(x) => setSurp("estimatedTax", x)} /></F>
          </Grid>
        </Section>

        {/* 5 · Assets */}
        <Section title="5 · Assets" subtitle={`Total assets: ₹${Math.round(c.totalAssets).toLocaleString("en-IN")}`}>
          <Repeat
            rows={data.assets ?? []}
            on={(rows) => set({ assets: rows })}
            cols={[
              { key: "description", label: "Description", type: "text", w: "minmax(7rem,1.3fr)" },
              { key: "category", label: "Type", type: { select: O.ASSET_TYPES }, w: "9rem" },
              { key: "currentValue", label: "Value ₹", type: "num", w: "7rem" },
              { key: "invested", label: "Invested ₹", type: "num", w: "7rem" },
              { key: "liquid", label: "Liquid?", type: { select: O.YES_NO }, w: "5.5rem" },
            ]}
            addLabel="Add asset"
          />
        </Section>

        {/* 6 · Liabilities */}
        <Section title="6 · Liabilities" subtitle={`Total: ₹${Math.round(c.totalLiabilities).toLocaleString("en-IN")} · Net worth ₹${Math.round(c.netWorth).toLocaleString("en-IN")} · Debt/Asset ${c.debtToAssetRatio.toFixed(0)}%`}>
          <Repeat
            rows={data.liabilities ?? []}
            on={(rows) => set({ liabilities: rows })}
            cols={[
              { key: "description", label: "Description", type: "text", w: "minmax(7rem,1.3fr)" },
              { key: "type", label: "Type", type: { select: O.LIABILITY_TYPES }, w: "8rem" },
              { key: "outstanding", label: "Outstanding ₹", type: "num", w: "8rem" },
              { key: "emi", label: "EMI ₹", type: "num", w: "6.5rem" },
              { key: "ratePct", label: "Rate %", type: "num", w: "5rem" },
            ]}
            addLabel="Add liability"
          />
        </Section>

        {/* 7 · Life insurance */}
        <Section title="7 · Life insurance" subtitle={`Cover ₹${Math.round(c.totalLifeCover).toLocaleString("en-IN")} · Recommended ₹${Math.round(c.recommendedLifeCover).toLocaleString("en-IN")} (10×) · ${c.lifeCoverGap > 0 ? `Gap ₹${Math.round(c.lifeCoverGap).toLocaleString("en-IN")}` : "Adequately covered"}`}>
          <Repeat
            rows={data.lifeInsurance ?? []}
            on={(rows) => set({ lifeInsurance: rows })}
            cols={[
              { key: "policy", label: "Policy / insurer", type: "text", w: "minmax(7rem,1.3fr)" },
              { key: "type", label: "Type", type: { select: O.LIFE_INSURANCE_TYPES }, w: "7.5rem" },
              { key: "sumAssured", label: "Sum assured ₹", type: "num", w: "8rem" },
              { key: "premium", label: "Premium ₹", type: "num", w: "7rem" },
            ]}
            addLabel="Add life policy"
          />
        </Section>

        {/* 8 · Health insurance */}
        <Section title="8 · Health & general insurance" subtitle={`Total health cover ₹${Math.round(c.totalHealthCover).toLocaleString("en-IN")}`}>
          <Repeat
            rows={data.healthInsurance ?? []}
            on={(rows) => set({ healthInsurance: rows })}
            cols={[
              { key: "insurer", label: "Insurer / plan", type: "text", w: "minmax(7rem,1.3fr)" },
              { key: "type", label: "Type", type: { select: O.HEALTH_INSURANCE_TYPES }, w: "9rem" },
              { key: "sumInsured", label: "Sum insured ₹", type: "num", w: "8rem" },
              { key: "premium", label: "Premium ₹", type: "num", w: "7rem" },
            ]}
            addLabel="Add health policy"
          />
        </Section>

        {/* 9 · Goals */}
        <Section title="9 · Financial goals" subtitle={`Target corpus ₹${Math.round(c.totalCorpusTarget).toLocaleString("en-IN")} · SIP needed ~₹${Math.round(c.totalSipNeeded).toLocaleString("en-IN")}/mo`}>
          <Repeat
            rows={data.goals ?? []}
            on={(rows) => set({ goals: rows })}
            cols={[
              { key: "description", label: "Goal", type: "text", w: "minmax(7rem,1.3fr)" },
              { key: "type", label: "Type", type: { select: O.GOAL_TYPES }, w: "8rem" },
              { key: "targetYear", label: "Target yr", type: "num", w: "5.5rem" },
              { key: "targetCorpus", label: "Corpus ₹", type: "num", w: "7.5rem" },
              { key: "alreadySaved", label: "Saved ₹", type: "num", w: "7rem" },
              { key: "priority", label: "Priority", type: { select: O.PRIORITY }, w: "6.5rem" },
            ]}
            addLabel="Add goal"
          />
        </Section>

        {/* 10 · Risk profiling — auto-scores into a 6-band profile + suitability */}
        <Section
          title="10 · Risk profile & suitability"
          subtitle={
            c.risk.answered > 0
              ? `${c.risk.bandLabel} · score ${c.risk.score}/${c.risk.max} · ${c.risk.answered}/${c.risk.total} parameters`
              : "Answer the questions — risk score & product suitability auto-calculate →"
          }
        >
          <Grid>
            {RISK_QUESTIONS.map((q) => (
              <F key={q.key} label={q.label}>
                <S v={data.riskProfile?.[q.key]} on={(x) => setRisk(q.key, x)} opts={q.options.map((o) => o.value)} />
              </F>
            ))}
          </Grid>
          <p className="text-[10px] text-muted-foreground">Age, annual income &amp; net worth are taken automatically from the fact-find above — no need to re-enter.</p>
        </Section>

        {/* 11 · Advisor assessment — internal only */}
        {!clientMode && (
          <Section title="11 · Advisor assessment" subtitle="Internal — not shown to the client">
            <Grid>
              <F label="Assessed risk profile"><S v={data.assessment?.riskProfile} on={(x) => setAssess("riskProfile", x)} opts={O.RISK_PROFILES} /></F>
              <F label="Advisory service required"><S v={data.assessment?.advisoryService} on={(x) => setAssess("advisoryService", x)} opts={O.ADVICE_TYPES} /></F>
              <F label="Recommended next action"><S v={data.assessment?.nextAction} on={(x) => setAssess("nextAction", x)} opts={O.NEXT_STEPS} /></F>
              <F label="Follow-up date"><input type="date" className="input-base text-sm w-full" value={data.assessment?.followUpDate ?? ""} onChange={(e) => setAssess("followUpDate", e.target.value)} /></F>
              <F label="RM conviction (1–5)"><S v={data.assessment?.convictionRating} on={(x) => setAssess("convictionRating", x)} opts={O.RM_RATINGS} /></F>
              <F label="Review type"><S v={data.assessment?.reviewType} on={(x) => setAssess("reviewType", x)} opts={O.REVIEW_TYPES} /></F>
            </Grid>
            <F label="Key client concerns / notes"><textarea className="input-base text-sm w-full min-h-[72px]" value={data.assessment?.concerns ?? ""} onChange={(e) => setAssess("concerns", e.target.value)} /></F>
          </Section>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2">
          {onSave && (
            <button onClick={() => onSave(data)} disabled={saving} className="btn-secondary text-sm">
              {saving ? <Loader2 className="size-4 animate-spin" /> : null} Save draft
            </button>
          )}
          {onSubmit && (
            <button onClick={() => onSubmit(data)} disabled={saving} className="btn-primary text-sm">
              {saving ? <Loader2 className="size-4 animate-spin" /> : null} {submitLabel}
            </button>
          )}
        </div>
      </div>

      <HealthSnapshot c={c} sticky />
    </div>
  );
}

/* ── primitives ─────────────────────────────────────────────────────────── */
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="card-surface p-5 space-y-3">
      <div>
        <h2 className="font-semibold text-sm">{title}</h2>
        {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 md:grid-cols-3 gap-3">{children}</div>;
}
function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] font-medium text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}
function T({ v, on, mono }: { v: any; on: (x: string) => void; mono?: boolean }) {
  return <input className={`input-base text-sm w-full ${mono ? "font-mono" : ""}`} value={v ?? ""} onChange={(e) => on(e.target.value)} />;
}
function N({ v, on }: { v: any; on: (x: string) => void }) {
  return <input type="number" inputMode="decimal" className="input-base text-sm w-full tabular-nums" value={v ?? ""} onChange={(e) => on(e.target.value)} />;
}
function S({ v, on, opts }: { v: any; on: (x: string) => void; opts: readonly string[] }) {
  return (
    <select className="input-base text-sm w-full" value={v ?? ""} onChange={(e) => on(e.target.value)}>
      <option value="">Select…</option>
      {opts.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Repeat({ rows, on, cols, addLabel }: { rows: any[]; on: (rows: any[]) => void; cols: Col[]; addLabel: string }) {
  const update = (i: number, key: string, val: any) => on(rows.map((r, j) => (j === i ? { ...r, [key]: val } : r)));
  const add = () => on([...rows, {}]);
  const remove = (i: number) => on(rows.filter((_, j) => j !== i));
  const template = cols.map((cc) => cc.w ?? "1fr").join(" ") + " 2rem";
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <div className="min-w-[36rem]">
          <div className="grid gap-2 text-[10px] uppercase tracking-wider text-muted-foreground px-1" style={{ gridTemplateColumns: template }}>
            {cols.map((cc) => <div key={cc.key}>{cc.label}</div>)}
            <div />
          </div>
          {rows.length === 0 && <div className="text-xs text-muted-foreground px-1 py-2">None added yet.</div>}
          {rows.map((r, i) => (
            <div key={i} className="grid gap-2 mt-1.5 items-center" style={{ gridTemplateColumns: template }}>
              {cols.map((cc) => (
                <div key={cc.key}>
                  {cc.type === "text" ? (
                    <T v={r[cc.key]} on={(x) => update(i, cc.key, x)} />
                  ) : cc.type === "num" ? (
                    <N v={r[cc.key]} on={(x) => update(i, cc.key, x)} />
                  ) : (
                    <S v={r[cc.key]} on={(x) => update(i, cc.key, x)} opts={(cc.type as { select: readonly string[] }).select} />
                  )}
                </div>
              ))}
              <button onClick={() => remove(i)} className="text-muted-foreground hover:text-rose-600 grid place-items-center" aria-label="Remove row" type="button">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
      <button onClick={add} type="button" className="inline-flex items-center gap-1 text-xs text-brand-cyan-deep hover:underline">
        <Plus className="size-3.5" /> {addLabel}
      </button>
    </div>
  );
}
