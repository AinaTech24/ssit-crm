/**
 * MF Selection criteria — adopted from Network FP "3.3 MF Selection" template
 * (Equity / Debt / Hybrid selection checklists).
 *
 * Two things live here:
 *   1. CATEGORY_CRITERIA — the per-category checklist of selection
 *      parameters + the firm's selection criterion text, exactly as the
 *      Network FP worksheet lays out. Drives the read-only reference page
 *      and the IC scorecard prompts.
 *   2. CATEGORY_BENCHMARKS — the *quantitative* thresholds distilled from
 *      those criteria (CAGR, Sharpe, expense ratio, AUM, FM experience, …)
 *      so the IC scorecard can auto-grade a scheme's entered numbers and
 *      suggest a pass / watch / reject verdict instead of leaving the RM to
 *      eyeball it.
 *
 * Pure data + pure functions — no DB, no network. Reused by:
 *   - /dashboard/reports/mf-selection-criteria (reference)
 *   - scheme IC scorecard (grading)
 */

export type MfGroup = "equity" | "debt" | "hybrid";

export type SelectionParameter = {
  label: string;
  criterion: string;
};

/**
 * Quantitative benchmark for a category. All optional — a category only
 * specifies the metrics the worksheet calls out. `op` is the direction the
 * scheme's value must satisfy ("gte" = at least, "lte" = at most).
 */
export type Benchmark = {
  /** ≥ this 5-year (or category-appropriate) rolling CAGR %. */
  minCagrPct?: number;
  /** ≥ this % of rolling periods beating benchmark/category. */
  minConsistencyPct?: number;
  /** ≥ this Sharpe ratio. */
  minSharpe?: number;
  /** ≤ this regular-plan expense ratio %. */
  maxExpenseRatioPct?: number;
  /** ≥ this AUM in ₹ crore. */
  minAumCrore?: number;
  /** ≥ this fund-manager experience in years. */
  minFmExperienceYears?: number;
};

export type CategoryDef = {
  key: string;
  label: string;
  group: MfGroup;
  /** Coarse bucket used by the suitability matrix (equity/debt/hybrid/liquid…). */
  coarse: string;
  parameters: SelectionParameter[];
  benchmark: Benchmark;
};

/* ----------------------------- Equity ----------------------------- */

const LARGE_CAP: CategoryDef = {
  key: "large_cap",
  label: "Large Cap",
  group: "equity",
  coarse: "equity",
  benchmark: {
    minCagrPct: 12,
    minConsistencyPct: 75,
    minSharpe: 1,
    maxExpenseRatioPct: 2,
    minAumCrore: 5000,
    minFmExperienceYears: 5,
  },
  parameters: [
    { label: "Fund Category", criterion: "Should be a pure Large Cap Fund (per SEBI definition)" },
    { label: "Fund Objective", criterion: "Aligns with long-term capital appreciation" },
    { label: "Fund Manager Experience", criterion: ">5 years of experience with proven track record" },
    { label: "AMC Reputation", criterion: "AMC should be consistent, compliant, and investor-friendly" },
    { label: "5-Year Rolling Returns", criterion: ">12% CAGR on 5-year rolling returns" },
    { label: "Consistency of Returns", criterion: "Beat benchmark in at least 75% of rolling periods" },
    { label: "Risk Measures", criterion: "Sharpe Ratio >1, Standard Deviation < Category Average" },
    { label: "Expense Ratio (Regular)", criterion: "Should be <2% for cost-efficiency" },
    { label: "Portfolio Composition", criterion: "Bluechip stocks with sector & stock diversification" },
    { label: "AUM & Liquidity", criterion: "AUM > ₹5,000 Cr and good daily trading liquidity" },
  ],
};

