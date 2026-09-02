/**
 * Zod input schemas + total/asset-breakup computation shared by the Business
 * Closing Entry create + update routes.
 */

import { z } from "zod";
import {
  PRODUCT_TYPES,
  BUSINESS_ENTRY_STATUSES,
  TXN_TYPES,
  TXN_FREQUENCIES,
  ASSET_CLASSES,
} from "@/db/schema/business_entries";
import { classifyAssetClass, type AssetClass } from "./asset-class";

export const LineInput = z.object({
  schemeCode: z.string().max(40).nullish(),
  schemeName: z.string().min(1).max(250),
  amcName: z.string().max(150).nullish(),
  assetCategory: z.string().max(150).nullish(),
  assetClass: z.enum(ASSET_CLASSES).nullish(),
  txnType: z.enum(TXN_TYPES).default("lumpsum"),
  amount: z.number().min(0).max(1e13),
  units: z.number().min(0).nullish(),
  frequency: z.enum(TXN_FREQUENCIES).nullish(),
  /** Recurring SIP installment day / ECS date — day of month 1..28. */
  sipDate: z.string().regex(/^([1-9]|[12]\d|2[0-8])$/).nullish(),
  fromSchemeCode: z.string().max(40).nullish(),
  fromSchemeName: z.string().max(250).nullish(),
  fromAssetClass: z.enum(ASSET_CLASSES).nullish(),
  folioNo: z.string().max(60).nullish(),
  notes: z.string().max(500).nullish(),
});
export type LineInputT = z.infer<typeof LineInput>;

export const EntryInput = z.object({
  investorId: z.string().uuid().nullish(),
  clientName: z.string().min(1).max(200),
  productType: z.enum(PRODUCT_TYPES).default("mutual_fund"),
  platform: z.string().max(80).nullish(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(BUSINESS_ENTRY_STATUSES).default("draft"),
  rmId: z.string().uuid().nullish(),
  amcName: z.string().max(150).nullish(),
  folioNo: z.string().max(60).nullish(),
  notes: z.string().max(4000).nullish(),
  lines: z.array(LineInput).min(1).max(100),
});
export type EntryInputT = z.infer<typeof EntryInput>;

/** Resolve each line's normalised asset class (explicit override → classify). */
export function normalizeLine(l: LineInputT): LineInputT & { assetClass: AssetClass; fromAssetClass: AssetClass | null } {
  const assetClass = (l.assetClass as AssetClass | null | undefined) ?? classifyAssetClass(l.assetCategory, l.schemeName);
  const fromAssetClass =
    (l.fromAssetClass as AssetClass | null | undefined) ??
    (l.fromSchemeName ? classifyAssetClass(undefined, l.fromSchemeName) : null);
  return { ...l, assetClass, fromAssetClass };
}

const IN_TO_LIQUID = new Set(["lumpsum", "additional_purchase", "switch", "stp"]);
const OUT_OF_LIQUID = new Set(["swp", "redemption"]);

export function computeTotals(lines: Array<ReturnType<typeof normalizeLine>>): {
  total: number;
  assetBreakup: Record<string, number>;
  liquidIn: number;
  liquidOut: number;
  liquidNet: number;
} {
  let total = 0;
  let liquidIn = 0;
  let liquidOut = 0;
  const assetBreakup: Record<string, number> = {};
  for (const l of lines) {
    const amt = Number(l.amount) || 0;
    total += amt;
    assetBreakup[l.assetClass] = (assetBreakup[l.assetClass] ?? 0) + amt;
    if (l.assetClass === "liquid" && IN_TO_LIQUID.has(l.txnType)) liquidIn += amt;
    if (
      (l.assetClass === "liquid" && OUT_OF_LIQUID.has(l.txnType)) ||
      (l.fromAssetClass === "liquid" && (l.txnType === "switch" || l.txnType === "stp"))
    ) {
      liquidOut += amt;
    }
  }
  return { total, assetBreakup, liquidIn, liquidOut, liquidNet: liquidIn - liquidOut };
}
