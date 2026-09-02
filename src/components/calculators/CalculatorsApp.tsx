"use client";

/**
 * 8-calculator tabbed app — Network FP "3.5 MF Investment Calculators"
 * parity and advisor tools. Pure client-side; uses the existing goal-planning
 * math helpers.
 */

import { useRef, useState, createContext, useContext } from "react";
import { useToast } from "@/components/ui/Toast";
import {
  ChevronLeft, Search, X, Mail, MessageCircle, Printer, FilePlus2, FileText, Trash2,
  // group icons
  TrendingUp, Target, HandCoins, ShieldCheck, Receipt, Building2, Wrench, Flame,
  // per-calculator icons (each used exactly once — no duplicates)
  LineChart, ArrowUpNarrowWide, Sprout, Briefcase, ChevronsUp, CalendarClock, Crosshair, Droplets, Coins, Percent,
  Goal, Shuffle, TreePalm, GraduationCap, Baby, CalendarRange, BadgeCheck, Flag, Thermometer, Hourglass, Armchair,
  Route, Repeat, Timer, ScrollText, RefreshCw, House, Banknote, ArrowLeftRight, Infinity as InfinityIcon,
  Shield, Scale, Users,
  GitCompare, TrendingDown, Landmark, Scissors, Calculator,
  Warehouse, BarChart3, Recycle, PieChart,
  CalendarDays, SlidersHorizontal, Anchor, ClipboardList, ClipboardCheck,
  Siren, Rocket, Trophy, Coffee, PiggyBank, Home, Gauge, Layers, Wallet,
  Lightbulb, Sparkles, LifeBuoy, Wand2, Split, Umbrella, Building, Sailboat, Gem, Car, ShieldAlert, Boxes, CirclePause, Brain, History, CopyPlus, SquareStack, Compass, HeartHandshake, KeyRound, WalletCards,
  FolderPlus, FileSpreadsheet,
  type LucideIcon,
} from "lucide-react";
import { captureCalcResults } from "./capture";
import { ClientNameField } from "./ClientNameField";
import { ScenarioControls } from "./ScenarioControls";
import { CreateGoalFromCalc } from "./CreateGoalFromCalc";
import { SaveCalcToClient } from "./SaveCalcToClient";
import { Sip360Planner } from "./Sip360Planner";
import { StepUpReckoner } from "./StepUpReckoner";
import { IncomeBridgePlanner } from "./IncomeBridgePlanner";
import { SalaryWealthBuilder } from "./SalaryWealthBuilder";
import { CashflowCorpusPlanner } from "./CashflowCorpusPlanner";
import { PropertyYieldCalculator } from "./PropertyYieldCalculator";
import { InsuranceReturnAnalyzer } from "./InsuranceReturnAnalyzer";
import { SurrenderAnalyzer } from "./SurrenderAnalyzer";
import { SwpPeriodicPlanner } from "./SwpPeriodicPlanner";
import { SwpEndPeriodCalculator } from "./SwpEndPeriodCalculator";
import { SwpComprehensivePlanner } from "./SwpComprehensivePlanner";
import { StpComprehensivePlanner } from "./StpComprehensivePlanner";
import { EmiSipRecoveryPlanner } from "./EmiSipRecoveryPlanner";
import { FvAnnualLumpsumPlanner } from "./FvAnnualLumpsumPlanner";
import { DebtFundBenefitCalculator } from "./DebtFundBenefitCalculator";
import { AssetAllocationFvPlanner } from "./AssetAllocationFvPlanner";
import { AssetAllocationReview } from "./AssetAllocationReview";
import { ReviewOfInvestments } from "./ReviewOfInvestments";
import { HumanLifeValueCalculator } from "./HumanLifeValueCalculator";
import { GoalPlannerCalculator } from "./GoalPlannerCalculator";
import { CapitalGainsTaxCalculator } from "./CapitalGainsTaxCalculator";
import { OpmHousePlanner } from "./OpmHousePlanner";
import { AnnualLumpsumRequiredCalculator } from "./AnnualLumpsumRequiredCalculator";
import { TaxRegimeOptimizer } from "./TaxRegimeOptimizer";
import { RealReturnCalculator } from "./RealReturnCalculator";
import { NpsPlanner } from "./NpsPlanner";
import { TaxHarvestingCalculator } from "./TaxHarvestingCalculator";
import { CrashStressTest } from "./CrashStressTest";
import { FireNumberCalculator } from "./FireNumberCalculator";
import { ChildEducationProjector } from "./ChildEducationProjector";
import { EarlyStartChildSip } from "./EarlyStartChildSip";
import { ProsperityMultiplier } from "./ProsperityMultiplier";
import { GoalCollisionTimeline } from "./GoalCollisionTimeline";
import { XirrCalculator } from "./XirrCalculator";
import { RebalanceCalculator } from "./RebalanceCalculator";
import { GoalFeasibilityScore } from "./GoalFeasibilityScore";
import { ExpenseDragCalculator } from "./ExpenseDragCalculator";
import { FundReturnPicker } from "./FundReturnPicker";
import { CrorepatiCountdown } from "./CrorepatiCountdown";
import { HabitCorpusCalculator } from "./HabitCorpusCalculator";
import { FdVsEquityGap } from "./FdVsEquityGap";
import { RentVsBuyPlanner } from "./RentVsBuyPlanner";
import { LifestyleShockCalculator } from "./LifestyleShockCalculator";
import { MoneyLastCalculator } from "./MoneyLastCalculator";
import { CroreRaceCalculator } from "./CroreRaceCalculator";
import { PortfolioHealthScore } from "./PortfolioHealthScore";
import { FundOverlapCalculator } from "./FundOverlapCalculator";
import { AumOpportunityCalculator } from "./AumOpportunityCalculator";
import { PrepayVsInvestCalculator } from "./PrepayVsInvestCalculator";
import { BtidCalculator } from "./BtidCalculator";
import { NpsVsMfCalculator } from "./NpsVsMfCalculator";
import { HousingEmiSipCalculator } from "./HousingEmiSipCalculator";
import { PassiveIncomeBuilder } from "./PassiveIncomeBuilder";
import { WeddingPlanner } from "./WeddingPlanner";
import { DreamCarPlanner } from "./DreamCarPlanner";
import { YouthBucketStrategy } from "./YouthBucketStrategy";
import { JourneyToFreedom } from "./JourneyToFreedom";
import { FamilyWealthPlan } from "./FamilyWealthPlan";
import { EmergencyFundPlanner } from "./EmergencyFundPlanner";
import { RetirementBucketStrategy } from "./RetirementBucketStrategy";
import { SipPauseCostCalculator } from "./SipPauseCostCalculator";
import { MonthlyBudgetPlanner } from "./MonthlyBudgetPlanner";
import { RealStatement } from "./RealStatement";
import { MoneyPersonalityQuiz } from "./MoneyPersonalityQuiz";
import { InflationTimeMachine } from "./InflationTimeMachine";
import { WealthDoublingCalculator } from "./WealthDoublingCalculator";
import {
  fvSip,
  fvLumpsum,
  requiredSip,
  inflatedTarget,
  fvStepUpSip,
  growingSipSchedule,
  vacationPlan,
  costOfDelay,
  retirementCorpus,
  swpDeplete,
  stpCalculate,
  cagrCalculate,
} from "@/lib/goal-planning/calc";

type TabKey =
  | "sip360"
  | "reckoner"
  | "growing"
  | "bridge"
  | "salary"
  | "multipurpose"
  | "property"
  | "insurance"
  | "surrender"
  | "swpperiodic"
  | "swpend"
  | "swpcomp"
  | "stpcomp"
  | "emisip"
  | "fvannual"
  | "debtfund"
  | "assetalloc"
  | "allocreview"
  | "review"
  | "vacation"
  | "hlv"
  | "goalplan"
  | "captax"
  | "opm"
  | "annualreq"
  | "taxregime"
  | "realreturn"
  | "nps"
  | "harvest"
  | "crash"
  | "fire"
  | "childedu"
  | "childsip"
  | "collision"
  | "xirr"
  | "rebalance"
  | "feasibility"
  | "expensedrag"
  | "crorepati"
  | "habit"
  | "fdgap"
  | "lifestyle"
  | "moneylast"
  | "crorerace"
  | "rentbuy"
  | "portfoliohealth"
  | "fundoverlap"
  | "aumopportunity"
  | "prepayinvest"
  | "btid"
  | "npsvsmf"
  | "housingstrategy"
  | "passiveincome"
  | "wedding"
  | "dreamcar"
  | "youthbucket"
  | "journey"
  | "familywealth"
  | "emergency"
  | "buckets"
  | "sippause"
  | "budget"
  | "realstatement"
  | "quiz"
  | "timemachine"
  | "doubling"
  | "sip"
  | "goal"
  | "inflation"
  | "delay"
  | "retirement"
  | "swp"
  | "prosperity"
  | "stp"
  | "cagr";

