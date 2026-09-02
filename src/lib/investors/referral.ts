import { z } from "zod";

/**
 * A single referral on a client (investor) record — someone the client referred
 * (a prospective lead) or who is associated with them as a referral source.
 * Stored in the `investors.referrals` JSONB array. Mirrors the nominee pattern.
 */
export const ReferralSchema = z.object({
  name: z.string().max(120),
  /** Relationship to the client — e.g. "Friend", "Family", "Colleague". */
  relation: z.string().max(60).optional(),
  mobile: z.string().max(20).optional(),
  email: z.string().max(160).optional(),
  /** Free note — context, status, or what they're interested in. */
  note: z.string().max(500).optional(),
});

export type Referral = z.infer<typeof ReferralSchema>;

/** Optional array of referrals (max 50), used in the create + update API bodies. */
export const ReferralsArray = z.array(ReferralSchema).max(50).optional();
