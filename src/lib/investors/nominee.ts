import { z } from "zod";

/**
 * A single nominee on a client (investor) record. Stored in the
 * `investors.nominees` JSONB array; the first entry is mirrored into the legacy
 * `nominee_*` columns for back-compat. The PAN document is uploaded to storage
 * and its key is carried here so the create/update API can register it as a
 * client document (so it shows in the client's Documents tab).
 */
export const NomineeSchema = z.object({
  name: z.string().max(120),
  relation: z.string().max(60).optional(),
  dob: z.string().max(20).optional(),
  mobile: z.string().max(20).optional(),
  pan: z.string().max(15).optional(),
  sharePct: z.number().min(0).max(100).optional(),
  /** Storage key of the uploaded PAN document (registered into client documents). */
  panDocKey: z.string().max(500).optional(),
  panDocName: z.string().max(300).optional(),
  panDocMime: z.string().max(120).optional(),
  panDocSize: z.number().int().nonnegative().optional(),
});

export type Nominee = z.infer<typeof NomineeSchema>;

/** Optional array of nominees (max 20), used in the create + update API bodies. */
export const NomineesArray = z.array(NomineeSchema).max(20).optional();