type CalcMeta = { key: TabKey; name: string; icon: LucideIcon; desc: string };
type CalcGroup = { title: string; icon: LucideIcon; items: CalcMeta[] };

const CATALOG: CalcGroup[] = [
  {
    title: "SIP & Wealth Building", icon: TrendingUp, items: [
      { key: "sip360", name: "SIP 360° Planner", icon: LineChart, desc: "Deep SIP analysis — future value, step-up, delay & maturity" },
      { key: "reckoner", name: "Step-Up SIP Reckoner", icon: ArrowUpNarrowWide, desc: "Compare regular vs %/₹ step-up across timeframes" },
      { key: "growing", name: "Step-up SIP vs Regular SIP", icon: ChevronsUp, desc: "Year-by-year corpus, profit % and a growth chart — step-up vs flat SIP" },
      { key: "salary", name: "Salary → Wealth", icon: Briefcase, desc: "Invest a % of salary that rises with increments" },
      { key: "fvannual", name: "FV of Annual Lumpsum", icon: CalendarClock, desc: "Future value of a yearly lumpsum investment" },
      { key: "annualreq", name: "Annual Lumpsum for Target", icon: Crosshair, desc: "Yearly lumpsum needed to reach a goal" },
      { key: "sip", name: "SIP + Lumpsum Calculator", icon: Droplets, desc: "Future value of a monthly SIP plus a one-time lumpsum" },
      { key: "cagr", name: "CAGR", icon: Percent, desc: "Annualised growth rate between two values" },
    ],
  },
  {
    title: "Goals & Planning", icon: Target, items: [
      { key: "goalplan", name: "Goal Planner", icon: Goal, desc: "Lumpsum/SIP needed for one or many goals" },
      { key: "multipurpose", name: "Cashflow & Corpus", icon: Shuffle, desc: "Build a corpus and draw income from it" },
      { key: "vacation", name: "Vacation Planner", icon: TreePalm, desc: "Save up for a dream trip" },
      { key: "childedu", name: "Child Education", icon: GraduationCap, desc: "Fund education at ~10% education inflation" },
      { key: "childsip", name: "Early-Start Child SIP", icon: Baby, desc: "Invest in the early years, then let it compound for life" },
      { key: "collision", name: "Goal-Collision Timeline", icon: CalendarRange, desc: "Spot the years your goals overlap & peak" },
      { key: "feasibility", name: "Goal-Feasibility Score", icon: BadgeCheck, desc: "0–100 score — are the goals on track?" },
      { key: "goal", name: "Goal Calculator", icon: Flag, desc: "Monthly SIP to reach a target amount" },
      { key: "inflation", name: "Inflation", icon: Thermometer, desc: "What today's cost becomes in the future" },
      { key: "delay", name: "Cost of Delay", icon: Hourglass, desc: "What waiting to invest really costs" },
      { key: "retirement", name: "Retirement", icon: Armchair, desc: "The corpus you'll need to retire" },
    ],
  },
  {
    title: "Income & Withdrawal (SWP/STP)", icon: HandCoins, items: [
      { key: "bridge", name: "Income Bridge (SIP→SWP)", icon: Route, desc: "Build with SIP, then draw a monthly income" },
      { key: "swpperiodic", name: "SWP Periodic", icon: Repeat, desc: "Periodic withdrawals from a corpus" },
      { key: "swpend", name: "SWP End Period", icon: Timer, desc: "How long your money lasts under SWP" },
      { key: "swpcomp", name: "SWP Comprehensive", icon: ScrollText, desc: "Full SWP — any mode, frequency & increment" },
      { key: "stpcomp", name: "STP Comprehensive", icon: RefreshCw, desc: "Move debt → equity systematically" },
      { key: "opm", name: "OPM House (SWP)", icon: House, desc: "Fund a home using an SWP income stream" },
      { key: "swp", name: "SWP Calculator", icon: Banknote, desc: "Simple systematic withdrawal plan" },
      { key: "stp", name: "STP Calculator", icon: ArrowLeftRight, desc: "Systematic transfer plan" },
      { key: "prosperity", name: "Prosperity Multiplier", icon: InfinityIcon, desc: "SIP → growing income for life, corpus keeps compounding" },
    ],
  },
  {
    title: "Insurance & Protection", icon: ShieldCheck, items: [
      { key: "insurance", name: "Insurance IRR", icon: Shield, desc: "A policy's real return vs mutual funds" },
      { key: "surrender", name: "Surrender vs Invest", icon: Scale, desc: "Keep a policy, or surrender and invest?" },
      { key: "hlv", name: "Human Life Value", icon: Users, desc: "Term cover your family actually needs" },
    ],
  },
  {
    title: "Tax", icon: Receipt, items: [
      { key: "taxregime", name: "Old vs New Tax Regime", icon: GitCompare, desc: "Which regime saves more (FY 2025-26)" },
      { key: "realreturn", name: "Real Return", icon: TrendingDown, desc: "Your return after tax and inflation" },
      { key: "nps", name: "NPS Retirement & Tax", icon: Landmark, desc: "Corpus, pension and the 80CCD(1B) benefit" },
      { key: "harvest", name: "LTCG Tax-Harvesting", icon: Scissors, desc: "Bank the ₹1.25L tax-free gain every year" },
      { key: "captax", name: "Capital Gains Tax", icon: Calculator, desc: "LTCG/STCG with CII indexation" },
    ],
  },
  {
    title: "Property & Assets", icon: Building2, items: [
      { key: "property", name: "Property Yield", icon: Warehouse, desc: "The real return on a property investment" },
      { key: "debtfund", name: "Debt Fund Hold/Sell", icon: BarChart3, desc: "Hold or sell a debt fund, post-tax" },
      { key: "emisip", name: "EMI → SIP", icon: Recycle, desc: "Turn an EMI into wealth instead" },
      { key: "assetalloc", name: "Asset Allocation FV", icon: PieChart, desc: "Future value of a Debt/Equity mix" },
    ],
  },
  {
    title: "Investor Conversion", icon: Rocket, items: [
      { key: "crorepati", name: "Crorepati Countdown", icon: Trophy, desc: "The month a SIP crosses 1/2/5 crore" },
      { key: "habit", name: "Small Habit, Big Corpus", icon: Coffee, desc: "Turn daily spending into a long-term corpus" },
      { key: "fdgap", name: "FD vs Equity Gap", icon: PiggyBank, desc: "Compare FD comfort with equity wealth creation" },
      { key: "rentbuy", name: "Rent vs Buy", icon: Home, desc: "Buy a home or rent and invest the difference" },
      { key: "lifestyle", name: "Inflation Lifestyle Shock", icon: Siren, desc: "What today's lifestyle costs at retirement" },
      { key: "moneylast", name: "Will My Money Last?", icon: Hourglass, desc: "Does the retirement corpus outlive the client?" },
      { key: "crorerace", name: "₹1 Crore Race", icon: Flag, desc: "Years to the goal across different SIPs" },
    ],
  },
  {
    title: "Advisor Tools", icon: Wrench, items: [
      { key: "portfoliohealth", name: "Portfolio Health Score", icon: Gauge, desc: "100-point portfolio diagnostic for reviews" },
      { key: "fundoverlap", name: "Fund Overlap", icon: Layers, desc: "Show when many funds behave like fewer funds" },
      { key: "aumopportunity", name: "AUM Opportunity", icon: Wallet, desc: "Estimate extra AUM and SIP business potential" },
      { key: "xirr", name: "XIRR", icon: CalendarDays, desc: "True return on irregular, dated cashflows" },
      { key: "rebalance", name: "Portfolio Rebalancing", icon: SlidersHorizontal, desc: "Exact buy/sell to hit your target mix" },
      { key: "expensedrag", name: "Expense-Ratio Drag", icon: Anchor, desc: "What a costlier fund quietly costs you" },
      { key: "review", name: "Review of Investments", icon: ClipboardList, desc: "Compare your funds' performance side by side" },
      { key: "allocreview", name: "Asset Allocation Review", icon: ClipboardCheck, desc: "Existing vs suggested portfolio — 5y & 10y projection + asset mix" },
      { key: "realstatement", name: "REAL Statement (Net Worth & Cashflow)", icon: FileSpreadsheet, desc: "Full discovery snapshot — income, expenses, surplus, assets, liabilities & net worth" },
    ],
  },
  {
    title: "Markets & Mindset", icon: Flame, items: [
      { key: "crash", name: "Market-Crash Stress Test", icon: Siren, desc: "The cost of panic-selling vs staying invested" },
      { key: "fire", name: "FIRE Number", icon: Rocket, desc: "When can you achieve financial independence?" },
    ],
  },
  {
    title: "Smart Decisions", icon: Lightbulb, items: [
      { key: "prepayinvest", name: "Prepay vs Invest", icon: Split, desc: "Prepay the loan or invest the surplus?" },
      { key: "btid", name: "Term + MF vs ULIP", icon: Umbrella, desc: "Buy term & invest vs a bundled policy" },
      { key: "npsvsmf", name: "NPS vs Mutual Fund", icon: Building, desc: "Retirement: tax break vs flexibility" },
      { key: "housingstrategy", name: "Home-Buying Strategy", icon: KeyRound, desc: "Pay off / keep loan / rent — which builds more wealth" },
    ],
  },
  {
    title: "Dreams & Milestones", icon: Sparkles, items: [
      { key: "passiveincome", name: "Financial-Freedom Builder", icon: Sailboat, desc: "The SIP for a target passive income" },
      { key: "wedding", name: "Dream Wedding Planner", icon: Gem, desc: "Fund the big day, stress-free" },
      { key: "dreamcar", name: "Dream Car — Invest First", icon: Car, desc: "Invest & buy cash vs an auto-loan" },
      { key: "youthbucket", name: "4-Bucket Freedom", icon: SquareStack, desc: "Fund freedom across 4 buckets — far lower SIP" },
      { key: "journey", name: "Journey to Freedom", icon: Compass, desc: "The year your corpus funds life forever" },
      { key: "familywealth", name: "Family Wealth Plan", icon: HeartHandshake, desc: "Lumpsum + SIP across a 4-class portfolio" },
    ],
  },
  {
    title: "Essentials & Behaviour", icon: LifeBuoy, items: [
      { key: "emergency", name: "Emergency Fund Planner", icon: ShieldAlert, desc: "Build the financial seatbelt first" },
      { key: "buckets", name: "Retirement Bucket Strategy", icon: Boxes, desc: "Draw income for life across 3 buckets" },
      { key: "sippause", name: "Cost of Pausing a SIP", icon: CirclePause, desc: "What skipping SIPs costs at the goal" },
      { key: "budget", name: "Monthly Budget Planner", icon: WalletCards, desc: "50/30/20 health check + grow the surplus" },
    ],
  },
  {
    title: "Engagement & Fun", icon: Wand2, items: [
      { key: "quiz", name: "Money Personality Quiz", icon: Brain, desc: "Reveal an investor archetype + asset mix" },
      { key: "timemachine", name: "Inflation Time Machine", icon: History, desc: "What money is worth across the years" },
      { key: "doubling", name: "Wealth Doubling (Rule of 72)", icon: CopyPlus, desc: "How fast money doubles + milestones" },
    ],
  },
];

