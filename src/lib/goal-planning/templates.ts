/**
 * Goal templates (presets) for the create form. Each preset only sets
 * name / category / horizon / glide-path — return & inflation assumptions
 * are intentionally left out so the form keeps its tenant-default values.
 *
 * Categories must be one of the canonical goal categories:
 *   retirement | child_education | child_marriage | house | car | vacation |
 *   emergency_fund | wealth_creation | other
 */

import type { GlidePath } from "./glide-path";

export type GoalTemplate = {
  key: string;
  label: string;
  category: string;
  defaultName: string;
  horizonYears: number;
  glidePath: GlidePath;
  hint?: string;
};

export const GOAL_TEMPLATES: GoalTemplate[] = [
  {
    key: "retirement",
    label: "Retirement",
    category: "retirement",
    defaultName: "Retirement corpus",
    horizonYears: 25,
    glidePath: "conservative",
    hint: "Long horizon, de-risk near the end",
  },
  {
    key: "child_education",
    label: "Child Education",
    category: "child_education",
    defaultName: "Child's higher education",
    horizonYears: 15,
    glidePath: "moderate",
    hint: "Protect the corpus as admission nears",
  },
  {
    key: "child_marriage",
    label: "Child Marriage",
    category: "child_marriage",
    defaultName: "Child's marriage",
    horizonYears: 18,
    glidePath: "moderate",
    hint: "Medium-long horizon",
  },
  {
    key: "house",
    label: "Dream Home",
    category: "house",
    defaultName: "Dream home",
    horizonYears: 7,
    glidePath: "moderate",
    hint: "Down-payment in a few years",
  },
  {
    key: "car",
    label: "Car",
    category: "car",
    defaultName: "New car",
    horizonYears: 4,
    glidePath: "aggressive",
    hint: "Short horizon, de-risk early",
  },
  {
    key: "vacation",
    label: "Dream Vacation",
    category: "vacation",
    defaultName: "Dream vacation",
    horizonYears: 2,
    glidePath: "none",
    hint: "Near-term, keep it simple",
  },
  {
    key: "emergency_fund",
    label: "Emergency Fund",
    category: "emergency_fund",
    defaultName: "Emergency fund",
    horizonYears: 1,
    glidePath: "none",
    hint: "Liquidity buffer",
  },
];