const MID_SMALL_CAP: CategoryDef = {
  key: "mid_small_cap",
  label: "Mid Cap & Small Cap",
  group: "equity",
  coarse: "equity",
  benchmark: {
    minCagrPct: 13.5,
    minConsistencyPct: 70,
    minSharpe: 1,
    maxExpenseRatioPct: 2,
    minFmExperienceYears: 5,
  },
  parameters: [
    { label: "Fund Category", criterion: "SEBI-defined Mid Cap / Small Cap" },
    { label: "Fund Objective", criterion: "Focused on long-term wealth creation through high-growth companies" },
    { label: "Fund Manager Experience", criterion: ">5 years experience managing mid/small cap funds" },
    { label: "AMC Reputation", criterion: "AMC should be known for process-driven, long-term focus" },
    { label: "5-Year Rolling Returns", criterion: ">13-14% CAGR on 5-year rolling basis (higher risk = higher expected returns)" },
    { label: "Consistency of Returns", criterion: "Beat category average in at least 70% of rolling periods" },
    { label: "Risk Measures", criterion: "Sharpe > 1.0 and Standard Deviation acceptable for mid/small cap" },
    { label: "Expense Ratio (Regular)", criterion: "Ideally <2%" },
    { label: "Portfolio Composition", criterion: "Focus on scalable businesses, reasonable valuations, sector balance" },
    { label: "AUM & Liquidity", criterion: "AUM should be sizable, but not too large to affect nimbleness" },
  ],
};

const FLEXI_CAP: CategoryDef = {
  key: "flexi_cap",
  label: "Flexi Cap",
  group: "equity",
  coarse: "equity",
  benchmark: {
    minCagrPct: 12.5,
    minConsistencyPct: 75,
    minSharpe: 1,
    maxExpenseRatioPct: 2,
    minAumCrore: 5000,
    minFmExperienceYears: 5,
  },
  parameters: [
    { label: "Fund Category", criterion: "Flexi Cap as per SEBI (no restriction on market cap allocation)" },
    { label: "Fund Objective", criterion: "Dynamic allocation across market caps & sectors for long-term growth" },
    { label: "Fund Manager Experience", criterion: "Fund manager with >5 years of relevant experience" },
    { label: "AMC Reputation", criterion: "AMC must demonstrate consistency, transparency & governance" },
    { label: "5-Year Rolling Returns", criterion: ">12-13% CAGR over rolling 5-year periods" },
    { label: "Consistency of Returns", criterion: "Should beat category average >75% of the time" },
    { label: "Risk Measures", criterion: "Sharpe Ratio >1, drawdowns better than benchmark" },
    { label: "Expense Ratio (Regular)", criterion: "<2% preferred for long-term investing" },
    { label: "Portfolio Composition", criterion: "Mix of large, mid, small, and even international stocks as per mandate" },
    { label: "AUM & Liquidity", criterion: "AUM > ₹5,000 Cr and good liquidity" },
  ],
};

/* ------------------------------ Debt ------------------------------ */

const LONG_TERM_DEBT: CategoryDef = {
  key: "long_term_debt",
  label: "Long Term Debt",
  group: "debt",
  coarse: "debt",
  benchmark: {
    minCagrPct: 6.5,
    maxExpenseRatioPct: 1.2,
  },
  parameters: [
    { label: "Fund Category", criterion: "SEBI-defined Long Duration or Gilt Fund with Macaulay duration > 7 years" },
    { label: "Investment Objective", criterion: "Capital preservation with relatively stable income over the long term" },
    { label: "Fund Manager Experience", criterion: "Experience managing interest-rate sensitive portfolios" },
    { label: "Credit Quality", criterion: "Portfolio should have sovereign or high-rated instruments" },
    { label: "Modified Duration", criterion: "Modified duration >7 years, suitable for rate-sensitive exposure" },
    { label: "Interest Rate Sensitivity", criterion: "Performs better when interest rates fall" },
    { label: "Yield to Maturity (YTM)", criterion: "Should offer attractive YTM compared to inflation" },
    { label: "Expense Ratio (Regular)", criterion: "Ideally <1.2%" },
    { label: "Past 5-Year Performance", criterion: "Rolling return >6.5% (depending on interest rate cycles)" },
    { label: "AMC Expertise in Debt", criterion: "AMC with strong fixed income research and risk controls" },
  ],
};