const ALL_CALCS: CalcMeta[] = CATALOG.flatMap((g) => g.items);
const CALC_META: Record<string, CalcMeta> = Object.fromEntries(ALL_CALCS.map((c) => [c.key, c]));

const MEETING_PACKS: Array<{ title: string; purpose: string; keys: TabKey[] }> = [
  { title: "First discovery", purpose: "Understand behaviour, cash flow and the first priority goal.", keys: ["quiz", "realstatement", "goalplan"] },
  { title: "Win the SIP", purpose: "Make the wealth gap visible and agree a practical monthly start.", keys: ["fdgap", "crorepati", "sippause"] },
  { title: "Portfolio review", purpose: "Diagnose overlap, allocation drift and hidden cost drag.", keys: ["portfoliohealth", "fundoverlap", "allocreview", "expensedrag"] },
  { title: "Retirement confidence", purpose: "Test the target, withdrawal durability and bucket plan.", keys: ["fire", "moneylast", "buckets", "passiveincome"] },
  { title: "Family protection", purpose: "Cover protection, education and multi-generation wealth needs.", keys: ["hlv", "childedu", "familywealth"] },
];

type CalcAssumptions = { returnPct: number; inflationPct: number; educationInflationPct: number; debtReturnPct: number };

// Firm "house view" defaults, provided around the calc render so the inline
// calculators seed their expected-return / inflation inputs from tenant settings
// instead of the hardcoded 12% / 6%.
const CalcAssumptionsCtx = createContext<CalcAssumptions>({ returnPct: 12, inflationPct: 6, educationInflationPct: 10, debtReturnPct: 7 });

