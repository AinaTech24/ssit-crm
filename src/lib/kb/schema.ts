/**
 * Zod body schema for the KB-article admin API.
 *
 * Lives in lib, NOT in the route file: a Next.js App Router route handler may
 * only export the HTTP verbs + a fixed set of config keys, so exporting a schema
 * from `route.ts` fails the generated-types check during `next build` (it does
 * not show up in a plain `tsc --noEmit`).
 */

import { z } from "zod";

export const KbBody = z.object({
  series: z.string().min(1).max(40).optional(),
  episodeNo: z.number().int().min(0).max(10000).nullable().optional(),
  slug: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase words separated by single hyphens"),
  title: z.string().min(3).max(200),
  hook: z.string().max(400).nullable().optional(),
  scenarioMd: z.string().max(20000).optional(),
  questions: z.array(z.string().min(1).max(300)).max(20).optional(),
  solutionMd: z.string().max(60000).optional(),
  screenshots: z
    .array(
      z.object({
        storageKey: z.string().min(1).max(500),
        caption: z.string().max(300).nullable().optional(),
        alt: z.string().max(300).nullable().optional(),
      })
    )
    .max(30)
    .optional(),
  modules: z.array(z.string().min(1).max(60)).max(15).optional(),
  readMinutes: z.number().int().min(1).max(120).nullable().optional(),
  coverKey: z.string().max(500).nullable().optional(),
  seoTitle: z.string().max(200).nullable().optional(),
  seoDescription: z.string().max(400).nullable().optional(),
  published: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

export const KbPatchBody = KbBody.partial();
