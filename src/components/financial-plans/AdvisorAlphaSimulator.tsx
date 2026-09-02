"use client";

import React, { useState, useMemo } from "react";
import { Shield, Info, TrendingUp, HelpCircle } from "lucide-react";
import { formatINR } from "@/lib/utils";

type AdvisorAlphaSimulatorProps = {
  initialCapital?: number;
  mfdValueAddText?: string | null;
};

export function AdvisorAlphaSimulator({
  initialCapital = 1000000,
  mfdValueAddText,
}: AdvisorAlphaSimulatorProps) {
  const [mode, setMode] = useState<"lump_sum" | "sip">("sip");
  const [amount, setAmount] = useState<number>(mode === "sip" ? 25000 : initialCapital);
  const [years, setYears] = useState<number>(15);

  // Sync amount when mode changes
  const handleModeChange = (newMode: "lump_sum" | "sip") => {
    setMode(newMode);
    if (newMode === "sip") {
      setAmount(25000);
    } else {
      setAmount(initialCapital > 0 ? initialCapital : 1000000);
    }
  };

  // Calculations
  // DIY Expected Return: 8.5% p.a.
  // MFD Expected Return: 11.5% p.a. (8.5% + 3.0% Advisor Alpha value-add)
  const diyRate = 0.085;
  const mfdRate = 0.115;

  const result = useMemo(() => {
    let diyFV = 0;
    let mfdFV = 0;

    if (mode === "lump_sum") {
      diyFV = amount * Math.pow(1 + diyRate, years);
      mfdFV = amount * Math.pow(1 + mfdRate, years);
    } else {
      // Monthly rates
      const rDiy = diyRate / 12;
      const rMfd = mfdRate / 12;
      const m = years * 12;

      diyFV = amount * ((Math.pow(1 + rDiy, m) - 1) / rDiy) * (1 + rDiy);
      mfdFV = amount * ((Math.pow(1 + rMfd, m) - 1) / rMfd) * (1 + rMfd);
    }

    const valueGap = mfdFV - diyFV;

    return {
      diyFV: Math.round(diyFV),
      mfdFV: Math.round(mfdFV),
      valueGap: Math.round(valueGap),
    };
  }, [mode, amount, years]);

  return (
    <div className="card-surface p-6 space-y-6 bg-gradient-to-br from-brand-cyan-light/20 via-background to-secondary/10 border border-brand-cyan/25">
      <div className="flex items-center justify-between pb-3 border-b border-border/80">
        <div className="flex items-center gap-2">
          <Shield className="size-5 text-brand-cyan-deep" />
          <div>
            <h3 className="text-sm font-extrabold text-brand-navy">Interactive Advisor's Alpha Compounding Simulator</h3>
            <p className="text-[10px] text-muted-foreground">See the long-term wealth value of investing through a professional MFD partner</p>
          </div>
        </div>
        <span className="text-[10px] bg-brand-cyan-deep text-white font-bold px-2 py-0.5 rounded">
          +3.00% p.a. Alpha
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Controls */}
        <div className="space-y-4 text-xs">
          <div>
            <span className="text-[11px] font-bold text-muted-foreground block mb-2">Investment Mode</span>
            <div className="grid grid-cols-2 gap-2 p-1 bg-secondary/30 rounded-lg">
              <button
                type="button"
                onClick={() => handleModeChange("sip")}
                className={`py-1.5 rounded-md font-bold text-center transition-all ${
                  mode === "sip"
                    ? "bg-white text-brand-navy shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Monthly SIP
              </button>
              <button
                type="button"
                onClick={() => handleModeChange("lump_sum")}
                className={`py-1.5 rounded-md font-bold text-center transition-all ${
                  mode === "lump_sum"
                    ? "bg-white text-brand-navy shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                One-time Lumpsum
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between font-bold">
              <span>{mode === "sip" ? "Monthly SIP Amount" : "Lumpsum Capital"}</span>
              <span className="text-brand-cyan-deep">{formatINR(amount)}</span>
            </div>
            <input
              type="range"
              min={mode === "sip" ? 5000 : 50000}
              max={mode === "sip" ? 250000 : 5000000}
              step={mode === "sip" ? 5000 : 50000}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full accent-brand-cyan"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>{formatINR(mode === "sip" ? 5000 : 50000)}</span>
              <span>{formatINR(mode === "sip" ? 250000 : 5000000)}</span>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between font-bold">
              <span>Time Horizon</span>
              <span className="text-brand-cyan-deep">{years} Years</span>
            </div>
            <input
              type="range"
              min={1}
              max={30}
              step={1}
              value={years}
              onChange={(e) => setYears(Number(e.target.value))}
              className="w-full accent-brand-cyan"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>1 Year</span>
              <span>30 Years</span>
            </div>
          </div>
        </div>

        {/* Results Visual */}
        <div className="flex flex-col justify-between bg-card p-4 rounded-xl border border-border/60">
          <div className="space-y-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Projected Future Wealth</div>
            
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="space-y-1 p-2 rounded bg-secondary/10">
                <span className="text-muted-foreground block text-[10px]">DIY Investing (8.5% p.a.)</span>
                <span className="font-semibold text-slate-700 tabular-nums">{formatINR(result.diyFV)}</span>
              </div>
              <div className="space-y-1 p-2 rounded bg-brand-cyan-light/10 border border-brand-cyan/20">
                <span className="text-brand-cyan-deep block text-[10px]">MFD Partnered (11.5% p.a.)</span>
                <span className="font-bold text-brand-navy tabular-nums">{formatINR(result.mfdFV)}</span>
              </div>
            </div>
          </div>

          <div className="border-t pt-3 mt-3 flex flex-col justify-end">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide block mb-1">
              MFD Wealth Value-Add Gap
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-extrabold text-emerald-600 leading-none tabular-nums">
                {formatINR(result.valueGap)}
              </span>
              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                Extra Wealth Generated
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 leading-normal">
              By partner-investing with an MFD, the compounding benefit of behavioral guidance, rebalancing, and professional allocation yields a massive gap in your favor.
            </p>
          </div>
        </div>
      </div>

      {/* The 7 Components Grid */}
      <div className="border-t pt-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[10px]">
          <div className="p-2.5 bg-white border rounded-lg space-y-1 shadow-sm">
            <span className="font-bold text-brand-navy block">Behavioral Coaching</span>
            <span className="text-emerald-700 font-extrabold block text-xs">+1.50% p.a.</span>
            <span className="text-slate-500 leading-normal block">Preventing panic-selling during volatile market phases.</span>
          </div>
          <div className="p-2.5 bg-white border rounded-lg space-y-1 shadow-sm">
            <span className="font-bold text-brand-navy block">Asset Allocation</span>
            <span className="text-emerald-700 font-extrabold block text-xs">+0.50% p.a.</span>
            <span className="text-slate-500 leading-normal block">Custom-designed multi-asset portfolio matching risk capacity.</span>
          </div>
          <div className="p-2.5 bg-white border rounded-lg space-y-1 shadow-sm">
            <span className="font-bold text-brand-navy block">Portfolio Rebalancing</span>
            <span className="text-emerald-700 font-extrabold block text-xs">+0.40% p.a.</span>
            <span className="text-slate-500 leading-normal block">Systematically buying low and selling high to restore targets.</span>
          </div>
          <div className="p-2.5 bg-white border rounded-lg space-y-1 shadow-sm">
            <span className="font-bold text-brand-navy block">Tax Location Alpha</span>
            <span className="text-emerald-700 font-extrabold block text-xs">+0.60% p.a.</span>
            <span className="text-slate-500 leading-normal block">Harvesting capital gains and structuring tax-optimized schemes.</span>
          </div>
        </div>
      </div>

      {mfdValueAddText && (
        <div className="p-3 bg-white/70 border border-brand-cyan/20 rounded-lg text-xs italic text-slate-700">
          <strong>Advisor's Personalized Note:</strong> "{mfdValueAddText}"
        </div>
      )}
    </div>
  );
}