const SHORT_TERM_DEBT: CategoryDef = {
  key: "short_term_debt",
  label: "Short Term Debt",
  group: "debt",
  coarse: "debt",
  benchmark: {
    minCagrPct: 6,
    maxExpenseRatioPct: 1.0,
    minFmExperienceYears: 10,
  },
  parameters: [
    { label: "Fund Category", criterion: "SEBI-defined Short Duration Fund (Macaulay duration 1–3 years)" },
    { label: "Investment Objective", criterion: "Low-risk income generation over 1–3 years; better than FD returns" },
    { label: "Fund Manager Experience", criterion: "Fund manager with 10+ years managing debt instruments" },
    { label: "AMC Track Record", criterion: "AMC should have a strong fixed income track record and research" },
    { label: "Credit Quality", criterion: "Portfolio should hold primarily AAA/A1+ or sovereign instruments" },
    { label: "Average Maturity", criterion: "Maintain Macaulay duration between 1 and 3 years" },
    { label: "Interest Rate Sensitivity", criterion: "Low to moderate; minimal impact from rate changes" },
    { label: "Yield to Maturity (YTM)", criterion: "Should offer ~6.5%–7% YTM to beat inflation" },
    { label: "Expense Ratio (Regular)", criterion: "Ideally <1.0%" },
    { label: "Past 3-Year Performance", criterion: "Rolling 3-year CAGR return >6%" },
  ],
};

const LIQUID: CategoryDef = {
  key: "liquid",
  label: "Liquid",
  group: "debt",
  coarse: "liquid",
  benchmark: {
    minCagrPct: 6.5,
    maxExpenseRatioPct: 0.5,
  },
  parameters: [
    { label: "Fund Category", criterion: "SEBI-defined Liquid Fund (instruments with maturity ≤91 days)" },
    { label: "Investment Objective", criterion: "Preserve capital with high liquidity and slightly better returns than savings A/C" },
    { label: "Fund Manager Experience", criterion: "Experience in managing low-risk, high-liquidity portfolios" },
    { label: "AMC Track Record", criterion: "Consistent performance and reputation in managing money market instruments" },
    { label: "Portfolio Quality", criterion: "100% AAA/A1+ rated instruments (Treasury Bills, CDs, CPs)" },
    { label: "Average Maturity", criterion: "Maintain maturity strictly within 91 days" },
    { label: "Liquidity & Access", criterion: "Instant redemption facility available" },
    { label: "Yield to Maturity (YTM)", criterion: "Competitive YTM compared to savings A/C and FDs" },
    { label: "Expense Ratio (Regular)", criterion: "Ideally <0.5% for maximum post-tax efficiency" },
    { label: "Past 1-Year Return", criterion: "6.5%+ CAGR expected (depending on market rates)" },
  ],
};

/* ----------------------------- Hybrid ----------------------------- */

const AGGRESSIVE_HYBRID: CategoryDef = {
  key: "aggressive_hybrid",
  label: "Aggressive Hybrid",
  group: "hybrid",
  coarse: "hybrid",
  benchmark: {
    minCagrPct: 10,
    maxExpenseRatioPct: 1.5,
    minFmExperienceYears: 10,
  },
  parameters: [
    { label: "Fund Category", criterion: "Aggressive Hybrid Fund (SEBI defined – 65–80% equity allocation)" },
    { label: "Investment Objective", criterion: "Balanced wealth creation with controlled volatility" },
    { label: "Fund Manager Experience", criterion: "Equity & debt manager with 10+ years of combined experience" },
    { label: "AMC Track Record", criterion: "Proven ability to manage hybrid assets and asset allocation" },
    { label: "Asset Allocation Strategy", criterion: "Dynamic or rule-based equity-debt mix; must align with market cycles" },
    { label: "Equity Allocation", criterion: "65–80% equity, diversified across sectors" },
    { label: "Debt Allocation & Quality", criterion: "High-quality AAA or sovereign papers" },
    { label: "Volatility & Drawdown Control", criterion: "Should limit downside in falling markets" },
    { label: "Expense Ratio (Regular)", criterion: "Ideally <1.5% for cost efficiency" },
    { label: "5-Year Rolling Returns", criterion: "10–12% CAGR expected over long-term periods" },
  ],
};

