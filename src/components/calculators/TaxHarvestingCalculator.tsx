"use client";

/**
 * Equity LTCG Tax-Harvesting Calculator — bank the ₹1.25L/yr tax-free LTCG by
 * redeeming + re-buying each year, and see the tax saved over time.
 * Math: src/lib/calculators/tax-harvesting.ts.
 */

import { useMemo, useState } from "react";
import { computeTaxHarvesting } from "@/lib/calculators/tax-harvesting";
import { inr, NumberField, Section, Stat, Table, Insight } from "./ui";

export function TaxHarvestingCalculator() {
  const [investment, setInvestment] = useState(2000000);
  const [expectedReturnPct, setExpectedReturnPct] = useState(12);
  const [years, setYears] = useState(15);
  const [exemptionPerYear, setExemptionPerYear] = useState(125000);
  const [ltcgRatePct, setLtcgRatePct] = useState(12.5);

  const r = useMemo(
    () => computeTaxHarvesting({ investment, expectedReturnPct, years, exemptionPerYear, ltcgRatePct }),
    [investment, expectedReturnPct, years, exemptionPerYear, ltcgRatePct]
  );

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Equity LTCG Tax-Harvesting</h2>
        <p className="text-xs text-muted-foreground">
          Long-term equity gains up to ₹1.25 lakh a year are tax-free. Redeeming and
          re-buying to &quot;harvest&quot; that exemption each year resets your cost base —
          and cuts the tax due when you finally sell.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Investment (₹)" value={investment} setValue={setInvestment} step={100000} />
        <NumberField label="Expected return (%)" value={expectedReturnPct} setValue={setExpectedReturnPct} step={0.5} />
        <NumberField label="Holding period (yrs)" value={years} setValue={setYears} step={1} />
        <NumberField label="Tax-free LTCG / yr (₹)" value={exemptionPerYear} setValue={setExemptionPerYear} step={25000} />
        <NumberField label="LTCG rate (%)" value={ltcgRatePct} setValue={setLtcgRatePct} step={0.5} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Final value" value={inr(r.finalValue)} tone="cyan" />
        <Stat label="Tax if you never harvest" value={inr(r.taxWithoutHarvesting)} tone="rose" />
        <Stat label="Tax with harvesting" value={inr(r.taxWithHarvesting)} tone="emerald" />
        <Stat label="Tax saved" value={inr(r.taxSaved)} tone="emerald" />
      </div>

      <Section n="✓" title="Year-by-year harvesting">
        <div className="max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">
          <Table
            head={["Year", "Value", "Unrealised gain", "Harvested (tax-free)", "Stepped-up cost"]}
            rows={r.rows.map((row) => [
              `${row.year}`,
              inr(row.value),
              inr(row.unrealizedGain),
              row.harvested > 0 ? inr(row.harvested) : "—",
              inr(row.costBase),
            ])}
          />
        </div>
      </Section>

      <Insight tone="emerald">
        By harvesting the {inr(exemptionPerYear)} tax-free exemption each year, your client banks{" "}
        <strong>{inr(r.totalHarvestedTaxFree)}</strong> of gains tax-free and pays{" "}
        <strong>{inr(r.taxSaved)}</strong> less tax than someone who simply holds and sells at the end — with no change
        to the underlying investment.
      </Insight>
      <p className="text-[10px] text-muted-foreground">Assumes gains qualify as long-term and exit loads/STT are ignored. Illustration only.</p>
    </div>
  );
}
