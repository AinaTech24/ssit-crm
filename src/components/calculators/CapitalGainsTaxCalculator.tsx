"use client";

/**
 * Capital Gains Tax Calculator — assets purchased before / after FY 2001-02,
 * with CII indexation for long-term gains. Math: src/lib/calculators/capital-gains.ts
 * (verified to the reference case → LTCG ₹15,15,177, tax @20% ₹3,03,035).
 */

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  computeCapitalGains, CII, fyLabel, fyStartYear, ciiFor,
  type AssetType, type AcquisitionBasis, type Improvement,
} from "@/lib/calculators/capital-gains";
import { inr, fmtPct, clampNum, NumberField, Field, Segmented, Section, Stat, Table, Insight } from "./ui";

const ASSET_TYPES: { value: AssetType; label: string }[] = [
  { value: "immovable", label: "Immovable Property" },
  { value: "movable", label: "Movable Property" },
  { value: "gold", label: "Gold / Jewellery" },
  { value: "unlisted_shares", label: "Unlisted Shares" },
  { value: "other", label: "Other" },
];

const FY_YEARS = Object.keys(CII).map(Number).sort((a, b) => a - b);

export function CapitalGainsTaxCalculator() {
  const [basis, setBasis] = useState<AcquisitionBasis>("after_2001");
  const [assetType, setAssetType] = useState<AssetType>("immovable");
  const [assetName, setAssetName] = useState("House");
  const [purchasePrice, setPurchasePrice] = useState(1500000);
  const [purchaseDate, setPurchaseDate] = useState("2004-06-15");
  const [fmv2001, setFmv2001] = useState(0);
  const [improvements, setImprovements] = useState<Improvement[]>([{ fyStartYear: 2010, cost: 500000 }]);
  const [salePrice, setSalePrice] = useState(7000000);
  const [salesExpenses, setSalesExpenses] = useState(100000);
  const [saleDate, setSaleDate] = useState("2022-11-01");
  const [expectedSaleCII, setExpectedSaleCII] = useState<number>(0);
  const [incomeTaxSlabPct, setIncomeTaxSlabPct] = useState(30);

  const result = useMemo(
    () =>
      computeCapitalGains({
        acquisitionBasis: basis, assetType, purchasePrice, purchaseDate, fmv2001,
        improvements, salePrice, salesExpenses, saleDate,
        expectedSaleCII: expectedSaleCII > 0 ? expectedSaleCII : null, incomeTaxSlabPct,
      }),
    [basis, assetType, purchasePrice, purchaseDate, fmv2001, improvements, salePrice, salesExpenses, saleDate, expectedSaleCII, incomeTaxSlabPct]
  );

  function setImp(i: number, patch: Partial<Improvement>) {
    setImprovements((prev) => prev.map((im, idx) => (idx === i ? { ...im, ...patch } : im)));
  }
  function addImp() { setImprovements((prev) => [...prev, { fyStartYear: fyStartYear(saleDate) ?? 2022, cost: 0 }]); }
  function removeImp(i: number) { setImprovements((prev) => prev.filter((_, idx) => idx !== i)); }

  const purchaseFy = fyStartYear(purchaseDate);
  const saleFy = fyStartYear(saleDate);

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Capital Gains Tax Calculator</h2>
        <p className="text-xs text-muted-foreground">
          Long-term capital gains tax on property and other assets, with CII
          indexation — for assets purchased before or after FY 2001-02.
        </p>
      </div>

      <Segmented
        label="Acquisition basis"
        value={basis}
        onChange={setBasis}
        options={[
          { value: "after_2001", label: "Purchased in/after FY2001-02" },
          { value: "before_2001", label: "Purchased before FY2001-02" },
        ]}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium block mb-1">Asset type</span>
          <select value={assetType} onChange={(e) => setAssetType(e.target.value as AssetType)} className="input-base text-sm w-full">
            {ASSET_TYPES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </label>
        <Field label="Asset name"><input value={assetName} onChange={(e) => setAssetName(e.target.value)} className="input-base text-sm w-full" /></Field>
        <NumberField label="Purchase price (₹)" value={purchasePrice} setValue={setPurchasePrice} step={100000} />
        <Field label="Date of purchase">
          <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className="input-base text-sm w-full" />
        </Field>
        {basis === "before_2001" && (
          <NumberField label="FMV as on 01/04/2001 (₹)" value={fmv2001} setValue={setFmv2001} step={100000} />
        )}
      </div>

      {/* Improvements */}
      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">Cost of improvement (by financial year)</div>
        <div className="space-y-2">
          {improvements.map((im, i) => (
            <div key={i} className="flex items-end gap-2">
              <label className="block">
                <span className="text-[10px] text-muted-foreground block mb-0.5">Financial year</span>
                <select value={im.fyStartYear} onChange={(e) => setImp(i, { fyStartYear: Number(e.target.value) })} className="input-base text-sm w-32">
                  {FY_YEARS.map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] text-muted-foreground block mb-0.5">Cost of improvement (₹)</span>
                <input type="number" step={50000} min={0} value={im.cost} onChange={(e) => setImp(i, { cost: clampNum(e.target.value) })} className="input-base text-sm w-40" />
              </label>
              <button type="button" onClick={() => removeImp(i)} className="text-rose-500 hover:text-rose-700 pb-1.5 print:hidden" aria-label="Remove improvement"><Trash2 className="size-4" /></button>
            </div>
          ))}
          <button type="button" onClick={addImp} className="btn-ghost text-xs print:hidden">+ Add more</button>
        </div>
      </div>

      {/* Sale */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Sale price (₹)" value={salePrice} setValue={setSalePrice} step={100000} />
        <NumberField label="Sales expenses (₹)" value={salesExpenses} setValue={setSalesExpenses} step={10000} />
        <Field label="Sale date">
          <input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} className="input-base text-sm w-full" />
        </Field>
        <NumberField label="Expected sale-year CII (optional)" value={expectedSaleCII} setValue={setExpectedSaleCII} step={1} />
        <NumberField label="Income-tax slab of assessee (%)" value={incomeTaxSlabPct} setValue={setIncomeTaxSlabPct} step={5} />
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Holding period" value={`${Math.floor(result.holdingMonths / 12)}y ${result.holdingMonths % 12}m`} />
        <Stat label="Gain type" value={result.isLongTerm ? "Long-term" : "Short-term"} tone={result.isLongTerm ? "emerald" : "amber"} />
        <Stat label={result.isLongTerm ? "Long-term capital gain" : "Short-term capital gain"} value={inr(result.gain)} tone="cyan" />
        <Stat label="Total tax payable" value={inr(result.totalTax)} tone="rose" />
      </div>

      <Section n="✓" title={result.isLongTerm ? "Computation (with indexation)" : "Computation (short-term, at slab)"}>
        <Table
          head={["Component", "Amount"]}
          rows={
            result.isLongTerm
              ? [
                  [`Sale price`, inr(salePrice)],
                  [`Less: sales expenses`, `(${inr(salesExpenses)})`],
                  [`Net sale consideration`, inr(result.netConsideration)],
                  [`Indexed cost of acquisition (CII ${result.ciiSale}/${ciiFor(result.purchaseFY ?? 2001)})`, `(${inr(result.indexedAcquisition)})`],
                  [`Indexed cost of improvement`, `(${inr(result.indexedImprovements)})`],
                  [`Long-term capital gain`, inr(result.gain)],
                  [`Tax @ 20% (with indexation)`, inr(result.baseTax)],
                  [`Health & education cess @ 4%`, inr(result.cess)],
                  [`Total tax payable`, inr(result.totalTax)],
                ]
              : [
                  [`Net sale consideration`, inr(result.netConsideration)],
                  [`Less: cost of acquisition`, `(${inr(result.costBase)})`],
                  [`Less: cost of improvement`, `(${inr(result.totalImprovementsRaw)})`],
                  [`Short-term capital gain`, inr(result.gain)],
                  [`Tax @ slab ${fmtPct(incomeTaxSlabPct)}`, inr(result.baseTax)],
                  [`Health & education cess @ 4%`, inr(result.cess)],
                  [`Total tax payable`, inr(result.totalTax)],
                ]
          }
        />
        <Insight tone={result.isLongTerm ? "emerald" : "amber"}>
          {assetName || "This asset"} was held for {Math.floor(result.holdingMonths / 12)} years{" "}
          {result.holdingMonths % 12 ? `${result.holdingMonths % 12} months` : ""} →{" "}
          <strong>{result.isLongTerm ? "long-term" : "short-term"}</strong>. Tax payable is{" "}
          <strong>{inr(result.totalTax)}</strong>
          {result.gain > 0 && ` (effective ${result.effectiveRatePct.toFixed(1)}% of the gain)`}.
          {result.isLongTerm && " Indexation raises the cost base to today's value, sharply reducing the taxable gain."}
        </Insight>
      </Section>
    </div>
  );
}