const BALANCED_ADVANTAGE: CategoryDef = {
  key: "balanced_advantage",
  label: "Balanced Advantage (Dynamic Asset Allocation)",
  group: "hybrid",
  coarse: "hybrid",
  benchmark: {
    minCagrPct: 9,
    maxExpenseRatioPct: 1.5,
  },
  parameters: [
    { label: "Fund Category", criterion: "SEBI-defined Dynamic Asset Allocation (Balanced Advantage) Fund" },
    { label: "Investment Objective", criterion: "Capital appreciation with dynamic equity-debt mix to manage market cycles" },
    { label: "Equity Allocation Range", criterion: "Fund must dynamically vary equity from 30–80% based on valuation models" },
    { label: "Asset Allocation Strategy", criterion: "Rule-based, valuation-driven, or tactical asset allocation" },
    { label: "Fund Manager Experience", criterion: "Should have deep experience handling multi-asset strategies" },
    { label: "AMC Track Record", criterion: "AMC should be trusted for hybrid strategy execution" },
    { label: "5-Year Rolling Returns", criterion: "9–11% CAGR with lower drawdowns than pure equity" },
    { label: "Volatility / Drawdown Control", criterion: "Should perform better during market corrections" },
    { label: "Expense Ratio (Regular)", criterion: "Ideally <1.5% for cost efficiency" },
    { label: "Tax Efficiency", criterion: "Should maintain equity taxation by keeping >65% equity via hedged positions" },
  ],
};

export const CATEGORY_CRITERIA: CategoryDef[] = [
  LARGE_CAP,
  MID_SMALL_CAP,
  FLEXI_CAP,
  AGGRESSIVE_HYBRID,
  BALANCED_ADVANTAGE,
  LONG_TERM_DEBT,
  SHORT_TERM_DEBT,
  LIQUID,
];

export const CATEGORY_CRITERIA_BY_KEY: Record<string, CategoryDef> =
  Object.fromEntries(CATEGORY_CRITERIA.map((c) => [c.key, c]));

export const MF_GROUP_LABELS: Record<MfGroup, string> = {
  equity: "Equity",
  debt: "Debt",
  hybrid: "Hybrid",
};

/* --------------------------- Scoring --------------------------- */

/** The subset of the IC scorecard we can auto-grade against a benchmark. */
export type SchemeScorecard = {
  fiveYearCagrPct?: number | null;
  consistencyPct?: number | null;
  sharpeRatio?: number | null;
  expenseRatioPct?: number | null;
  aumCrore?: number | null;
  fmExperienceYears?: number | null;
};

export type MetricResult = {
  key: string;
  label: string;
  value: number | null;
  target: string;
  status: "pass" | "fail" | "na";
};

export type SchemeScoreResult = {
  categoryKey: string | null;
  categoryLabel: string | null;
  metrics: MetricResult[];
  passCount: number;
  gradedCount: number;
  /** Suggested verdict — advisory only; the IC always has final say. */
  suggestedVerdict: "pass" | "watch" | "reject" | null;
};

/**
 * Map a free-text scheme category ("Equity - Large Cap", "Hybrid -
 * Aggressive", "Liquid") onto one of our benchmark categories. Best-effort
 * keyword match; returns null when we can't confidently classify.
 */
