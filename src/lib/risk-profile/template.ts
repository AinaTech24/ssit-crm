/**
 * Tenant-editable risk-profile template loader + helpers.
 *
 * Sources the active template from `risk_profile_templates`. Falls back to the
 * seed default (RISK_PROFILE_QUESTIONS) when a tenant hasn't published one yet
 * — so the feature is back-compatible with existing tenants.
 *
 * The scoring helpers below take a template explicitly. Use them everywhere
 * instead of the old module-level `scoreAnswers()` so the resolved scoring
 * always matches what the tenant defined.
 */

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { riskProfileTemplates } from "@/db/schema";
import { RISK_PROFILE_QUESTIONS, type Question } from "./questions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const QuestionOptionSchema = z.object({
  value: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  score: z.number().int().min(-10).max(20),
});

export const QuestionSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "alphanumeric/underscore only, must start with letter").max(64),
  label: z.string().min(2).max(300),
  helperText: z.string().max(500).optional(),
  type: z.literal("single").default("single"),
  options: z.array(QuestionOptionSchema).min(2).max(10),
});

export const BandSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
  minScore: z.number().int(),
  maxScore: z.number().int(),
  color: z.string().max(20).optional(),
  description: z.string().max(500).optional(),
});

export const RiskTemplateSchema = z.object({
  name: z.string().min(2).max(120).default("Risk profile"),
  description: z.string().max(1000).optional(),
  questions: z.array(QuestionSchema).min(1).max(30),
  bands: z.array(BandSchema).min(2).max(8),
  reviewIntervalDays: z.number().int().min(30).max(3650).default(365),
  /** Require email-OTP verification on client self-submissions (/r/<token>). */
  requireEmailOtp: z.boolean().default(true),
});

export type RiskTemplate = z.infer<typeof RiskTemplateSchema>;
export type RiskTemplateQuestion = z.infer<typeof QuestionSchema>;
export type RiskTemplateBand = z.infer<typeof BandSchema>;

// ---------------------------------------------------------------------------
// Default template — used when a tenant hasn't customised yet.
// ---------------------------------------------------------------------------

export function defaultTemplate(): RiskTemplate {
  return {
    name: "Risk profile (SEBI default)",
    description:
      "8-question SEBI-style questionnaire. Score range 8–40, mapped to Conservative / Moderate / Aggressive.",
    questions: RISK_PROFILE_QUESTIONS.map((q) => ({
      key: q.key,
      label: q.label,
      helperText: q.helperText,
      type: "single" as const,
      options: q.options.map((o) => ({ value: o.value, label: o.label, score: o.score })),
    })),
    bands: [
      { id: "conservative", label: "Conservative", minScore: 8, maxScore: 18, color: "#10b981", description: "Capital preservation, low volatility." },
      { id: "moderate", label: "Moderate", minScore: 19, maxScore: 29, color: "#f59e0b", description: "Balanced growth + income." },
      { id: "aggressive", label: "Aggressive", minScore: 30, maxScore: 40, color: "#ef4444", description: "High growth, higher volatility tolerance." },
    ],
    reviewIntervalDays: 365,
    requireEmailOtp: true,
  };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load the tenant's active template. Falls back to the seed default if the
 * tenant has not customised yet.
 *
 * Must be called inside a `withTenant(...)` transaction.
 */
export async function loadActiveTemplate(tx: Tx, tenantId: string): Promise<RiskTemplate & { id?: string; versionNumber?: number }> {
  const rows = await tx
    .select()
    .from(riskProfileTemplates)
    .where(and(eq(riskProfileTemplates.tenantId, tenantId), eq(riskProfileTemplates.isActive, true)))
    .orderBy(desc(riskProfileTemplates.versionNumber))
    .limit(1);
  const row = rows[0];
  if (!row) return defaultTemplate();
  // The DB columns store the raw shape; we still validate them through Zod so
  // any drift / bad data shows up clearly here.
  const parsed = RiskTemplateSchema.safeParse({
    name: row.name,
    description: row.description ?? undefined,
    questions: row.questions,
    bands: row.bands,
    reviewIntervalDays: row.reviewIntervalDays,
    requireEmailOtp: row.requireEmailOtp ?? true,
  });
  if (!parsed.success) return defaultTemplate();
  return { ...parsed.data, id: row.id, versionNumber: row.versionNumber };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface ScoredResponse {
  total: number;
  band: RiskTemplateBand;
  breakdown: Array<{ key: string; question: string; answer: string; score: number }>;
}

/** Score a set of answers against a specific template. */
export function scoreAnswersAgainst(template: RiskTemplate, answers: Record<string, string>): ScoredResponse {
  let total = 0;
  const breakdown: ScoredResponse["breakdown"] = [];
  for (const q of template.questions) {
    const val = answers[q.key];
    if (!val) continue;
    const opt = q.options.find((o) => o.value === val);
    if (!opt) continue;
    total += opt.score;
    breakdown.push({ key: q.key, question: q.label, answer: opt.label, score: opt.score });
  }
  // First band whose [minScore..maxScore] contains the total wins.
  const band =
    template.bands.find((b) => total >= b.minScore && total <= b.maxScore) ??
    template.bands[template.bands.length - 1];
  return { total, band, breakdown };
}

/** Return the score range a template can produce — useful for UI hints. */
export function templateRange(template: RiskTemplate): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const q of template.questions) {
    const scores = q.options.map((o) => o.score);
    min += Math.min(...scores);
    max += Math.max(...scores);
  }
  return { min, max };
}

/**
 * Validate that the bands cover the full possible score range with no gaps
 * or overlaps. Returns a list of human-readable issues (empty = OK).
 */
export function validateBands(template: RiskTemplate): string[] {
  const issues: string[] = [];
  const range = templateRange(template);
  const sorted = [...template.bands].sort((a, b) => a.minScore - b.minScore);

  // Each band must have min <= max
  for (const b of sorted) {
    if (b.minScore > b.maxScore) issues.push(`Band "${b.label}": min (${b.minScore}) is greater than max (${b.maxScore}).`);
  }

  // Coverage + overlaps
  if (sorted.length) {
    if (sorted[0].minScore > range.min) {
      issues.push(`Bands don't cover the lowest possible score (${range.min}). First band starts at ${sorted[0].minScore}.`);
    }
    if (sorted[sorted.length - 1].maxScore < range.max) {
      issues.push(`Bands don't cover the highest possible score (${range.max}). Last band ends at ${sorted[sorted.length - 1].maxScore}.`);
    }
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (cur.minScore <= prev.maxScore) {
        issues.push(`Band "${prev.label}" (..${prev.maxScore}) overlaps with "${cur.label}" (${cur.minScore}..)`);
      }
      if (cur.minScore > prev.maxScore + 1) {
        issues.push(`Gap between "${prev.label}" (..${prev.maxScore}) and "${cur.label}" (${cur.minScore}..) — score ${prev.maxScore + 1} unmapped.`);
      }
    }
  }
  return issues;
}