export function CalculatorsApp({ firmName, assumptions }: { firmName?: string; assumptions?: CalcAssumptions } = {}) {
  const asmp: CalcAssumptions = assumptions ?? { returnPct: 12, inflationPct: 6, educationInflationPct: 10, debtReturnPct: 7 };
  const toast = useToast();
  const [tab, setTab] = useState<TabKey | null>(null);
  const [query, setQuery] = useState("");
  const [clientName, setClientName] = useState("");
  const [shareMode, setShareMode] = useState<null | "email" | "whatsapp">(null);
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const calcRef = useRef<HTMLDivElement>(null);
  // Create-goal + save-to-client modals.
  const [showGoal, setShowGoal] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [saveCapture, setSaveCapture] = useState<{ inputs: { label: string; value: string; group?: string }[]; blocks: any[] } | null>(null);

  // Snapshot the current calculator's results, then open the save-to-client modal.
  async function openSaveToClient() {
    const root = calcRef.current;
    if (!root) return;
    try {
      const { inputs, blocks } = await captureCalcResults(root);
      setSaveCapture({ inputs, blocks });
      setShowSave(true);
    } catch {
      toast.error("Couldn't read the results — please try again.");
    }
  }
  // ── Combined report tray — snapshots of calculators to bundle into one PDF ──
  type ReportItem = { calcName: string; inputs: { label: string; value: string; group?: string }[]; blocks: any[] };
  const [report, setReport] = useState<ReportItem[]>([]);
  const [showTray, setShowTray] = useState(false);

  async function doShare(channel: "email" | "whatsapp", calcName: string) {
    const root = calcRef.current;
    if (!root) return;
    setBusy(true);
    try {
      const { inputs, blocks } = await captureCalcResults(root);
      const res = await fetch("/api/calculators/share", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel, to: recipient, calcName, clientName, inputs, blocks }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(j.error || "Couldn't share."); return; }
      if (channel === "whatsapp" && j.waLink) {
        // Calc PDFs aren't hosted (no S3/DB) — download it locally so the
        // advisor can attach it in the WhatsApp chat that opens.
        if (j.pdfBase64) {
          try {
            const bytes = Uint8Array.from(atob(j.pdfBase64), (c) => c.charCodeAt(0));
            const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = j.filename || `${calcName}.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10_000);
          } catch { /* download is best-effort */ }
        }
        window.open(j.waLink, "_blank");
        toast.success("WhatsApp opened", "Your illustration PDF was downloaded — attach it in the chat.");
        setShareMode(null);
      } else if (channel === "email") {
        toast.success("Emailed to the client", `${calcName} illustration sent with the branded PDF attached.`);
        setShareMode(null);
      }
    } catch {
      toast.error("Couldn't share — please try again.");
    } finally { setBusy(false); }
  }

  // Download the same branded, multi-page PDF (with the firm logo) that the
  // email/WhatsApp share sends — built server-side so it's identical.
  async function downloadPdf(calcName: string) {
    const root = calcRef.current;
    if (!root) return;
    setBusy(true);
    try {
      const { inputs, blocks } = await captureCalcResults(root);
      const res = await fetch("/api/calculators/pdf", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ calcName, clientName, inputs, blocks }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error || "Couldn't generate the PDF.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${clientName || "Client"}-${calcName}`.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 60) + ".pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("PDF downloaded", `${calcName} illustration saved with your firm's branding.`);
    } catch {
      toast.error("Couldn't generate the PDF — please try again.");
    } finally { setBusy(false); }
  }

  // Snapshot the current calculator into the report tray.
  async function addToReport(calcName: string) {
    const root = calcRef.current;
    if (!root) return;
    try {
      const { inputs, blocks } = await captureCalcResults(root);
      setReport((r) => [...r, { calcName, inputs, blocks }]);
      setShowTray(true);
      toast.success("Added to report", `${calcName} — now ${report.length + 1} in the combined report.`);
    } catch {
      toast.error("Couldn't capture this calculator.");
    }
  }

  // Build ONE branded PDF from all tray items and download it.
  async function downloadCombined() {
    if (report.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/calculators/pdf-combined", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientName, items: report }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error || "Couldn't build the combined report.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${clientName || "Client"}-Combined-Report`.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 60) + ".pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Combined report downloaded", `${report.length} calculators in one branded PDF.`);
    } catch {
      toast.error("Couldn't build the combined report — please try again.");
    } finally { setBusy(false); }
  }

  if (tab === null) {
    return (
      <>
        <CalcGallery query={query} setQuery={setQuery} onPick={setTab} />
        <ReportTray report={report} show={showTray} setShow={setShowTray} setReport={setReport} onDownload={downloadCombined} busy={busy} clientName={clientName} />
      </>
    );
  }

  const meta = CALC_META[tab];
  const calcName = meta?.name ?? "Calculator";
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap print:hidden">
        <button onClick={() => { setTab(null); setQuery(""); setShareMode(null); }} className="btn-ghost text-xs">
          <ChevronLeft className="size-3.5" /> All calculators
        </button>
        {meta && (
          <span className="text-sm font-semibold flex items-center gap-1.5 truncate">
            <meta.icon className="size-4 text-primary shrink-0" /> {meta.name}
          </span>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Client name"
            className="h-8 rounded-md border border-border bg-card px-2.5 text-xs w-40 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
          <button onClick={() => { setShareMode(shareMode === "email" ? null : "email"); setRecipient(""); }} className="btn-primary text-xs" title="Email the branded PDF to the client">
            <Mail className="size-3.5" /> Email
          </button>
          <button onClick={() => { setShareMode(shareMode === "whatsapp" ? null : "whatsapp"); setRecipient(""); }} className="btn-ghost text-xs" title="Share on WhatsApp">
            <MessageCircle className="size-3.5" /> WhatsApp
          </button>
          <button onClick={() => downloadPdf(calcName)} disabled={busy} className="btn-ghost text-xs disabled:opacity-60" title="Download the branded PDF illustration">
            <Printer className="size-3.5" /> Print
          </button>
          <button onClick={() => addToReport(calcName)} disabled={busy} className="btn-ghost text-xs disabled:opacity-60" title="Add this calculator to the combined client report">
            <FilePlus2 className="size-3.5" /> Add to report{report.length > 0 ? ` (${report.length})` : ""}
          </button>
          <button onClick={() => setShowGoal(true)} className="btn-ghost text-xs" title="Create a client goal from this calculation">
            <Goal className="size-3.5" /> Create goal
          </button>
          <button onClick={openSaveToClient} className="btn-ghost text-xs" title="Save this illustration PDF to a client's documents">
            <FolderPlus className="size-3.5" /> Save to client
          </button>
          <ScenarioControls calculatorKey={tab} calculatorName={calcName} clientName={clientName} containerRef={calcRef} />
        </div>
      </div>

      <CreateGoalFromCalc
        open={showGoal}
        onClose={() => setShowGoal(false)}
        defaults={{ returnPct: asmp.returnPct, inflationPct: asmp.inflationPct }}
        clientName={clientName}
      />
      <SaveCalcToClient
        open={showSave}
        onClose={() => { setShowSave(false); setSaveCapture(null); }}
        calcName={calcName}
        inputs={saveCapture?.inputs ?? []}
        blocks={saveCapture?.blocks ?? []}
      />

      {/* Share recipient row */}
      {shareMode && (
        <div className="flex items-center gap-2 flex-wrap rounded-lg border border-border bg-secondary/30 p-2 print:hidden">
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder={shareMode === "email" ? "Client email address" : "Client WhatsApp number (optional)"}
            className="h-8 rounded-md border border-border bg-card px-2.5 text-xs w-56 focus:outline-none focus:border-primary"
          />
          <button onClick={() => doShare(shareMode, calcName)} disabled={busy} className="btn-primary text-xs disabled:opacity-60">
            {busy ? "Sending…" : shareMode === "email" ? "Send email" : "Open WhatsApp"}
          </button>
        </div>
      )}

      {/* Print-only — client line under the firm letterhead. */}
      {clientName && (
        <div className="hidden print:block" style={{ marginBottom: 6, fontSize: 13 }}>
          <strong>Prepared for:</strong> {clientName}
        </div>
      )}

      <CalcAssumptionsCtx.Provider value={asmp}>
      <div ref={calcRef} className="space-y-4">

        {tab === "sip360" && <Sip360Planner />}
        {tab === "reckoner" && <StepUpReckoner />}
        {tab === "growing" && <GrowingSipCalc />}
        {/* stepup merged into "growing" (Step-up SIP vs Regular SIP) */}
        {tab === "bridge" && <IncomeBridgePlanner />}
        {tab === "salary" && <SalaryWealthBuilder />}
        {tab === "multipurpose" && <CashflowCorpusPlanner />}
        {tab === "property" && <PropertyYieldCalculator />}
        {tab === "insurance" && <InsuranceReturnAnalyzer />}
        {tab === "surrender" && <SurrenderAnalyzer />}
        {tab === "swpperiodic" && <SwpPeriodicPlanner />}
        {tab === "swpend" && <SwpEndPeriodCalculator />}
        {tab === "swpcomp" && <SwpComprehensivePlanner />}
        {tab === "stpcomp" && <StpComprehensivePlanner />}
        {tab === "emisip" && <EmiSipRecoveryPlanner />}
        {tab === "fvannual" && <FvAnnualLumpsumPlanner />}
        {tab === "debtfund" && <DebtFundBenefitCalculator />}
        {tab === "assetalloc" && <AssetAllocationFvPlanner />}
        {tab === "allocreview" && <AssetAllocationReview />}
        {tab === "review" && <ReviewOfInvestments />}
        {tab === "vacation" && <VacationPlannerCalc />}
        {tab === "hlv" && <HumanLifeValueCalculator />}
        {tab === "goalplan" && <GoalPlannerCalculator />}
        {tab === "captax" && <CapitalGainsTaxCalculator />}
        {tab === "opm" && <OpmHousePlanner />}
        {tab === "annualreq" && <AnnualLumpsumRequiredCalculator />}
        {tab === "taxregime" && <TaxRegimeOptimizer />}
        {tab === "realreturn" && <RealReturnCalculator />}
        {tab === "nps" && <NpsPlanner />}
        {tab === "harvest" && <TaxHarvestingCalculator />}
        {tab === "crash" && <CrashStressTest />}
        {tab === "fire" && <FireNumberCalculator />}
        {tab === "childedu" && <ChildEducationProjector />}
        {tab === "childsip" && <EarlyStartChildSip />}
        {tab === "collision" && <GoalCollisionTimeline />}
        {tab === "xirr" && <XirrCalculator />}
        {tab === "rebalance" && <RebalanceCalculator />}
        {tab === "feasibility" && <GoalFeasibilityScore />}
        {tab === "expensedrag" && <ExpenseDragCalculator />}
        {tab === "crorepati" && <CrorepatiCountdown />}
        {tab === "habit" && <HabitCorpusCalculator />}
        {tab === "fdgap" && <FdVsEquityGap />}
        {tab === "rentbuy" && <RentVsBuyPlanner />}
        {tab === "lifestyle" && <LifestyleShockCalculator />}
        {tab === "moneylast" && <MoneyLastCalculator />}
        {tab === "crorerace" && <CroreRaceCalculator />}
        {tab === "portfoliohealth" && <PortfolioHealthScore />}
        {tab === "fundoverlap" && <FundOverlapCalculator />}
        {tab === "aumopportunity" && <AumOpportunityCalculator />}
        {tab === "prepayinvest" && <PrepayVsInvestCalculator />}
        {tab === "btid" && <BtidCalculator />}
        {tab === "npsvsmf" && <NpsVsMfCalculator />}
        {tab === "housingstrategy" && <HousingEmiSipCalculator />}
        {tab === "passiveincome" && <PassiveIncomeBuilder />}
        {tab === "wedding" && <WeddingPlanner />}
        {tab === "dreamcar" && <DreamCarPlanner />}
        {tab === "youthbucket" && <YouthBucketStrategy />}
        {tab === "journey" && <JourneyToFreedom />}
        {tab === "familywealth" && <FamilyWealthPlan />}
        {tab === "emergency" && <EmergencyFundPlanner />}
        {tab === "buckets" && <RetirementBucketStrategy />}
        {tab === "sippause" && <SipPauseCostCalculator />}
        {tab === "budget" && <MonthlyBudgetPlanner />}
        {tab === "realstatement" && <RealStatement />}
        {tab === "quiz" && <MoneyPersonalityQuiz />}
        {tab === "timemachine" && <InflationTimeMachine />}
        {tab === "doubling" && <WealthDoublingCalculator />}
        {tab === "sip" && <SipCalc />}
        {tab === "goal" && <GoalCalc />}
        {tab === "inflation" && <InflationCalc />}
        {tab === "delay" && <DelayCalc />}
        {tab === "retirement" && <RetirementCalc />}
        {tab === "swp" && <SwpCalc />}
        {tab === "stp" && <StpCalc />}
        {tab === "prosperity" && <ProsperityMultiplier />}
        {tab === "cagr" && <CagrCalc />}
      </div>
      </CalcAssumptionsCtx.Provider>

      <ReportTray report={report} show={showTray} setShow={setShowTray} setReport={setReport} onDownload={downloadCombined} busy={busy} clientName={clientName} />
    </div>
  );
}

/* ───────────────────── Combined-report tray ───────────────────── */
function ReportTray({
  report, show, setShow, setReport, onDownload, busy, clientName,
}: {
  report: { calcName: string }[];
  show: boolean;
  setShow: (v: boolean) => void;
  setReport: (v: any[] | ((r: any[]) => any[])) => void;
  onDownload: () => void;
  busy: boolean;
  clientName: string;
}) {
  if (report.length === 0) return null;
  return (
    <div className="print:hidden fixed bottom-5 right-5 z-40">
      {show ? (
        <div className="w-72 rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-primary text-white">
            <span className="text-xs font-bold flex items-center gap-1.5"><FileText className="size-3.5" /> Combined report ({report.length})</span>
            <button onClick={() => setShow(false)} className="hover:opacity-80" aria-label="Collapse"><X className="size-4" /></button>
          </div>
          <ul className="max-h-56 overflow-y-auto scrollbar-thin p-1.5">
            {report.map((it, i) => (
              <li key={i} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                <span className="size-5 grid place-items-center rounded bg-secondary text-[10px] font-bold shrink-0">{i + 1}</span>
                <span className="flex-1 truncate">{it.calcName}</span>
                <button onClick={() => setReport((r) => r.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-rose-600 shrink-0" aria-label="Remove">
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-border p-2 space-y-1.5">
            {!clientName && <p className="text-[10px] text-amber-600 px-1">Tip: set a client name (top bar) — it prints on the cover.</p>}
            <button onClick={onDownload} disabled={busy} className="btn-primary w-full text-xs justify-center disabled:opacity-60">
              {busy ? "Building…" : "Download combined PDF"}
            </button>
            <button onClick={() => setReport([])} className="btn-ghost w-full text-[11px] justify-center text-muted-foreground">Clear all</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShow(true)} className="btn-primary text-xs shadow-2xl rounded-full px-4 py-2.5">
          <FileText className="size-4" /> Report ({report.length})
        </button>
      )}
    </div>
  );
}

/* ───────────────────── calculator gallery (launcher) ───────────────────── */

function CalcGallery({
  query, setQuery, onPick,
}: { query: string; setQuery: (v: string) => void; onPick: (k: TabKey) => void }) {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? ALL_CALCS.filter((c) => c.name.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q))
    : null;

  return (
    <div className="space-y-5">

      <div className="relative max-w-md print:hidden">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search calculators by name…"
          autoFocus
          className="w-full rounded-lg border border-border bg-card pl-9 pr-9 py-2 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        )}
      </div>

      {filtered ? (
        filtered.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map((c) => <CalcCard key={c.key} c={c} onPick={onPick} />)}
          </div>
        ) : (
          <div className="text-center text-sm text-muted-foreground py-12">No calculators match “{query}”.</div>
        )
      ) : (
        <>
          <section className="space-y-2.5">
            <div><h2 className="text-sm font-semibold">Meeting packs</h2><p className="text-xs text-muted-foreground">Start with a client conversation instead of choosing from the full catalog.</p></div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {MEETING_PACKS.map((pack) => (
                <div key={pack.title} className="rounded-lg border bg-card p-4">
                  <h3 className="font-semibold text-sm">{pack.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{pack.purpose}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {pack.keys.map((key, index) => {
                      const calc = CALC_META[key];
                      return <button key={key} type="button" onClick={() => onPick(key)} className={index === 0 ? "btn-primary text-xs" : "btn-secondary text-xs"}>{index + 1}. {calc.name}</button>;
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
          {CATALOG.map((g) => (
          <div key={g.title} className="space-y-2.5 break-inside-avoid">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <g.icon className="size-3.5 text-primary" /> {g.title}
              <span className="text-muted-foreground/60 font-medium normal-case tracking-normal">· {g.items.length}</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {g.items.map((c) => <CalcCard key={c.key} c={c} onPick={onPick} />)}
            </div>
          </div>
          ))}
        </>
      )}
    </div>
  );
}

function CalcCard({ c, onPick }: { c: CalcMeta; onPick: (k: TabKey) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(c.key)}
      className="group text-left rounded-xl border border-border bg-card p-3.5 flex gap-3 items-start hover:border-primary/50 hover:shadow-md hover:-translate-y-0.5 transition-all"
    >
      <span className="shrink-0 grid place-items-center size-9 rounded-lg bg-primary/10 text-primary group-hover:bg-primary/15 transition-colors">
        <c.icon className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block font-semibold text-sm leading-tight group-hover:text-primary">{c.name}</span>
        <span className="block text-xs text-muted-foreground mt-1 leading-snug">{c.desc}</span>
      </span>
    </button>
  );
}

/* ───────────────────────── 1. SIP ───────────────────────── */
function SipCalc() {
  const [clientName, setClientName] = useState("");
  const [objective, setObjective] = useState("");
  const [presentValue, setPresentValue] = useState(0);
  const [sipAmount, setSipAmount] = useState(10000);
  const [years, setYears] = useState(10);
  const [returnPct, setReturnPct] = useState(useContext(CalcAssumptionsCtx).returnPct);

  const months = years * 12;
  const fvOfPv = fvLumpsum(presentValue, returnPct, months);
  const fvOfSip = fvSip(sipAmount, returnPct, months);
  const total = fvOfPv + fvOfSip;
  const invested = presentValue + sipAmount * months;

  return (
    <CalcShell
      title="SIP + Lumpsum Calculator"
      purpose="Future value of a monthly SIP and a one-time lumpsum, combined — with the breakup of each."
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Investment objective">
          <input
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            className="input-base text-sm w-full"
          />
        </Field>
        <NumberField label="Lumpsum amount (₹)" value={presentValue} setValue={setPresentValue} />
        <NumberField
          label="Monthly SIP (₹)"
          value={sipAmount}
          setValue={setSipAmount}
        />
        <NumberField label="Years" value={years} setValue={setYears} step={1} />
        <NumberField label="Expected return (% p.a.)" value={returnPct} setValue={setReturnPct} step={0.1} />
      </div>
      <div className="max-w-xs"><FundReturnPicker onPick={setReturnPct} /></div>
      <ResultRow
        cells={[
          { label: "Amount invested", value: inr(invested) },
          { label: "Future value", value: inr(total), tone: "emerald" },
          { label: "Wealth gain", value: inr(total - invested), tone: "emerald" },
        ]}
      />
      {presentValue > 0 && sipAmount > 0 && (
        <ResultRow
          cells={[
            { label: "Lumpsum grows to", value: inr(fvOfPv) },
            { label: "SIP grows to", value: inr(fvOfSip) },
          ]}
        />
      )}
    </CalcShell>
  );
}

/* ───────────────────────── 3. Goal ───────────────────────── */
function GoalCalc() {
  const [clientName, setClientName] = useState("");
  const [goalName, setGoalName] = useState("");
  const [goalAmount, setGoalAmount] = useState(10000000);
  const [years, setYears] = useState(15);
  const [returnPct, setReturnPct] = useState(useContext(CalcAssumptionsCtx).returnPct);

  const monthly = requiredSip(goalAmount, 0, returnPct, years * 12);

  return (
    <CalcShell title="Goal Calculator" purpose="Monthly SIP required to reach a target goal amount.">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Goal name">
          <input value={goalName} onChange={(e) => setGoalName(e.target.value)} className="input-base text-sm w-full" />
        </Field>
        <NumberField label="Goal amount (₹)" value={goalAmount} setValue={setGoalAmount} />
        <NumberField label="Years to goal" value={years} setValue={setYears} step={1} />
        <NumberField label="Expected return (% p.a.)" value={returnPct} setValue={setReturnPct} step={0.1} />
      </div>
      <div className="max-w-xs"><FundReturnPicker onPick={setReturnPct} /></div>
      <ResultRow
        cells={[
          { label: "Goal amount", value: inr(goalAmount) },
          { label: "Monthly SIP required", value: inr(monthly), tone: "emerald" },
          { label: "Total invested over goal", value: inr(monthly * years * 12) },
        ]}
      />
    </CalcShell>
  );
}

/* ───────────────────────── 4. Inflation ───────────────────────── */
function InflationCalc() {
  const [clientName, setClientName] = useState("");
  const [expenseType, setExpenseType] = useState("");
  const [amount, setAmount] = useState(100000);
  const [years, setYears] = useState(15);
  const [ratePct, setRatePct] = useState(useContext(CalcAssumptionsCtx).inflationPct);

  const fv = inflatedTarget(amount, ratePct, years);

  return (
    <CalcShell title="Inflation Calculator" purpose="Future value of an expense or goal, inflated.">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type of expense">
          <input value={expenseType} onChange={(e) => setExpenseType(e.target.value)} className="input-base text-sm w-full" placeholder="e.g. College fees, home cost" />
        </Field>
        <NumberField label="Current amount (₹)" value={amount} setValue={setAmount} />
        <NumberField label="Years" value={years} setValue={setYears} step={1} />
        <NumberField label="Inflation rate (% p.a.)" value={ratePct} setValue={setRatePct} step={0.1} />
      </div>
      <ResultRow
        cells={[
          { label: "Today's value", value: inr(amount) },
          { label: "Future value", value: inr(fv), tone: "amber" },
          { label: "Inflation impact", value: inr(fv - amount), tone: "rose" },
        ]}
      />
    </CalcShell>
  );
}

/* ───────────────────────── 5. Cost of Delay ───────────────────────── */
function DelayCalc() {
  const [startAgeNow, setStartAgeNow] = useState(25);
  const [startAgeLater, setStartAgeLater] = useState(35);
  const [endAge, setEndAge] = useState(60);
  const [lumpsum, setLumpsum] = useState(0);
  const [sip, setSip] = useState(10000);
  const [returnPct, setReturnPct] = useState(useContext(CalcAssumptionsCtx).returnPct);

  const res = costOfDelay({
    sipAmount: sip,
    lumpsum,
    startAgeNow,
    startAgeLater,
    endAge,
    returnPct,
  });

  return (
    <CalcShell title="Cost of Delay Calculator" purpose="Wealth difference between starting now vs later.">
      <div className="grid grid-cols-3 gap-3">
        <NumberField label="SIP starting age (now)" value={startAgeNow} setValue={setStartAgeNow} step={1} />
        <NumberField label="SIP starting age (later)" value={startAgeLater} setValue={setStartAgeLater} step={1} />
        <NumberField label="SIP ending age" value={endAge} setValue={setEndAge} step={1} />
        <NumberField label="Lumpsum (₹)" value={lumpsum} setValue={setLumpsum} />
        <NumberField label="Monthly SIP (₹)" value={sip} setValue={setSip} />
        <NumberField label="Expected return (% p.a.)" value={returnPct} setValue={setReturnPct} step={0.1} />
      </div>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <DelayColumn label="Invest now" body={res.now} />
        <DelayColumn label="Invest later" body={res.later} />
      </div>
      <ResultRow
        cells={[
          {
            label: "Cost of delay",
            value: inr(res.costOfDelay),
            tone: "rose",
          },
        ]}
      />
    </CalcShell>
  );
}

function DelayColumn({
  label,
  body,
}: {
  label: string;
  body: { years: number; invested: number; finalValue: number; gain: number };
}) {
  return (
    <div className="border border-slate-200 rounded-md p-3 space-y-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
        {label}
      </div>
      <Row k="Years invested" v={body.years.toString()} />
      <Row k="Invested" v={inr(body.invested)} />
      <Row k="Final value" v={inr(body.finalValue)} />
      <Row k="Gain" v={inr(body.gain)} />
    </div>
  );
}

/* ───────────────────────── 6. Retirement ───────────────────────── */
function RetirementCalc() {
  const [currentAge, setCurrentAge] = useState(35);
  const [retirementAge, setRetirementAge] = useState(60);
  const [lifeExpectancy, setLifeExpectancy] = useState(85);
  const [monthlyIncome, setMonthlyIncome] = useState(100000);
  const [inflationPct, setInflationPct] = useState(useContext(CalcAssumptionsCtx).inflationPct);
  const [preReturnPct, setPreReturnPct] = useState(12);
  const [postReturnPct, setPostReturnPct] = useState(7);
  const [existingFund, setExistingFund] = useState(0);

  const res = retirementCorpus({
    currentAge,
    retirementAge,
    lifeExpectancy,
    monthlyIncomeTodayInr: monthlyIncome,
    inflationPct,
    preReturnPct,
    postReturnPct,
    existingFundInr: existingFund,
  });

  return (
    <CalcShell title="Retirement Planning Calculator" purpose="Corpus required + monthly savings to fund retirement.">
      <div className="grid grid-cols-3 gap-3">
        <NumberField label="Current age" value={currentAge} setValue={setCurrentAge} step={1} />
        <NumberField label="Retirement age" value={retirementAge} setValue={setRetirementAge} step={1} />
        <NumberField label="Life expectancy" value={lifeExpectancy} setValue={setLifeExpectancy} step={1} />
        <NumberField label="Monthly income today (₹)" value={monthlyIncome} setValue={setMonthlyIncome} />
        <NumberField label="Inflation rate (% p.a.)" value={inflationPct} setValue={setInflationPct} step={0.1} />
        <NumberField label="Existing fund (₹)" value={existingFund} setValue={setExistingFund} />
        <NumberField label="Pre-retirement return (%)" value={preReturnPct} setValue={setPreReturnPct} step={0.1} />
        <NumberField label="Post-retirement return (%)" value={postReturnPct} setValue={setPostReturnPct} step={0.1} />
      </div>
      <ResultRow
        cells={[
          {
            label: "Monthly income at retirement",
            value: inr(res.monthlyIncomeAtRetirement),
            tone: "amber",
          },
          {
            label: "Corpus required",
            value: inr(res.corpusRequired),
            tone: "amber",
          },
          {
            label: "FV of existing fund",
            value: inr(res.fvOfExistingFund),
          },
          {
            label: "Monthly savings required",
            value: inr(res.monthlySavingsRequired),
            tone: "emerald",
          },
        ]}
      />
    </CalcShell>
  );
}

/* ───────────────────────── 8. SWP ───────────────────────── */
function SwpCalc() {
  const [corpus, setCorpus] = useState(500000);
  const [withdrawal, setWithdrawal] = useState(10000);
  const [returnPct, setReturnPct] = useState(8);
  const [years, setYears] = useState(5);

  const res = swpDeplete({
    corpusInr: corpus,
    monthlyWithdrawalInr: withdrawal,
    returnPct,
    years,
  });

  return (
    <CalcShell title="SWP Calculator" purpose="Monthly withdrawal from a corpus over a period.">
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Total investment (₹)" value={corpus} setValue={setCorpus} />
        <NumberField label="Monthly withdrawal (₹)" value={withdrawal} setValue={setWithdrawal} />
        <NumberField label="Expected return (% p.a.)" value={returnPct} setValue={setReturnPct} step={0.1} />
        <NumberField label="Years" value={years} setValue={setYears} step={1} />
      </div>
      <ResultRow
        cells={[
          { label: "Invested", value: inr(res.invested) },
          { label: "Total withdrawn", value: inr(res.totalWithdrawn), tone: "amber" },
          {
            label: "Final value",
            value: inr(res.finalValue),
            tone: res.finalValue > 0 ? "emerald" : "rose",
          },
        ]}
      />
      {res.monthsBeforeDepletion != null && (
        <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 mt-2">
          ⚠️ Corpus depletes after {Math.floor(res.monthsBeforeDepletion / 12)}{" "}
          years {res.monthsBeforeDepletion % 12} months.
        </div>
      )}
    </CalcShell>
  );
}

/* ───────────────────────── ★ Growing SIP vs SIP ───────────────────────── */
function GrowingSipCalc() {
  const [clientName, setClientName] = useState("");
  const [sip, setSip] = useState(100000);
  const [returnPct, setReturnPct] = useState(14);
  const [growthPct, setGrowthPct] = useState(10);
  const [years, setYears] = useState(20);

  const { regular, growing } = growingSipSchedule({
    monthlySip: sip,
    annualReturnPct: returnPct,
    annualGrowthPct: growthPct,
    years: Math.min(40, Math.max(1, years)),
  });

  const rLast = regular[regular.length - 1];
  const gLast = growing[growing.length - 1];
  const span = rLast?.year ?? years;
  const advantage = (gLast?.fv ?? 0) - (rLast?.fv ?? 0);

  return (
    <CalcShell
      title="Step-up SIP vs Regular SIP"
      purpose="A step-up SIP that raises your monthly amount each year vs a flat SIP — year-by-year corpus, invested, profit and profit-as-%-of-cost, with a growth chart. Returns are effective annual (compounded monthly, contributions at month start)."
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumberField label="Monthly SIP (₹)" value={sip} setValue={setSip} />
        <NumberField label="Expected return (% p.a.)" value={returnPct} setValue={setReturnPct} step={0.5} />
        <NumberField label="Annual step-up (%)" value={growthPct} setValue={setGrowthPct} step={1} />
        <NumberField label="Years" value={years} setValue={setYears} step={1} />
      </div>

      <ResultRow
        cells={[
          { label: `Regular SIP corpus (${span}y)`, value: inr(rLast?.fv ?? 0) },
          { label: `Growing SIP corpus (${span}y)`, value: inr(gLast?.fv ?? 0), tone: "emerald" },
          { label: "Extra from step-up", value: inr(advantage), tone: "emerald" },
        ]}
      />
      <ResultRow
        cells={[
          { label: "Invested — regular", value: inr(rLast?.invested ?? 0) },
          { label: "Invested — growing", value: inr(gLast?.invested ?? 0) },
          {
            label: "Growing — profit % of cost",
            value: `${((gLast?.profitPctOfCorpus ?? 0) * 100).toFixed(0)}%`,
            tone: "emerald",
          },
        ]}
      />

      <SipFvChart regular={regular} growing={growing} />

      <div className="overflow-x-auto scrollbar-thin border rounded-md">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground bg-secondary/40">
            <tr>
              <th className="px-2 py-1.5 text-left" rowSpan={2}>Year</th>
              <th className="px-2 py-1.5 text-center border-l" colSpan={3}>Regular SIP</th>
              <th className="px-2 py-1.5 text-center border-l" colSpan={3}>Growing SIP</th>
            </tr>
            <tr>
              <th className="px-2 py-1 text-right">Corpus</th>
              <th className="px-2 py-1 text-right">Invested</th>
              <th className="px-2 py-1 text-right">Profit %</th>
              <th className="px-2 py-1 text-right border-l">Corpus</th>
              <th className="px-2 py-1 text-right">Invested</th>
              <th className="px-2 py-1 text-right">Profit %</th>
            </tr>
          </thead>
          <tbody>
            {regular.map((rr, idx) => {
              const gg = growing[idx];
              return (
                <tr key={rr.year} className="border-t hover:bg-accent/30">
                  <td className="px-2 py-1.5 font-medium">{rr.year}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{inrCompact(rr.fv)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{inrCompact(rr.invested)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{(rr.profitPctOfCorpus * 100).toFixed(0)}%</td>
                  <td className="px-2 py-1.5 text-right tabular-nums border-l text-emerald-700 font-medium">{inrCompact(gg.fv)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{inrCompact(gg.invested)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{(gg.profitPctOfCorpus * 100).toFixed(0)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Profit % = (corpus − amount invested) ÷ amount invested. The growing SIP invests more over time, so its
        corpus is far larger; a flat SIP can show a higher profit-% only because its cost base is smaller.
      </p>
    </CalcShell>
  );
}

function SipFvChart({
  regular,
  growing,
}: {
  regular: { year: number; fv: number }[];
  growing: { year: number; fv: number }[];
}) {
  const W = 640;
  const H = 220;
  const padL = 6;
  const padR = 6;
  const padT = 16;
  const padB = 18;
  const n = regular.length;
  if (n < 2) return null;
  const maxFv = Math.max(...growing.map((d) => d.fv), ...regular.map((d) => d.fv), 1);
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / maxFv) * (H - padT - padB);
  const poly = (data: { fv: number }[]) => data.map((d, i) => `${x(i).toFixed(1)},${y(d.fv).toFixed(1)}`).join(" ");
  const grid = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="border rounded-md p-3">
      <div className="flex items-center gap-4 mb-2 text-[11px]">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-slate-400" /> Regular SIP
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-emerald-500" /> Growing SIP
        </span>
        <span className="ml-auto text-muted-foreground">Corpus across {n} years</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="SIP corpus growth: regular vs growing">
        {grid.map((g, i) => (
          <g key={i}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(maxFv * g)}
              y2={y(maxFv * g)}
              stroke="currentColor"
              className="text-border"
              strokeWidth={1}
            />
            <text x={padL} y={y(maxFv * g) - 2} className="fill-muted-foreground" fontSize={9}>
              {inrCompact(maxFv * g)}
            </text>
          </g>
        ))}
        <polyline fill="none" stroke="#94a3b8" strokeWidth={2} points={poly(regular)} />
        <polyline fill="none" stroke="#10b981" strokeWidth={2.5} points={poly(growing)} />
      </svg>
    </div>
  );
}

/* ───────────────────────── ★ Vacation Planner ─────────────────────────
 * Advanced Vacation Calculator (EFP workbook). Fund N escalating annual
 * vacations from a corpus earning the equity return; cover the gap left after
 * the initial investment (grown one year) with a growing SIP. */
function VacationPlannerCalc() {
  const [clientName, setClientName] = useState("");
  const [initial, setInitial] = useState(2000000);
  const [returnPct, setReturnPct] = useState(12);
  const [growthPct, setGrowthPct] = useState(15);
  const [sipYears, setSipYears] = useState(12);
  const [vacationCost, setVacationCost] = useState(400000);
  const [inflationPct, setInflationPct] = useState(4);
  const [numVacations, setNumVacations] = useState(50);

  const res = vacationPlan({
    initialInvestment: initial,
    equityReturnPct: returnPct,
    sipGrowthPct: growthPct,
    sipYears,
    currentVacationCost: vacationCost,
    vacationInflationPct: inflationPct,
    numVacations,
  });

  const fullyFunded = res.amountStillNeeded <= 0;
  const last = res.drawdown[res.drawdown.length - 1];

  return (
    <CalcShell
      title="Advanced Vacation Planner"
      purpose="Fund a lifetime of escalating annual vacations — the corpus you need, and the growing SIP to build the gap."
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumberField label="Initial investment (₹)" value={initial} setValue={setInitial} />
        <NumberField label="Current cost / vacation (₹)" value={vacationCost} setValue={setVacationCost} />
        <NumberField label="No. of vacations" value={numVacations} setValue={setNumVacations} step={1} />
        <NumberField label="Equity return (% p.a.)" value={returnPct} setValue={setReturnPct} step={0.5} />
        <NumberField label="Vacation inflation (% p.a.)" value={inflationPct} setValue={setInflationPct} step={0.5} />
        <NumberField label="SIP grows / yr (%)" value={growthPct} setValue={setGrowthPct} step={0.5} />
        <NumberField label="No. of years of SIP" value={sipYears} setValue={setSipYears} step={1} />
      </div>

      <ResultRow
        cells={[
          { label: "Corpus needed (1 yr out)", value: inr(res.corpusNeeded), tone: "emerald" },
          { label: "Initial grows to (1 yr)", value: inr(res.initialAfterOneYear) },
          {
            label: fullyFunded ? "Surplus — fully funded" : "Gap to fund via SIP",
            value: inr(fullyFunded ? res.initialAfterOneYear - res.corpusNeeded : res.amountStillNeeded),
            tone: fullyFunded ? "emerald" : "amber",
          },
        ]}
      />

      <ResultRow
        cells={[
          { label: "Growing SIP — monthly (mo 1)", value: fullyFunded ? "—" : inr(res.monthlySip), tone: "emerald" },
          { label: "Growing SIP — annual (yr 1)", value: fullyFunded ? "—" : inr(res.annualSip), tone: "emerald" },
          { label: "Total vacation spend (nominal)", value: inrCompact(res.totalNominalSpend) },
        ]}
      />

      <VacationDrawdownChart rows={res.drawdown} />

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="border rounded-md p-3 space-y-1">
          <div className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            First vacation
          </div>
          <Row k="Year 1 cost" v={inr(res.drawdown[0]?.cost ?? vacationCost)} />
          <Row k="Growth-adjusted rate" v={`${res.realRatePct.toFixed(2)}%`} />
        </div>
        <div className="border rounded-md p-3 space-y-1">
          <div className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            Final vacation (#{numVacations})
          </div>
          <Row k={`Year ${numVacations} cost`} v={inr(last?.cost ?? 0)} />
          <Row k="Corpus left at end" v={inr(Math.max(0, last?.balanceAfter ?? 0))} />
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        The corpus is the present value (one year out) of {numVacations} annual vacations — each escalating {inflationPct}% and
        withdrawn at the start of the year, with the remaining balance earning {returnPct}%. The growing SIP steps up {growthPct}%
        every year for {sipYears} years. The SIP figures grow the actual initial investment by one year (the workbook’s monthly
        path does the same), so the monthly value matches the source sheet to the rupee.
      </p>
    </CalcShell>
  );
}

function VacationDrawdownChart({
  rows,
}: {
  rows: { index: number; balanceAfter: number; cost: number }[];
}) {
  const W = 640;
  const H = 200;
  const padL = 6;
  const padR = 6;
  const padT = 16;
  const padB = 18;
  const n = rows.length;
  if (n < 2) return null;
  const maxBal = Math.max(...rows.map((d) => d.balanceAfter), 1);
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - Math.max(0, v) / maxBal) * (H - padT - padB);
  const poly = rows.map((d, i) => `${x(i).toFixed(1)},${y(d.balanceAfter).toFixed(1)}`).join(" ");
  const grid = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="border rounded-md p-3">
      <div className="flex items-center gap-4 mb-2 text-[11px]">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-cyan-600" /> Corpus balance
        </span>
        <span className="ml-auto text-muted-foreground">Drawn down across {n} vacations → ≈ ₹0</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Vacation corpus drawn down to zero">
        {grid.map((g, i) => (
          <g key={i}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(maxBal * g)}
              y2={y(maxBal * g)}
              stroke="currentColor"
              className="text-border"
              strokeWidth={1}
            />
            <text x={padL} y={y(maxBal * g) - 2} className="fill-muted-foreground" fontSize={9}>
              {inrCompact(maxBal * g)}
            </text>
          </g>
        ))}
        <polyline fill="none" stroke="#0891b2" strokeWidth={2.5} points={poly} />
      </svg>
    </div>
  );
}

/* ───────────────────────── Shared shell + bits ───────────────────────── */
function CalcShell({
  title,
  purpose,
  children,
}: {
  title: string;
  purpose: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card-surface p-5 space-y-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{purpose}</p>
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium block mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  value,
  setValue,
  step = 1000,
}: {
  label: string;
  value: number;
  setValue: (v: number) => void;
  step?: number;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value}
        step={step}
        min={0}
        onChange={(e) => {
          // Clamp to ≥0 and ignore non-numeric — illustrations never use
          // negative amounts / rates / durations.
          const n = e.target.value === "" ? 0 : Number(e.target.value);
          setValue(Number.isFinite(n) && n >= 0 ? n : 0);
        }}
        className="input-base text-sm w-full"
      />
    </Field>
  );
}

function ResultRow({
  cells,
}: {
  cells: Array<{
    label: string;
    value: string;
    tone?: "emerald" | "amber" | "rose";
  }>;
}) {
  return (
    <div
      className={`grid gap-3 mt-3`}
      style={{
        gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))`,
      }}
    >
      {cells.map((c, i) => {
        const cardTone =
          c.tone === "emerald"
            ? "border-emerald-200 bg-emerald-50/60"
            : c.tone === "amber"
              ? "border-amber-200 bg-amber-50/60"
              : c.tone === "rose"
                ? "border-rose-200 bg-rose-50/60"
                : "";
        return (
          <div
            key={i}
            className={`border rounded-md p-3 ${cardTone}`}
          >
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
              {c.label}
            </div>
            <div className="text-lg font-semibold mt-0.5">{c.value}</div>
          </div>
        );
      })}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}

function inr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Compact INR (₹X Cr / ₹X L / ₹Xk) — for dense tables + chart axis labels. */
function inrCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  if (a >= 1e3) return `₹${(n / 1e3).toFixed(0)}k`;
  return `₹${Math.round(n)}`;
}

/* ───────────────────────── 9. STP ───────────────────────── */
function StpCalc() {
  const [clientName, setClientName] = useState("");
  const [lumpsum, setLumpsum] = useState(1000000);
  const [transfer, setTransfer] = useState(50000);
  const [sourceReturn, setSourceReturn] = useState(6);
  const [targetReturn, setTargetReturn] = useState(12);
  const [years, setYears] = useState(5);

  const res = stpCalculate({
    lumpsum,
    transferAmount: transfer,
    sourceReturnPct: sourceReturn,
    targetReturnPct: targetReturn,
    years,
  });

  // Comparison logic: what if they kept the whole lumpsum in source debt fund?
  const sourceOnlyFV = fvLumpsum(lumpsum, sourceReturn, years * 12);
  // What if they put the whole lumpsum in target equity fund immediately?
  const targetOnlyFV = fvLumpsum(lumpsum, targetReturn, years * 12);

  return (
    <CalcShell
      title="Systematic Transfer Plan (STP) Calculator"
      purpose="Transfer funds systematically from a source debt fund to a target equity fund."
    >
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Initial lumpsum amount (₹)" value={lumpsum} setValue={setLumpsum} />
        <NumberField label="Monthly transfer amount (₹)" value={transfer} setValue={setTransfer} />
        <NumberField label="Source expected return (% p.a.)" value={sourceReturn} setValue={setSourceReturn} step={0.1} />
        <NumberField label="Target expected return (% p.a.)" value={targetReturn} setValue={setTargetReturn} step={0.1} />
        <NumberField label="Duration (years)" value={years} setValue={setYears} step={1} />
      </div>

      <div className="grid grid-cols-3 gap-3 mt-3">
        <div className="border border-slate-200 rounded-md p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            Debt fund remaining
          </div>
          <div className="text-base font-semibold">{inr(res.sourceFinalValue)}</div>
          <p className="text-[10px] text-muted-foreground">Un-transferred balance earning {sourceReturn}%</p>
        </div>
        <div className="border border-slate-200 rounded-md p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-primary font-semibold">
            Equity fund value
          </div>
          <div className="text-base font-semibold">{inr(res.targetFinalValue)}</div>
          <p className="text-[10px] text-muted-foreground">Transferred installments compounding at {targetReturn}%</p>
        </div>
        <div className="border border-slate-200 rounded-md p-3 space-y-1.5 bg-emerald-50/20 border-emerald-100">
          <div className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold">
            Total STP value
          </div>
          <div className="text-base font-semibold text-emerald-700">{inr(res.totalFinalValue)}</div>
          <p className="text-[10px] text-emerald-600">Combined maturity corpus</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-3">
        <div className="border border-slate-100 rounded-md p-3 space-y-1 text-xs">
          <div className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            STP vs Lumpsum Debt (Low risk)
          </div>
          <Row k="Total STP Value" v={inr(res.totalFinalValue)} />
          <Row k="Lumpsum in Debt Only" v={inr(sourceOnlyFV)} />
          <div className="border-t pt-1 font-semibold text-emerald-600 flex justify-between">
            <span>STP Outperformance</span>
            <span>{inr(res.totalFinalValue - sourceOnlyFV)}</span>
          </div>
        </div>
        <div className="border border-slate-100 rounded-md p-3 space-y-1 text-xs">
          <div className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            STP vs Lumpsum Equity (High risk)
          </div>
          <Row k="Lumpsum in Equity Only" v={inr(targetOnlyFV)} />
          <Row k="Total STP Value" v={inr(res.totalFinalValue)} />
          <div className="border-t pt-1 font-semibold text-muted-foreground flex justify-between">
            <span>STP Risk-Mitigated shortfall</span>
            <span>{inr(targetOnlyFV - res.totalFinalValue)}</span>
          </div>
        </div>
      </div>

      <ResultRow
        cells={[
          { label: "Amount invested", value: inr(lumpsum) },
          { label: "Total return corpus", value: inr(res.totalFinalValue), tone: "emerald" },
          { label: "Net wealth gain", value: inr(res.gain), tone: "emerald" },
        ]}
      />
    </CalcShell>
  );
}

/* ───────────────────────── 10. CAGR ───────────────────────── */
function CagrCalc() {
  const [initialValue, setInitialValue] = useState(100000);
  const [finalValue, setFinalValue] = useState(250000);
  const [years, setYears] = useState(5);

  const res = cagrCalculate({
    initialValue,
    finalValue,
    years,
  });

  return (
    <CalcShell
      title="CAGR Return Calculator"
      purpose="Compound Annual Growth Rate and absolute return of an investment over a period."
    >
      <div className="grid grid-cols-3 gap-3">
        <NumberField label="Initial value (₹)" value={initialValue} setValue={setInitialValue} />
        <NumberField label="Current/Final value (₹)" value={finalValue} setValue={setFinalValue} />
        <NumberField label="Duration (years)" value={years} setValue={setYears} step={0.5} />
      </div>

      <ResultRow
        cells={[
          { label: "Absolute return", value: `${res.absoluteReturnPct.toFixed(2)}%`, tone: res.absoluteReturnPct >= 0 ? "emerald" : "rose" },
          { label: "CAGR return", value: `${res.cagrPct.toFixed(2)}% p.a.`, tone: res.cagrPct >= 0 ? "emerald" : "rose" },
          { label: "Absolute wealth gain", value: inr(finalValue - initialValue), tone: finalValue >= initialValue ? "emerald" : "rose" },
        ]}
      />
    </CalcShell>
  );
}
