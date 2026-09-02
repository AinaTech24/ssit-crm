/** Zod bodies for the expected-inflow API. Kept in lib (a route.ts may only
 *  export HTTP verbs — see the KAIZEN/landing-packages build failure). */

import { z } from "zod";
import { INFLOW_SOURCE_TYPES, INFLOW_STATUSES, INFLOW_CONFIDENCE } from "@/db/schema";

export const InflowBody = z.object({
  investorId: z.string().uuid(),
  ownerId: z.string().uuid().nullable().optional(),
  sourceType: z.enum(INFLOW_SOURCE_TYPES),
  expectedAmount: z.number().min(0).max(1e13).nullable().optional(),
  /** yyyy-mm-dd */
  expectedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expectedOn must be yyyy-mm-dd"),
  confidence: z.enum(INFLOW_CONFIDENCE).optional(),
  status: z.enum(INFLOW_STATUSES).optional(),
  investedAmount: z.number().min(0).max(1e13).nullable().optional(),
  investedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  remindDaysBefore: z.number().int().min(0).max(365).optional(),
  notes: z.string().max(4000).nullable().optional(),
});

export const InflowPatchBody = InflowBody.partial().omit({ investorId: true });
