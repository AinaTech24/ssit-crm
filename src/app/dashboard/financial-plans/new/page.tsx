"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ScrollText,
  Plus,
  Trash2,
  Save,
  Loader2,
  TrendingUp,
  Shield,
  Briefcase,
  AlertTriangle,
  Heart,
  DollarSign
} from "lucide-react";
import { InvestorLookup } from "@/components/common/InvestorLookup";
import { SelectField } from "@/components/ui/SelectField";
import { formatINR } from "@/lib/utils";
import { computeGoal } from "@/lib/goal-planning/calc";
import { recommendedLifeCover, financialAssetsTotal } from "@/lib/financial-plans/analysis";

type Recipient = { id: string; name: string; kind?: "investor" | "lead" };

type Child = { name: string; age: number };

type Asset = {
  category: "equity" | "debt" | "gold" | "cash" | "real_estate" | "other";
  subCategory?: string;
  name: string;
  value: number;
};

type Liability = {
  name: string;
  value: number;
  monthlyEmi?: number;
};

type Goal = {
  category: string;
  name: string;
  targetAmount: number;
  targetYears: number;
  inflationRate: number;
  expectedReturn: number;
  currentValue?: number;
  existingMonthlySip?: number;
  futureValue?: number;
  requiredMonthlySip?: number;
  additionalMonthlySip?: number;
  gapAmount?: number;
};

type Recommendation = {
  category: "emergency" | "insurance" | "goals" | "investment" | "general";
  action: string;
  priority: "high" | "medium" | "low";
  notes?: string;
};

const GOAL_CATEGORIES = [
  { value: "retirement", label: "Retirement" },
  { value: "child_education", label: "Child Education" },
  { value: "child_marriage", label: "Child Marriage" },
  { value: "house", label: "House Purchase" },
  { value: "car", label: "Vehicle / Car" },
  { value: "vacation", label: "Vacation / Travel" },
  { value: "emergency_fund", label: "Emergency Fund" },
  { value: "wealth_creation", label: "Wealth Creation" },
  { value: "other", label: "Other Goal" },
];

function PlanFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");

  // Multi-step State
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Form Fields
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [status, setStatus] = useState<"draft" | "finalized">("draft");
  const [clientAge, setClientAge] = useState<number | undefined>(undefined);
  const [spouseAge, setSpouseAge] = useState<number | undefined>(undefined);
  const [children, setChildren] = useState<Child[]>([]);

  const [monthlyIncome, setMonthlyIncome] = useState<number | undefined>(undefined);
  const [monthlyExpenses, setMonthlyExpenses] = useState<number | undefined>(undefined);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [liabilities, setLiabilities] = useState<Liability[]>([]);

  const [emergencyFundTargetMonths, setEmergencyFundTargetMonths] = useState<number>(6);
  const [emergencyFundCurrentValue, setEmergencyFundCurrentValue] = useState<number>(0);

  const [lifeInsuranceSumAssured, setLifeInsuranceSumAssured] = useState<number | undefined>(undefined);
  const [lifeInsuranceAnnualPremium, setLifeInsuranceAnnualPremium] = useState<number | undefined>(undefined);

  const [healthInsuranceSumAssured, setHealthInsuranceSumAssured] = useState<number | undefined>(undefined);
  const [healthInsuranceAnnualPremium, setHealthInsuranceAnnualPremium] = useState<number | undefined>(undefined);

  const [goals, setGoals] = useState<Goal[]>([]);

  // recommended asset allocation
  const [recommendedEquity, setRecommendedEquity] = useState<number>(0);
  const [recommendedDebt, setRecommendedDebt] = useState<number>(0);
  const [recommendedGold, setRecommendedGold] = useState<number>(0);
  const [recommendedCash, setRecommendedCash] = useState<number>(0);

  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [notes, setNotes] = useState<string>("");
  const [riskProfile, setRiskProfile] = useState<string>("moderate");
  const [mfdValueAddText, setMfdValueAddText] = useState<string>(
    `Mutual Fund Distributors (MFDs) add significant "Advisor Alpha" through suitable asset allocation, disciplined periodic rebalancing, tax-loss harvesting, and critical behavioral coaching during market volatility. Industry research (such as Vanguard Advisor's Alpha) indicates that this comprehensive partnership can yield an estimated ~3% p.a. in net value-add compared to investing alone.`
  );

  // Load existing plan if editing
  useEffect(() => {
    if (!editId) return;
    setLoadingPlan(true);
    setErr(null);
    fetch(`/api/financial-plans/${editId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load financial plan");
        const data = await res.json();
        const p = data.plan;

        if (data.investor) {
          setRecipient({ id: data.investor.id, name: data.investor.name, kind: "investor" });
        } else if (data.lead) {
          setRecipient({ id: data.lead.id, name: data.lead.name, kind: "lead" });
        }

        setStatus(p.status);
        setClientAge(p.clientAge ?? undefined);
        setSpouseAge(p.spouseAge ?? undefined);
        setChildren(p.childrenDetails || []);
        setMonthlyIncome(p.monthlyIncome ? Number(p.monthlyIncome) : undefined);
        setMonthlyExpenses(p.monthlyExpenses ? Number(p.monthlyExpenses) : undefined);
        setAssets(p.assets || []);
        setLiabilities(p.liabilities || []);
        setEmergencyFundTargetMonths(p.emergencyFundTargetMonths ?? 6);
        setEmergencyFundCurrentValue(p.emergencyFundCurrentValue ? Number(p.emergencyFundCurrentValue) : 0);
        setLifeInsuranceSumAssured(p.lifeInsuranceSumAssured ? Number(p.lifeInsuranceSumAssured) : undefined);
        setLifeInsuranceAnnualPremium(p.lifeInsuranceAnnualPremium ? Number(p.lifeInsuranceAnnualPremium) : undefined);
        setHealthInsuranceSumAssured(p.healthInsuranceSumAssured ? Number(p.healthInsuranceSumAssured) : undefined);
        setHealthInsuranceAnnualPremium(p.healthInsuranceAnnualPremium ? Number(p.healthInsuranceAnnualPremium) : undefined);
        setGoals(p.goals || []);
        setRecommendedEquity(p.recommendedEquityPct ?? 0);
        setRecommendedDebt(p.recommendedDebtPct ?? 0);
        setRecommendedGold(p.recommendedGoldPct ?? 0);
        setRecommendedCash(p.recommendedCashPct ?? 0);
        setRecommendations(p.recommendations || []);
        setNotes(p.notes || "");
        setRiskProfile(p.riskProfile || "moderate");
        setMfdValueAddText(
          p.mfdValueAddText ||
          `Mutual Fund Distributors (MFDs) add significant "Advisor Alpha" through suitable asset allocation, disciplined periodic rebalancing, tax-loss harvesting, and critical behavioral coaching during market volatility. Industry research (such as Vanguard Advisor's Alpha) indicates that this comprehensive partnership can yield an estimated ~3% p.a. in net value-add compared to investing alone.`
        );
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoadingPlan(false));
  }, [editId]);

  // Calculations
  const surplus = useMemo(() => {
    if (monthlyIncome === undefined || monthlyExpenses === undefined) return 0;
    return Math.max(0, monthlyIncome - monthlyExpenses);
  }, [monthlyIncome, monthlyExpenses]);

  const savingsRate = useMemo(() => {
    if (!monthlyIncome) return 0;
    return Math.round((surplus / monthlyIncome) * 100);
  }, [monthlyIncome, surplus]);

  const totalEMI = useMemo(() => {
    return liabilities.reduce((sum, l) => sum + (l.monthlyEmi || 0), 0);
  }, [liabilities]);

  const emiToIncomePct = useMemo(() => {
    if (!monthlyIncome) return 0;
    return Math.round((totalEMI / monthlyIncome) * 100);
  }, [monthlyIncome, totalEMI]);

  const totalAssets = useMemo(() => {
    return assets.reduce((s, a) => s + Number(a.value || 0), 0);
  }, [assets]);

  const totalLiabilities = useMemo(() => {
    return liabilities.reduce((s, l) => s + Number(l.value || 0), 0);
  }, [liabilities]);

  const netWorth = totalAssets - totalLiabilities;

  const requiredEmergency = useMemo(() => {
    return (monthlyExpenses || 0) * emergencyFundTargetMonths;
  }, [monthlyExpenses, emergencyFundTargetMonths]);

  const emergencyGap = useMemo(() => {
    return Math.max(0, requiredEmergency - emergencyFundCurrentValue);
  }, [requiredEmergency, emergencyFundCurrentValue]);

  // Need-analysis (liabilities + goals + PV of family expenses − financial assets),
  // not a flat 10× income.
  const requiredLifeInsurance = useMemo(() => {
    const goalsPresentCostTotal = goals.reduce((s, g) => s + (Number(g.targetAmount) || 0), 0);
    const { recommended } = recommendedLifeCover({
      monthlyExpenses: monthlyExpenses || 0,
      totalLiabilities,
      goalsPresentCostTotal,
      financialAssets: financialAssetsTotal(assets),
      existingCover: 0,
    });
    return Math.round(recommended);
  }, [monthlyExpenses, totalLiabilities, goals, assets]);

  // Real-Time Wealth Health Score Calculation
  const healthScore = useMemo(() => {
    const inc = monthlyIncome ?? 0;
    const exp = monthlyExpenses ?? 0;
    const surplusVal = Math.max(0, inc - exp);
    const totalAssetsVal = assets.reduce((s, a) => s + Number(a.value || 0), 0);
    const totalLiabilitiesVal = liabilities.reduce((s, l) => s + Number(l.value || 0), 0);
    const targetEmergencyVal = exp * emergencyFundTargetMonths;
    const currentEmergencyVal = emergencyFundCurrentValue || 0;
    const lifeSumVal = lifeInsuranceSumAssured ?? 0;
    const healthSumVal = healthInsuranceSumAssured ?? 0;
    const suggestedLifeVal = inc * 12 * 10 + totalLiabilitiesVal;

    const rateSavings = inc ? Math.round((surplusVal / inc) * 100) : 0;
    const emiRatio = inc ? Math.round((totalEMI / inc) * 100) : 0;

    const savingsScore = rateSavings >= 30 ? 25 : rateSavings >= 15 ? 15 : rateSavings > 0 ? 5 : 0;
    const debtScore = emiRatio < 30 ? 25 : emiRatio <= 45 ? 15 : 0;
    const emergencyScore = targetEmergencyVal === 0 ? 20 : (currentEmergencyVal >= targetEmergencyVal ? 20 : Math.round((currentEmergencyVal / targetEmergencyVal) * 20));
    const lifeScore = suggestedLifeVal === 0 ? 15 : (lifeSumVal >= suggestedLifeVal ? 15 : Math.round((lifeSumVal / suggestedLifeVal) * 15));
    const healthScoreVal = healthSumVal >= 500000 ? 15 : (healthSumVal > 0 ? Math.min(15, Math.round((healthSumVal / 500000) * 15)) : 0);

    return savingsScore + debtScore + emergencyScore + lifeScore + healthScoreVal;
  }, [
    monthlyIncome,
    monthlyExpenses,
    assets,
    liabilities,
    emergencyFundTargetMonths,
    emergencyFundCurrentValue,
    lifeInsuranceSumAssured,
    healthInsuranceSumAssured,
    totalEMI
  ]);

  // Calculations for dynamic goals using computeGoal library
  const processedGoals = useMemo(() => {
    return goals.map((g) => {
      const result = computeGoal({
        presentTarget: g.targetAmount,
        currentValue: Math.max(0, g.currentValue || 0),
        existingMonthlySip: Math.max(0, g.existingMonthlySip || 0),
        monthsLeft: g.targetYears * 12,
        expectedReturnPct: g.expectedReturn,
        inflationPct: g.inflationRate,
      });

      return {
        ...g,
        futureValue: Math.round(result.futureTarget),
        requiredMonthlySip: Math.round(result.requiredMonthlySipTotal),
        additionalMonthlySip: Math.round(result.additionalMonthlySipNeeded),
        gapAmount: Math.round(result.gapAmount),
      };
    });
  }, [goals]);

  // Total ADDITIONAL SIP needed (net of money already earmarked per goal).
  const totalRequiredSip = useMemo(() => {
    return processedGoals.reduce((s, g) => s + (g.additionalMonthlySip || 0), 0);
  }, [processedGoals]);

  // Funding feasibility — can the client's surplus actually fund the SIPs?
  const investableSurplus = useMemo(() => {
    const emi = liabilities.reduce((s, l) => s + (Number(l.monthlyEmi) || 0), 0);
    return Math.max(0, (monthlyIncome || 0) - (monthlyExpenses || 0) - emi);
  }, [monthlyIncome, monthlyExpenses, liabilities]);
  const sipShortfall = Math.max(0, totalRequiredSip - investableSurplus);

  // Sub-items mutations
  function addChild() {
    setChildren([...children, { name: "", age: 0 }]);
  }

  function patchChild(idx: number, patch: Partial<Child>) {
    setChildren(children.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  function removeChild(idx: number) {
    setChildren(children.filter((_, i) => i !== idx));
  }

  function addAsset() {
    setAssets([...assets, { category: "equity", name: "", value: 0 }]);
  }

  function patchAsset(idx: number, patch: Partial<Asset>) {
    setAssets(assets.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  }

  function removeAsset(idx: number) {
    setAssets(assets.filter((_, i) => i !== idx));
  }

  function addLiability() {
    setLiabilities([...liabilities, { name: "", value: 0 }]);
  }

  function patchLiability(idx: number, patch: Partial<Liability>) {
    setLiabilities(liabilities.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function removeLiability(idx: number) {
    setLiabilities(liabilities.filter((_, i) => i !== idx));
  }

  function getRetirementDefaults(age?: number, expenses?: number, inflationRateVal?: number) {
    const years = age ? Math.max(5, 60 - age) : 25;
    const inflation = inflationRateVal !== undefined ? inflationRateVal : 6;
    const r = (1.08 / (1 + inflation / 100)) - 1;
    const annuityFactor = r > 0 ? ((1 - Math.pow(1 + r, -25)) / r) * (1 + r) : 25;
    const annualExpenses = (expenses || 0) * 12;
    const estimatedCorpusToday = Math.round(annualExpenses * annuityFactor);
    return {
      targetYears: years,
      targetAmount: estimatedCorpusToday,
      inflationRate: inflation,
    };
  }

  function addGoal() {
    const defaults = getRetirementDefaults(clientAge, monthlyExpenses, 6);
    setGoals([...goals, {
      category: "retirement",
      name: "Retirement Fund",
      targetAmount: defaults.targetAmount,
      targetYears: defaults.targetYears,
      inflationRate: defaults.inflationRate,
      expectedReturn: 12
    }]);
  }

  function patchGoal(idx: number, patch: Partial<Goal>) {
    setGoals(goals.map((g, i) => {
      if (i !== idx) return g;
      const updated = { ...g, ...patch };
      if (patch.category === "retirement" && g.category !== "retirement") {
        const defaults = getRetirementDefaults(clientAge, monthlyExpenses, updated.inflationRate);
        updated.targetYears = defaults.targetYears;
        updated.targetAmount = defaults.targetAmount;
        updated.inflationRate = defaults.inflationRate;
        if (!updated.name) {
          updated.name = "Retirement Fund";
        }
      }
      return updated;
    }));
  }

  function removeGoal(idx: number) {
    setGoals(goals.filter((_, i) => i !== idx));
  }

  function addRecommendation() {
    setRecommendations([...recommendations, { category: "investment", action: "", priority: "medium" }]);
  }

  function patchRecommendation(idx: number, patch: Partial<Recommendation>) {
    setRecommendations(recommendations.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function removeRecommendation(idx: number) {
    setRecommendations(recommendations.filter((_, i) => i !== idx));
  }

  // Auto recommendations generator basis inputs
  function generateBridges() {
    const list: Recommendation[] = [];

    if (emergencyGap > 0) {
      list.push({
        category: "emergency",
        action: `Build emergency fund of ${formatINR(requiredEmergency)} (equivalent to ${emergencyFundTargetMonths} months of expenses). Current gap is ${formatINR(emergencyGap)}.`,
        priority: "high",
        notes: "We recommend storing this in a high-interest savings account or a liquid mutual fund.",
      });
    }

    if (lifeInsuranceSumAssured === undefined || lifeInsuranceSumAssured < requiredLifeInsurance) {
      const gap = requiredLifeInsurance - (lifeInsuranceSumAssured || 0);
      list.push({
        category: "insurance",
        action: `Increase term life insurance cover by ${formatINR(gap)}. Recommended total cover is ${formatINR(requiredLifeInsurance)}.`,
        priority: "high",
        notes: "Need-analysis: outstanding liabilities + goal corpus + present value of the family's living expenses, net of existing financial assets.",
      });
    }

    if (healthInsuranceSumAssured === undefined || healthInsuranceSumAssured < 500000) {
      list.push({
        category: "insurance",
        action: "Establish premium family floater health insurance with minimum sum assured of ₹5,00,000.",
        priority: "high",
        notes: "Crucial to protect family net worth from emergency medical costs.",
      });
    }

    // Goals recommendations
    processedGoals.forEach((g) => {
      list.push({
        category: "goals",
        action: `Initiate a monthly SIP of ${formatINR(g.requiredMonthlySip || 0)} for goal "${g.name}" to build target corpus of ${formatINR(g.futureValue || 0)} in ${g.targetYears} years.`,
        priority: "medium",
        notes: `Assumed returns: ${g.expectedReturn}% · Inflation adjusted at ${g.inflationRate}%.`,
      });
    });

    setRecommendations([...recommendations, ...list]);
  }

  // Save/Update API Submit
  async function onSubmit() {
    if (!recipient) {
      setErr("Please select a client or lead.");
      return;
    }

    // Validate Asset Allocation Sum is 100 or 0
    const allocSum = recommendedEquity + recommendedDebt + recommendedGold + recommendedCash;
    if (allocSum !== 100 && allocSum !== 0) {
      setErr(`Recommended Asset Allocation sum must be exactly 100% (Current sum is ${allocSum}%).`);
      return;
    }

    setBusy(true);
    setErr(null);

    const payload = {
      ...(recipient.kind === "lead" ? { leadId: recipient.id } : { investorId: recipient.id }),
      status,
      clientAge: clientAge ?? null,
      spouseAge: spouseAge ?? null,
      childrenDetails: children,
      monthlyIncome: monthlyIncome ?? null,
      monthlyExpenses: monthlyExpenses ?? null,
      assets,
      liabilities,
      emergencyFundTargetMonths,
      emergencyFundCurrentValue: emergencyFundCurrentValue || 0,
      lifeInsuranceSumAssured: lifeInsuranceSumAssured ?? null,
      lifeInsuranceAnnualPremium: lifeInsuranceAnnualPremium ?? null,
      healthInsuranceSumAssured: healthInsuranceSumAssured ?? null,
      healthInsuranceAnnualPremium: healthInsuranceAnnualPremium ?? null,
      goals: processedGoals,
      recommendedEquityPct: recommendedEquity,
      recommendedDebtPct: recommendedDebt,
      recommendedGoldPct: recommendedGold,
      recommendedCashPct: recommendedCash,
      recommendations,
      notes: notes || null,
      riskProfile,
      savingsRate,
      emiToIncomePct,
      mfdValueAddText: mfdValueAddText || null,
    };

    try {
      const url = editId ? `/api/financial-plans/${editId}` : "/api/financial-plans";
      const method = editId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Operation failed with code ${res.status}`);
        return;
      }

      router.push(`/dashboard/financial-plans/${editId ? editId : j.id}`);
    } catch (e: any) {
      setErr(e.message ?? "An unexpected network error occurred.");
    } finally {
      setBusy(false);
    }
  }

  if (loadingPlan) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <Loader2 className="size-8 text-brand-cyan animate-spin" />
        <p className="text-sm text-muted-foreground">Loading financial plan...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <Link
        href="/dashboard/financial-plans"
        className="text-sm text-muted-foreground hover:underline hover:text-foreground flex items-center gap-1 transition-colors"
      >
        <ChevronLeft className="size-4" /> Back to list
      </Link>

      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">
            <ScrollText className="size-6 text-brand-cyan" /> {editId ? "Edit" : "New"} Financial Plan
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {/* Real-time Health Score Badge */}
          <div className="flex items-center gap-2 px-3 py-1 bg-gradient-to-r from-brand-navy-light/10 to-secondary/30 border border-brand-cyan/20 rounded-lg text-xs">
            <span className="text-[10px] text-muted-foreground uppercase font-bold">Health Score:</span>
            <span className={`font-extrabold text-sm tabular-nums ${healthScore >= 85 ? "text-emerald-600" : healthScore >= 60 ? "text-amber-500" : "text-rose-600"
              }`}>
              {healthScore}
            </span>
            <span className="text-[9px] text-muted-foreground">/100</span>
          </div>

          <SelectField
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
            className="input-base text-xs font-semibold py-1 bg-card w-36"
          >
            <option value="draft">Draft Mode</option>
            <option value="finalized">Finalized</option>
          </SelectField>
        </div>
      </div>

      {/* Step Indicators */}
      <div className="bg-card border border-border/60 rounded-xl p-3 flex items-center justify-between overflow-x-auto gap-4">
        {[
          { step: 1, label: "1. Profiling" },
          { step: 2, label: "2. Cash & Assets" },
          { step: 3, label: "3. Protection" },
          { step: 4, label: "4. Goals Calc" },
          { step: 5, label: "5. Roadmap" },
        ].map((s) => (
          <button
            key={s.step}
            type="button"
            onClick={() => setStep(s.step)}
            className={`px-4 py-2 text-xs font-bold rounded-lg whitespace-nowrap transition-all ${step === s.step
                ? "bg-brand-cyan-light text-brand-cyan-deep border border-brand-cyan/20 shadow-sm"
                : "text-muted-foreground hover:bg-secondary/40"
              }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {err && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm px-4 py-3 flex items-center gap-2">
          <AlertTriangle className="size-4 flex-shrink-0" />
          <span>{err}</span>
        </div>
      )}

      {/* STEP 1: Profiling */}
      {step === 1 && (
        <div className="card-surface p-6 space-y-4 animate-fade-in">
          <div className="flex items-center gap-2 pb-2 border-b">
            <ScrollText className="size-5 text-brand-cyan" />
            <h2 className="section-title text-base">Client Demographics</h2>
          </div>

          <div className="space-y-4">
            <label className="block">
              <div className="text-xs font-bold mb-1.5">Select Client or Lead *</div>
              <InvestorLookup
                value={recipient?.id ?? null}
                displayName={recipient?.name ?? null}
                includeLeads
                displayKind={recipient?.kind}
                onSelect={(id, name, kind) => setRecipient({ id, name, kind: kind ?? "investor" })}
                onClear={() => setRecipient(null)}
                placeholder="Search client or lead by name, PAN, mobile…"
              />
            </label>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="block">
                <div className="text-xs font-bold mb-1">Client Age</div>
                <input
                  type="number"
                  min="0"
                  max="120"
                  value={clientAge ?? ""}
                  onChange={(e) => setClientAge(e.target.value ? Number(e.target.value) : undefined)}
                  className="input-base"
                  placeholder="e.g. 35"
                />
              </label>

              <label className="block">
                <div className="text-xs font-bold mb-1">Spouse Age</div>
                <input
                  type="number"
                  min="0"
                  max="120"
                  value={spouseAge ?? ""}
                  onChange={(e) => setSpouseAge(e.target.value ? Number(e.target.value) : undefined)}
                  className="input-base"
                  placeholder="e.g. 33"
                />
              </label>

              <label className="block">
                <div className="text-xs font-bold mb-1">Client Risk Profile</div>
                <SelectField
                  value={riskProfile}
                  onChange={(e) => setRiskProfile(e.target.value)}
                  className="input-base bg-card"
                >
                  <option value="conservative">Conservative</option>
                  <option value="moderately_conservative">Moderately Conservative</option>
                  <option value="moderate">Moderate</option>
                  <option value="moderately_aggressive">Moderately Aggressive</option>
                  <option value="aggressive">Aggressive</option>
                </SelectField>
              </label>
            </div>

            {/* Children Details */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold">Children Details</div>
                <button
                  type="button"
                  onClick={addChild}
                  className="text-xs text-brand-cyan hover:underline flex items-center gap-1 font-bold"
                >
                  <Plus className="size-3" /> Add Child
                </button>
              </div>

              {children.length === 0 ? (
                <p className="text-xs text-muted-foreground italic bg-secondary/20 p-3 rounded-lg text-center">
                  No children added.
                </p>
              ) : (
                <div className="space-y-2">
                  {children.map((c, i) => (
                    <div key={i} className="flex items-center gap-2 bg-secondary/10 p-2.5 rounded-lg border">
                      <input
                        type="text"
                        placeholder="Child's Name"
                        value={c.name}
                        onChange={(e) => patchChild(i, { name: e.target.value })}
                        className="input-base text-xs flex-1 py-1"
                      />
                      <input
                        type="number"
                        placeholder="Age"
                        value={c.age || ""}
                        onChange={(e) => patchChild(i, { age: Number(e.target.value) })}
                        className="input-base text-xs w-20 py-1"
                      />
                      <button
                        type="button"
                        onClick={() => removeChild(i)}
                        className="p-1 text-rose-600 hover:bg-rose-50 rounded"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: Cash & Assets */}
      {step === 2 && (
        <div className="space-y-6 animate-fade-in">
          {/* Cash Flow */}
          <div className="card-surface p-6 space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b">
              <DollarSign className="size-5 text-emerald-600" />
              <h2 className="section-title text-base">Monthly Cash Flow</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <div className="text-xs font-bold mb-1">Monthly Inflow (Income)</div>
                <input
                  type="number"
                  value={monthlyIncome ?? ""}
                  onChange={(e) => setMonthlyIncome(e.target.value ? Number(e.target.value) : undefined)}
                  className="input-base font-semibold"
                  placeholder="₹ Monthly Net Inflow"
                />
              </label>

              <label className="block">
                <div className="text-xs font-bold mb-1">Monthly Outflow (Expenses)</div>
                <input
                  type="number"
                  value={monthlyExpenses ?? ""}
                  onChange={(e) => setMonthlyExpenses(e.target.value ? Number(e.target.value) : undefined)}
                  className="input-base font-semibold"
                  placeholder="₹ Monthly Outflow"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-emerald-50 border border-emerald-200/50 rounded-xl p-3.5 flex flex-col justify-between text-emerald-800">
                <span className="text-[10px] uppercase font-bold text-emerald-700/80">Monthly Surplus</span>
                <span className="text-base font-extrabold tabular-nums mt-1">{formatINR(surplus)}</span>
              </div>
              <div className={`border rounded-xl p-3.5 flex flex-col justify-between ${savingsRate >= 30
                  ? "bg-emerald-50 border-emerald-200/50 text-emerald-800"
                  : savingsRate >= 15
                    ? "bg-amber-50 border-amber-200/50 text-amber-800"
                    : "bg-rose-50 border-rose-200/50 text-rose-800"
                }`}>
                <span className="text-[10px] uppercase font-bold opacity-80">Savings Rate</span>
                <span className="text-base font-extrabold tabular-nums mt-1">{savingsRate}%
                  <span className="text-[10px] font-normal ml-1">
                    ({savingsRate >= 30 ? "Excellent" : savingsRate >= 15 ? "Average" : "Low"})
                  </span>
                </span>
              </div>
              <div className={`border rounded-xl p-3.5 flex flex-col justify-between ${emiToIncomePct > 45
                  ? "bg-rose-50 border-rose-200/50 text-rose-800"
                  : emiToIncomePct >= 30
                    ? "bg-amber-50 border-amber-200/50 text-amber-800"
                    : "bg-emerald-50 border-emerald-200/50 text-emerald-800"
                }`}>
                <span className="text-[10px] uppercase font-bold opacity-80">Debt-to-Income (EMI Ratio)</span>
                <span className="text-base font-extrabold tabular-nums mt-1">{emiToIncomePct}%
                  <span className="text-[10px] font-normal ml-1">
                    ({emiToIncomePct > 45 ? "Critical" : emiToIncomePct >= 30 ? "Moderate" : "Safe"})
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* Assets and Liabilities */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Assets */}
            <div className="card-surface p-6 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b">
                <h3 className="section-title text-sm flex items-center gap-1.5 text-brand-navy">
                  <TrendingUp className="size-4" /> Assets Register
                </h3>
                <button
                  type="button"
                  onClick={addAsset}
                  className="text-xs text-brand-cyan hover:underline flex items-center gap-1 font-bold"
                >
                  <Plus className="size-3" /> Add Asset
                </button>
              </div>

              {assets.length === 0 ? (
                <p className="text-xs text-muted-foreground italic text-center py-6">No assets registered yet.</p>
              ) : (
                <div className="space-y-3">
                  {assets.map((a, i) => (
                    <div key={i} className="bg-secondary/10 p-3 rounded-lg border space-y-2">
                      <div className="flex items-center gap-2">
                        <SelectField
                          value={a.category}
                          onChange={(e) => patchAsset(i, { category: e.target.value as any })}
                          className="input-base text-xs py-1"
                        >
                          <option value="equity">Equity Mutual Funds / Shares</option>
                          <option value="debt">Debt Mutual Funds / FDs</option>
                          <option value="gold">Gold / SGBs</option>
                          <option value="real_estate">Real Estate</option>
                          <option value="cash">Liquid Cash / Bank Bal</option>
                          <option value="other">Other Asset</option>
                        </SelectField>
                        <button
                          type="button"
                          onClick={() => removeAsset(i)}
                          className="p-1 text-rose-600 hover:bg-rose-50 rounded"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          placeholder="Asset Name (e.g. HDFC Flexi)"
                          value={a.name}
                          onChange={(e) => patchAsset(i, { name: e.target.value })}
                          className="input-base text-xs py-1"
                        />
                        <input
                          type="number"
                          placeholder="Current Value"
                          value={a.value || ""}
                          onChange={(e) => patchAsset(i, { value: Number(e.target.value) })}
                          className="input-base text-xs py-1 font-semibold"
                        />
                      </div>
                    </div>
                  ))}
                  <div className="pt-2 flex justify-between text-xs font-bold border-t">
                    <span>Total Assets:</span>
                    <span className="tabular-nums">{formatINR(totalAssets)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Liabilities */}
            <div className="card-surface p-6 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b">
                <h3 className="section-title text-sm flex items-center gap-1.5 text-rose-700">
                  <Briefcase className="size-4 text-rose-600" /> Liabilities Register
                </h3>
                <button
                  type="button"
                  onClick={addLiability}
                  className="text-xs text-brand-cyan hover:underline flex items-center gap-1 font-bold"
                >
                  <Plus className="size-3" /> Add Liability
                </button>
              </div>

              {liabilities.length === 0 ? (
                <p className="text-xs text-muted-foreground italic text-center py-6">No liabilities registered.</p>
              ) : (
                <div className="space-y-3">
                  {liabilities.map((l, i) => (
                    <div key={i} className="bg-secondary/10 p-3 rounded-lg border space-y-2">
                      <div className="flex items-center justify-between">
                        <input
                          type="text"
                          placeholder="Liability Name (e.g. Home Loan)"
                          value={l.name}
                          onChange={(e) => patchLiability(i, { name: e.target.value })}
                          className="input-base text-xs py-1"
                        />
                        <button
                          type="button"
                          onClick={() => removeLiability(i)}
                          className="p-1 text-rose-600 hover:bg-rose-50 rounded"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="number"
                          placeholder="Outstanding Value"
                          value={l.value || ""}
                          onChange={(e) => patchLiability(i, { value: Number(e.target.value) })}
                          className="input-base text-xs py-1 font-semibold"
                        />
                        <input
                          type="number"
                          placeholder="Monthly EMI (optional)"
                          value={l.monthlyEmi || ""}
                          onChange={(e) => patchLiability(i, { monthlyEmi: e.target.value ? Number(e.target.value) : undefined })}
                          className="input-base text-xs py-1"
                        />
                      </div>
                    </div>
                  ))}
                  <div className="pt-2 flex justify-between text-xs font-bold border-t">
                    <span className="text-rose-700">Total Liabilities:</span>
                    <span className="tabular-nums text-rose-700">{formatINR(totalLiabilities)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Current Asset Allocation Mix Panel */}
          {totalAssets > 0 && (
            <div className="card-surface p-4 space-y-3">
              <div className="text-[10px] uppercase font-bold text-muted-foreground pb-1 border-b">
                Current Asset Allocation Mix
              </div>
              <div className="h-3 rounded-full bg-secondary overflow-hidden flex">
                {(() => {
                  const eq = assets.filter(a => a.category === 'equity').reduce((s, a) => s + (a.value || 0), 0);
                  const dt = assets.filter(a => a.category === 'debt').reduce((s, a) => s + (a.value || 0), 0);
                  const gd = assets.filter(a => a.category === 'gold').reduce((s, a) => s + (a.value || 0), 0);
                  const cs = assets.filter(a => a.category === 'cash').reduce((s, a) => s + (a.value || 0), 0);
                  const ot = assets.filter(a => a.category === 'real_estate' || a.category === 'other').reduce((s, a) => s + (a.value || 0), 0);
                  const eqPct = totalAssets ? (eq / totalAssets) * 100 : 0;
                  const dtPct = totalAssets ? (dt / totalAssets) * 100 : 0;
                  const gdPct = totalAssets ? (gd / totalAssets) * 100 : 0;
                  const csPct = totalAssets ? (cs / totalAssets) * 100 : 0;
                  const otPct = totalAssets ? (ot / totalAssets) * 100 : 0;
                  return (
                    <>
                      {eq > 0 && <div style={{ width: `${eqPct}%` }} className="bg-emerald-500 h-full" title={`Equity: ${Math.round(eqPct)}%`} />}
                      {dt > 0 && <div style={{ width: `${dtPct}%` }} className="bg-blue-500 h-full" title={`Debt: ${Math.round(dtPct)}%`} />}
                      {gd > 0 && <div style={{ width: `${gdPct}%` }} className="bg-amber-500 h-full" title={`Gold: ${Math.round(gdPct)}%`} />}
                      {cs > 0 && <div style={{ width: `${csPct}%` }} className="bg-slate-500 h-full" title={`Cash: ${Math.round(csPct)}%`} />}
                      {ot > 0 && <div style={{ width: `${otPct}%` }} className="bg-purple-500 h-full" title={`Others: ${Math.round(otPct)}%`} />}
                    </>
                  );
                })()}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10px]">
                {(() => {
                  const eq = assets.filter(a => a.category === 'equity').reduce((s, a) => s + (a.value || 0), 0);
                  const dt = assets.filter(a => a.category === 'debt').reduce((s, a) => s + (a.value || 0), 0);
                  const gd = assets.filter(a => a.category === 'gold').reduce((s, a) => s + (a.value || 0), 0);
                  const cs = assets.filter(a => a.category === 'cash').reduce((s, a) => s + (a.value || 0), 0);
                  const ot = assets.filter(a => a.category === 'real_estate' || a.category === 'other').reduce((s, a) => s + (a.value || 0), 0);
                  return (
                    <>
                      <div className="flex items-center gap-1">
                        <span className="size-2 rounded bg-emerald-500 inline-block" />
                        <span>Equity: <strong className="text-foreground">{totalAssets ? Math.round(eq / totalAssets * 100) : 0}%</strong></span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="size-2 rounded bg-blue-500 inline-block" />
                        <span>Debt: <strong className="text-foreground">{totalAssets ? Math.round(dt / totalAssets * 100) : 0}%</strong></span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="size-2 rounded bg-amber-500 inline-block" />
                        <span>Gold: <strong className="text-foreground">{totalAssets ? Math.round(gd / totalAssets * 100) : 0}%</strong></span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="size-2 rounded bg-slate-500 inline-block" />
                        <span>Cash: <strong className="text-foreground">{totalAssets ? Math.round(cs / totalAssets * 100) : 0}%</strong></span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="size-2 rounded bg-purple-500 inline-block" />
                        <span>Others: <strong className="text-foreground">{totalAssets ? Math.round(ot / totalAssets * 100) : 0}%</strong></span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Net Worth Summary Panel */}
          <div className="card-surface p-4 bg-gradient-to-r from-brand-navy-light to-secondary/30 border border-brand-navy/10 flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase font-bold text-muted-foreground">Estimated Net Worth</div>
              <p className="text-xs text-muted-foreground">Total Assets minus Total Liabilities</p>
            </div>
            <div className={`text-xl font-bold tabular-nums ${netWorth >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
              {formatINR(netWorth)}
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: Protection & Emergency */}
      {step === 3 && (
        <div className="space-y-6 animate-fade-in">
          {/* Emergency Fund */}
          <div className="card-surface p-6 space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b">
              <Shield className="size-5 text-brand-cyan" />
              <h2 className="section-title text-base">Emergency Fund Planning</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <div className="text-xs font-bold mb-1">Target Months of Expenses Buffer</div>
                <input
                  type="number"
                  min="1"
                  max="36"
                  value={emergencyFundTargetMonths}
                  onChange={(e) => setEmergencyFundTargetMonths(Number(e.target.value))}
                  className="input-base"
                />
              </label>

              <label className="block">
                <div className="text-xs font-bold mb-1">Current Emergency Cash/Liquid Balance</div>
                <input
                  type="number"
                  min="0"
                  value={emergencyFundCurrentValue}
                  onChange={(e) => setEmergencyFundCurrentValue(Number(e.target.value))}
                  className="input-base"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-secondary/20 p-4 rounded-xl border text-xs">
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">Required Buffer Fund:</span>
                <span className="font-bold tabular-nums">{formatINR(requiredEmergency)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">Current Buffer Available:</span>
                <span className="font-bold tabular-nums">{formatINR(emergencyFundCurrentValue)}</span>
              </div>
              <div className="flex justify-between py-1 border-t pt-2 md:col-span-2">
                <span className="font-semibold text-brand-navy">Emergency Fund Shortfall/Gap:</span>
                <span className={`font-bold tabular-nums ${emergencyGap > 0 ? "text-amber-600" : "text-emerald-700"}`}>
                  {emergencyGap > 0 ? formatINR(emergencyGap) : "Covered! No gap"}
                </span>
              </div>
              {requiredEmergency > 0 && (
                <div className="md:col-span-2 space-y-1 mt-1 border-t pt-2">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">Buffer Adequacy:</span>
                    <span className="font-bold tabular-nums">
                      {Math.min(100, Math.round((emergencyFundCurrentValue / requiredEmergency) * 100))}%
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                    <div
                      style={{ width: `${Math.min(100, (emergencyFundCurrentValue / requiredEmergency) * 100)}%` }}
                      className={`h-full rounded-full transition-all ${emergencyFundCurrentValue >= requiredEmergency ? "bg-emerald-500" : "bg-amber-500"
                        }`}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Insurance adequacy */}
          <div className="card-surface p-6 space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b">
              <Shield className="size-5 text-blue-600" />
              <h2 className="section-title text-base">Insurance Adequacy Analysis</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Life Insurance */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-brand-navy border-b pb-1">Life Insurance (Term Policy)</h3>
                <label className="block">
                  <div className="text-[11px] text-muted-foreground mb-1">Current Sum Assured</div>
                  <input
                    type="number"
                    value={lifeInsuranceSumAssured ?? ""}
                    onChange={(e) => setLifeInsuranceSumAssured(e.target.value ? Number(e.target.value) : undefined)}
                    className="input-base text-sm py-1.5"
                    placeholder="₹ Total coverage"
                  />
                </label>
                <label className="block">
                  <div className="text-[11px] text-muted-foreground mb-1">Annual Premium</div>
                  <input
                    type="number"
                    value={lifeInsuranceAnnualPremium ?? ""}
                    onChange={(e) => setLifeInsuranceAnnualPremium(e.target.value ? Number(e.target.value) : undefined)}
                    className="input-base text-sm py-1.5"
                    placeholder="₹ Annual Premium paid"
                  />
                </label>
                <div className="bg-secondary/30 p-2.5 rounded-lg border text-[11px] flex justify-between">
                  <span className="text-muted-foreground">Adequacy Goal (10x income + debt):</span>
                  <span className="font-bold tabular-nums">{formatINR(requiredLifeInsurance)}</span>
                </div>
                {requiredLifeInsurance > 0 && lifeInsuranceSumAssured !== undefined && (
                  <div className="space-y-1 mt-2">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">Coverage Adequacy:</span>
                      <span className="font-bold tabular-nums">
                        {Math.min(100, Math.round((lifeInsuranceSumAssured / requiredLifeInsurance) * 100))}%
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                      <div
                        style={{ width: `${Math.min(100, (lifeInsuranceSumAssured / requiredLifeInsurance) * 100)}%` }}
                        className={`h-full rounded-full transition-all ${lifeInsuranceSumAssured >= requiredLifeInsurance ? "bg-emerald-500" : "bg-amber-500"
                          }`}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Health Insurance */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-brand-navy border-b pb-1">Health Insurance (Family Floater)</h3>
                <label className="block">
                  <div className="text-[11px] text-muted-foreground mb-1">Current Sum Assured</div>
                  <input
                    type="number"
                    value={healthInsuranceSumAssured ?? ""}
                    onChange={(e) => setHealthInsuranceSumAssured(e.target.value ? Number(e.target.value) : undefined)}
                    className="input-base text-sm py-1.5"
                    placeholder="₹ Total coverage"
                  />
                </label>
                <label className="block">
                  <div className="text-[11px] text-muted-foreground mb-1">Annual Premium</div>
                  <input
                    type="number"
                    value={healthInsuranceAnnualPremium ?? ""}
                    onChange={(e) => setHealthInsuranceAnnualPremium(e.target.value ? Number(e.target.value) : undefined)}
                    className="input-base text-sm py-1.5"
                    placeholder="₹ Annual Premium paid"
                  />
                </label>
                <div className="bg-secondary/30 p-2.5 rounded-lg border text-[11px] flex justify-between">
                  <span className="text-muted-foreground">Suggested Minimum:</span>
                  <span className="font-bold">₹ 5,00,000 - ₹ 10,000,000</span>
                </div>
                {healthInsuranceSumAssured !== undefined && (
                  <div className="space-y-1 mt-2">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">Coverage Adequacy:</span>
                      <span className="font-bold tabular-nums">
                        {Math.min(100, Math.round((healthInsuranceSumAssured / 500000) * 100))}%
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                      <div
                        style={{ width: `${Math.min(100, (healthInsuranceSumAssured / 500000) * 100)}%` }}
                        className={`h-full rounded-full transition-all ${healthInsuranceSumAssured >= 500000 ? "bg-emerald-500" : "bg-amber-500"
                          }`}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 4: Goals Planning */}
      {step === 4 && (
        <div className="card-surface p-6 space-y-4 animate-fade-in">
          <div className="flex items-center justify-between pb-2 border-b">
            <div className="flex items-center gap-2">
              <TrendingUp className="size-5 text-brand-cyan" />
              <h2 className="section-title text-base">Goal Planner & Inflation/SIP Calculator</h2>
            </div>
            <button
              type="button"
              onClick={addGoal}
              className="text-xs text-brand-cyan hover:underline flex items-center gap-1 font-bold"
            >
              <Plus className="size-3" /> Add Goal
            </button>
          </div>

          {goals.length === 0 ? (
            <div className="text-center py-10 text-xs text-muted-foreground italic bg-secondary/15 rounded-xl border border-dashed">
              No financial goals set. Click 'Add Goal' to create goals like Child Education, Retirement, etc.
            </div>
          ) : (
            <div className="space-y-4">
              {goals.map((g, i) => {
                const processed = processedGoals[i] || g;
                return (
                  <div key={i} className="bg-secondary/10 border rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2 border-b pb-2">
                      <div className="flex items-center gap-2 flex-1">
                        <SelectField
                          value={g.category}
                          onChange={(e) => patchGoal(i, { category: e.target.value })}
                          className="input-base text-xs py-1 max-w-[150px]"
                        >
                          {GOAL_CATEGORIES.map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.label}
                            </option>
                          ))}
                        </SelectField>
                        <input
                          type="text"
                          placeholder="Goal Label (e.g. Aarav's Masters)"
                          value={g.name}
                          onChange={(e) => patchGoal(i, { name: e.target.value })}
                          className="input-base text-xs py-1 flex-1"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeGoal(i)}
                        className="p-1 text-rose-600 hover:bg-rose-50 rounded"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <label className="block">
                        <span className="text-[10px] text-muted-foreground">Current Cost (₹)</span>
                        <input
                          type="number"
                          value={g.targetAmount || ""}
                          onChange={(e) => patchGoal(i, { targetAmount: Number(e.target.value) })}
                          className="input-base py-1 text-xs font-semibold mt-1"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-muted-foreground">Years to Goal</span>
                        <input
                          type="number"
                          value={g.targetYears || ""}
                          onChange={(e) => patchGoal(i, { targetYears: Number(e.target.value) })}
                          className="input-base py-1 text-xs mt-1"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-muted-foreground">Inflation Rate (%)</span>
                        <input
                          type="number"
                          value={g.inflationRate || ""}
                          onChange={(e) => patchGoal(i, { inflationRate: Number(e.target.value) })}
                          className="input-base py-1 text-xs mt-1"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-muted-foreground">Exp. Return (%)</span>
                        <input
                          type="number"
                          value={g.expectedReturn || ""}
                          onChange={(e) => patchGoal(i, { expectedReturn: Number(e.target.value) })}
                          className="input-base py-1 text-xs mt-1"
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <label className="block">
                        <span className="text-[10px] text-muted-foreground">Already saved for this goal (₹)</span>
                        <input
                          type="number"
                          value={g.currentValue || ""}
                          onChange={(e) => patchGoal(i, { currentValue: Number(e.target.value) })}
                          className="input-base py-1 text-xs mt-1"
                          placeholder="0"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-muted-foreground">Existing SIP for this goal (₹/mo)</span>
                        <input
                          type="number"
                          value={g.existingMonthlySip || ""}
                          onChange={(e) => patchGoal(i, { existingMonthlySip: Number(e.target.value) })}
                          className="input-base py-1 text-xs mt-1"
                          placeholder="0"
                        />
                      </label>
                    </div>

                    {g.category === "retirement" && (
                      <div className="bg-brand-cyan-light/20 border border-brand-cyan/20 rounded-lg p-3 text-xs space-y-2">
                        <div className="flex items-center justify-between font-bold text-brand-cyan-deep">
                          <span>Retirement Auto-Calculator Parameters</span>
                          <button
                            type="button"
                            onClick={() => {
                              if (!clientAge || !monthlyExpenses) {
                                alert("Please ensure 'Client Age' (Step 1) and 'Monthly Outflow (Expenses)' (Step 2) are filled out before syncing with profile.");
                                return;
                              }
                              const def = getRetirementDefaults(clientAge, monthlyExpenses, g.inflationRate);
                              patchGoal(i, {
                                targetAmount: def.targetAmount,
                                targetYears: def.targetYears,
                                inflationRate: def.inflationRate,
                              });
                            }}
                            className="px-2 py-0.5 bg-brand-cyan-deep text-white rounded text-[10px] hover:bg-brand-cyan-deep/80 transition-colors font-bold"
                          >
                            Sync with Profile
                          </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-slate-700">
                          <div>
                            <span className="text-[10px] text-muted-foreground block">Monthly Expense Today:</span>
                            <span className="font-semibold">{formatINR(monthlyExpenses || 0)}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-muted-foreground block">Expense at Retirement:</span>
                            <span className="font-semibold">
                              {formatINR(Math.round((monthlyExpenses || 0) * Math.pow(1 + (g.inflationRate || 6) / 100, g.targetYears)))}/mo
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-muted-foreground block">Suggested Corpus Today:</span>
                            <span className="font-semibold text-emerald-700">
                              {formatINR(Math.round((monthlyExpenses || 0) * 12 * (
                                (() => {
                                  const inf = g.inflationRate || 6;
                                  const rate = (1.08 / (1 + inf / 100)) - 1;
                                  return rate > 0 ? ((1 - Math.pow(1 + rate, -25)) / rate) * (1 + rate) : 25;
                                })()
                              )))}
                            </span>
                          </div>
                        </div>
                        <p className="text-[10px] text-slate-500 leading-normal">
                          *Assumptions: retirement at 60, life expectancy 85 (25 years in retirement), post-retirement return 8% p.a., inflation {g.inflationRate || 6}%.
                        </p>
                      </div>
                    )}

                    {/* Result outputs for the goal */}
                    <div className="grid grid-cols-3 gap-3 bg-card border border-border/40 p-2.5 rounded-lg text-xs">
                      <div>
                        <div className="text-[10px] text-muted-foreground">Future Cost (Inflation Adjusted):</div>
                        <div className="font-bold text-brand-navy tabular-nums mt-0.5">
                          {formatINR(processed.futureValue || 0)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">New SIP needed:</div>
                        <div className="font-bold text-emerald-700 tabular-nums mt-0.5">
                          {formatINR(processed.additionalMonthlySip || 0)} /mo
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">Total required (gross):</div>
                        <div className="font-semibold text-muted-foreground tabular-nums mt-0.5">
                          {formatINR(processed.requiredMonthlySip || 0)} /mo
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className="p-4 bg-emerald-50 border border-emerald-200/50 rounded-xl flex items-center justify-between text-emerald-800 font-bold text-sm">
                <span>New Monthly SIP Needed (net of existing):</span>
                <span className="tabular-nums text-base">{formatINR(totalRequiredSip)} /mo</span>
              </div>

              {/* Funding feasibility — can the surplus actually fund these SIPs? */}
              <div
                className={`p-4 rounded-xl border text-sm flex items-start justify-between gap-3 ${sipShortfall > 0
                    ? "bg-rose-50 border-rose-200 text-rose-800"
                    : "bg-emerald-50 border-emerald-200/50 text-emerald-800"
                  }`}
              >
                <div>
                  <div className="font-bold">
                    {sipShortfall > 0 ? "Plan is under-funded" : "Plan is fundable from surplus"}
                  </div>
                  <div className="text-xs mt-0.5 opacity-90">
                    Investable surplus {formatINR(investableSurplus)}/mo vs new SIP {formatINR(totalRequiredSip)}/mo.
                    {sipShortfall > 0
                      ? ` Short by ${formatINR(sipShortfall)}/mo — prioritise goals, extend timelines, or raise income.`
                      : " The required SIPs fit within the monthly surplus."}
                  </div>
                </div>
                <span className="tabular-nums text-base font-bold shrink-0">
                  {investableSurplus > 0 ? Math.round((totalRequiredSip / investableSurplus) * 100) : (totalRequiredSip > 0 ? "∞" : 0)}%
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* STEP 5: Roadmap & Allocation */}
      {step === 5 && (
        <div className="space-y-6 animate-fade-in">
          {/* Recommended Allocation */}
          <div className="card-surface p-6 space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b">
              <TrendingUp className="size-5 text-brand-cyan" />
              <h2 className="section-title text-base">Recommended Asset Allocation (%)</h2>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <label className="block">
                <span className="text-xs font-semibold">Equity (%)</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={recommendedEquity}
                  onChange={(e) => setRecommendedEquity(Number(e.target.value))}
                  className="input-base font-bold mt-1"
                />
              </label>

              <label className="block">
                <span className="text-xs font-semibold">Debt (%)</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={recommendedDebt}
                  onChange={(e) => setRecommendedDebt(Number(e.target.value))}
                  className="input-base font-bold mt-1"
                />
              </label>

              <label className="block">
                <span className="text-xs font-semibold">Gold (%)</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={recommendedGold}
                  onChange={(e) => setRecommendedGold(Number(e.target.value))}
                  className="input-base font-bold mt-1"
                />
              </label>

              <label className="block">
                <span className="text-xs font-semibold">Cash / Liquid (%)</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={recommendedCash}
                  onChange={(e) => setRecommendedCash(Number(e.target.value))}
                  className="input-base font-bold mt-1"
                />
              </label>
            </div>

            {/* Visual Recommended Allocation Mix Bar */}
            {(recommendedEquity > 0 || recommendedDebt > 0 || recommendedGold > 0 || recommendedCash > 0) && (
              <div className="space-y-2 pt-2 border-t">
                <div className="text-[10px] uppercase font-bold text-muted-foreground">
                  Recommended Allocation Preview
                </div>
                <div className="h-3 rounded-full bg-secondary overflow-hidden flex">
                  {recommendedEquity > 0 && <div style={{ width: `${recommendedEquity}%` }} className="bg-emerald-500 h-full transition-all" title={`Equity: ${recommendedEquity}%`} />}
                  {recommendedDebt > 0 && <div style={{ width: `${recommendedDebt}%` }} className="bg-blue-500 h-full transition-all" title={`Debt: ${recommendedDebt}%`} />}
                  {recommendedGold > 0 && <div style={{ width: `${recommendedGold}%` }} className="bg-amber-500 h-full transition-all" title={`Gold: ${recommendedGold}%`} />}
                  {recommendedCash > 0 && <div style={{ width: `${recommendedCash}%` }} className="bg-slate-500 h-full transition-all" title={`Cash: ${recommendedCash}%`} />}
                </div>
                <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground mt-1">
                  {recommendedEquity > 0 && <div className="flex items-center gap-1"><span className="size-2 rounded bg-emerald-500 inline-block" /><span>Equity: <strong>{recommendedEquity}%</strong></span></div>}
                  {recommendedDebt > 0 && <div className="flex items-center gap-1"><span className="size-2 rounded bg-blue-500 inline-block" /><span>Debt: <strong>{recommendedDebt}%</strong></span></div>}
                  {recommendedGold > 0 && <div className="flex items-center gap-1"><span className="size-2 rounded bg-amber-500 inline-block" /><span>Gold: <strong>{recommendedGold}%</strong></span></div>}
                  {recommendedCash > 0 && <div className="flex items-center gap-1"><span className="size-2 rounded bg-slate-500 inline-block" /><span>Cash: <strong>{recommendedCash}%</strong></span></div>}
                </div>
              </div>
            )}

            {/* Total Allocation Check */}
            <div className="flex justify-between items-center text-xs border-t pt-3">
              <span className="text-muted-foreground font-semibold">Total Allocation sum:</span>
              <span
                className={`font-bold text-sm ${recommendedEquity + recommendedDebt + recommendedGold + recommendedCash === 100
                    ? "text-emerald-700"
                    : "text-rose-600"
                  }`}
              >
                {recommendedEquity + recommendedDebt + recommendedGold + recommendedCash}% (Should be 100%)
              </span>
            </div>
          </div>

          {/* Action Roadmap */}
          <div className="card-surface p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b">
              <div className="flex items-center gap-2">
                <Briefcase className="size-5 text-brand-cyan" />
                <h2 className="section-title text-base">Action Recommendations</h2>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={generateBridges}
                  className="text-xs btn-secondary py-1 font-bold"
                  title="Generate basic suggestions based on emergency & insurance adequacy gaps"
                >
                  Auto-Generate Gaps Plan
                </button>
                <button
                  type="button"
                  onClick={addRecommendation}
                  className="text-xs text-brand-cyan hover:underline flex items-center gap-1 font-bold"
                >
                  <Plus className="size-3" /> Add Recommendation
                </button>
              </div>
            </div>

            {recommendations.length === 0 ? (
              <p className="text-xs text-muted-foreground italic text-center py-6">
                No custom recommendations added. Click 'Auto-Generate' or 'Add Recommendation'.
              </p>
            ) : (
              <div className="space-y-3">
                {recommendations.map((r, i) => (
                  <div key={i} className="bg-secondary/15 border p-3 rounded-lg space-y-2">
                    <div className="flex items-center gap-2">
                      <SelectField
                        value={r.category}
                        onChange={(e) => patchRecommendation(i, { category: e.target.value as any })}
                        className="input-base text-xs py-0.5"
                      >
                        <option value="emergency">Emergency Fund</option>
                        <option value="insurance">Insurance Adequacy</option>
                        <option value="goals">Goal SIP Plan</option>
                        <option value="investment">Mutual Funds / PMS Portfolio</option>
                        <option value="general">General Recommendation</option>
                      </SelectField>

                      <SelectField
                        value={r.priority}
                        onChange={(e) => patchRecommendation(i, { priority: e.target.value as any })}
                        className="input-base text-xs py-0.5 max-w-[100px]"
                      >
                        <option value="high">High Priority</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low Priority</option>
                      </SelectField>

                      <button
                        type="button"
                        onClick={() => removeRecommendation(i)}
                        className="p-1 text-rose-600 hover:bg-rose-50 rounded"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                    <textarea
                      placeholder="Describe the action item (e.g. Start HDFC Midcap SIP ₹5,000)"
                      value={r.action}
                      onChange={(e) => patchRecommendation(i, { action: e.target.value })}
                      rows={2}
                      className="input-base text-xs"
                    />
                    <input
                      type="text"
                      placeholder="Notes / product suggestion details (optional)"
                      value={r.notes || ""}
                      onChange={(e) => patchRecommendation(i, { notes: e.target.value })}
                      className="input-base text-xs py-1"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* MFD Value Add / Advisor Alpha Section */}
          <div className="card-surface p-6 space-y-3 bg-gradient-to-r from-brand-cyan-light/30 to-secondary/30 border border-brand-cyan/20">
            <div className="flex items-center gap-1.5 pb-1 border-b">
              <Shield className="size-4 text-brand-cyan-deep" />
              <h3 className="text-xs font-bold text-brand-cyan-deep">Advisor's Alpha Value Statement</h3>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Explain the value of investing with you as an MFD. This appears prominently in the client's PDF roadmap report to demonstrate your wealth compounding alpha.
            </p>
            <textarea
              value={mfdValueAddText}
              onChange={(e) => setMfdValueAddText(e.target.value)}
              rows={4}
              placeholder="Mutual Fund Distributors add significant alpha through..."
              className="input-base text-xs bg-card"
            />
          </div>

          {/* Notes and Comments */}
          <div className="card-surface p-6 space-y-3">
            <h3 className="text-xs font-bold">General Planner Notes & Client Summary Remarks</h3>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Provide a client summary note, assumptions, or comments that appear in the PDF report..."
              className="input-base text-sm"
            />
          </div>
        </div>
      )}

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between pt-4 border-t">
        <button
          type="button"
          disabled={step === 1}
          onClick={() => setStep(step - 1)}
          className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-50"
        >
          <ChevronLeft className="size-3.5" /> Previous
        </button>

        {step < 5 ? (
          <button
            type="button"
            disabled={step === 1 && (!recipient || !clientAge)}
            onClick={() => setStep(step + 1)}
            className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50"
            title={step === 1 && (!recipient || !clientAge) ? "Select a client and enter the client's age to continue" : undefined}
          >
            Next Step <ChevronRight className="size-3.5" />
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || !recipient}
            onClick={onSubmit}
            className="btn-primary text-xs flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-700/50"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            {busy ? "Saving Plan..." : "Save Financial Plan"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function NewPlanPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-sm text-muted-foreground">Loading form components...</div>}>
      <PlanFormContent />
    </Suspense>
  );
}