export function resolveCategoryKey(
  category?: string | null,
  coarseCategory?: string | null
): string | null {
  const s = `${category ?? ""} ${coarseCategory ?? ""}`.toLowerCase();
  if (!s.trim()) return null;
  if (/liquid|overnight|money\s*market/.test(s)) return "liquid";
  if (/balanced\s*advantage|dynamic\s*asset|baf/.test(s)) return "balanced_advantage";
  if (/aggressive\s*hybrid|hybrid|balanced/.test(s)) return "aggressive_hybrid";
  if (/flexi/.test(s)) return "flexi_cap";
  if (/mid|small/.test(s)) return "mid_small_cap";
  if (/large|bluechip|blue\s*chip/.test(s)) return "large_cap";
  if (/gilt|long\s*duration|long\s*term/.test(s) && /debt|bond|income/.test(s))
    return "long_term_debt";
  if (/short\s*duration|short\s*term/.test(s) && /debt|bond|income/.test(s))
    return "short_term_debt";
  if (/debt|bond|gilt|income|credit/.test(s)) return "long_term_debt";
  if (/equity/.test(s)) return "large_cap";
  return null;
}

/**
 * Grade a scheme's entered scorecard numbers against its category benchmark.
 * Returns per-metric pass/fail + a suggested verdict:
 *   - reject : any hard miss on a return/cost gate when most metrics fail
 *   - pass   : all graded metrics pass
 *   - watch  : partial — meets some, misses some
 */
export function scoreScheme(
  scorecard: SchemeScorecard,
  categoryKey: string | null
): SchemeScoreResult {
  const cat = categoryKey ? CATEGORY_CRITERIA_BY_KEY[categoryKey] : undefined;
  if (!cat) {
    return {
      categoryKey: null,
      categoryLabel: null,
      metrics: [],
      passCount: 0,
      gradedCount: 0,
      suggestedVerdict: null,
    };
  }

  const b = cat.benchmark;
  const metrics: MetricResult[] = [];

  const grade = (
    key: string,
    label: string,
    value: number | null | undefined,
    target: string,
    ok: (v: number) => boolean
  ) => {
    if (value === null || value === undefined || Number.isNaN(value)) {
      metrics.push({ key, label, value: null, target, status: "na" });
    } else {
      metrics.push({
        key,
        label,
        value,
        target,
        status: ok(value) ? "pass" : "fail",
      });
    }
  };

  if (b.minCagrPct != null) {
    grade("cagr", "5-yr rolling CAGR", scorecard.fiveYearCagrPct, `≥ ${b.minCagrPct}%`, (v) => v >= b.minCagrPct!);
  }
  if (b.minConsistencyPct != null) {
    grade("consistency", "Consistency", scorecard.consistencyPct, `≥ ${b.minConsistencyPct}%`, (v) => v >= b.minConsistencyPct!);
  }
  if (b.minSharpe != null) {
    grade("sharpe", "Sharpe ratio", scorecard.sharpeRatio, `≥ ${b.minSharpe}`, (v) => v >= b.minSharpe!);
  }
  if (b.maxExpenseRatioPct != null) {
    grade("expense", "Expense ratio (regular)", scorecard.expenseRatioPct, `≤ ${b.maxExpenseRatioPct}%`, (v) => v <= b.maxExpenseRatioPct!);
  }
  if (b.minAumCrore != null) {
    grade("aum", "AUM", scorecard.aumCrore, `≥ ₹${b.minAumCrore.toLocaleString("en-IN")} Cr`, (v) => v >= b.minAumCrore!);
  }
  if (b.minFmExperienceYears != null) {
    grade("fm", "Fund-manager experience", scorecard.fmExperienceYears, `≥ ${b.minFmExperienceYears} yrs`, (v) => v >= b.minFmExperienceYears!);
  }

  const graded = metrics.filter((m) => m.status !== "na");
  const passCount = graded.filter((m) => m.status === "pass").length;
  const gradedCount = graded.length;

  let suggestedVerdict: SchemeScoreResult["suggestedVerdict"] = null;
  if (gradedCount > 0) {
    const ratio = passCount / gradedCount;
    if (ratio === 1) suggestedVerdict = "pass";
    else if (ratio >= 0.6) suggestedVerdict = "watch";
    else suggestedVerdict = "reject";
  }

  return {
    categoryKey: cat.key,
    categoryLabel: cat.label,
    metrics,
    passCount,
    gradedCount,
    suggestedVerdict,
  };
}
