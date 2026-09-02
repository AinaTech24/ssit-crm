/**
 * SSIT CRM Copilot — the learning loop.
 *
 * Records every prompt (which intent answered it, or a miss) and — crucially —
 * lets the engine LEARN from that history: when the fixed rules can't parse a
 * new phrasing, we look for a past HANDLED question that's close in wording and
 * reuse its intent. So the more your team asks, the more phrasings the copilot
 * recognises — adapting to how your people actually talk, with no external AI.
 *
 * (This is behavioural adaptation over a growing memory of prompts — not neural
 *  fine-tuning, which would need a GPU/ML pipeline.)
 */

import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { AssistantCtx } from "./tools";

const STOP = new Set(
  "the a an my our your me i to of for in on at is are be how many much what which who whom show list get give all with over above under and or do does can you clients client".split(
    " "
  )
);

/**
 * Redact identifiers before anything is stored — the learning log must never
 * become a shadow copy of PII. Masks PAN, Aadhaar-like 12-digit numbers, phone
 * numbers, emails, and long account-like numbers.
 */
export function redactPII(s: string): string {
  return s
    .replace(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/gi, "[pan]")
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "[email]")
    .replace(/\b(?:\+?91[\s-]?)?[6-9]\d{9}\b/g, "[phone]")
    .replace(/\b\d{12}\b/g, "[aadhaar]")
    .replace(/\b\d{9,18}\b/g, "[num]");
}

export function normalizeQ(q: string): string {
  return redactPII(q).toLowerCase().replace(/[^\w₹%.\[\]]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

function keywords(q: string): Set<string> {
  return new Set(normalizeQ(q).split(" ").filter((w) => w.length > 2 && !STOP.has(w)));
}

function txOpts(ctx: AssistantCtx) {
  return { userId: ctx.userId, branchId: ctx.branchId ?? undefined, roles: ctx.roles };
}

export type LogRow = { question: string; handled: boolean; intent: string | null; source: string };

/** Persist the turn's interactions (fire-and-forget friendly). */
export async function logInteractions(ctx: AssistantCtx, rows: LogRow[]): Promise<void> {
  const clean = rows.filter((r) => r.question && r.question.trim());
  if (!clean.length) return;
  try {
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        for (const r of clean) {
          await tx.execute(sql`
            INSERT INTO ai_copilot_interactions (tenant_id, user_id, question, question_norm, handled, intent, source)
            VALUES (${ctx.tenantId}::uuid, ${ctx.userId}::uuid, ${redactPII(r.question).slice(0, 500)}, ${normalizeQ(r.question)}, ${r.handled}, ${r.intent ?? null}, ${r.source})
          `);
        }
      },
      txOpts(ctx)
    );
  } catch {
    /* logging must never break the reply */
  }
}

/**
 * Learned routing: find the intent of the closest past HANDLED question (by
 * keyword overlap). Returns the intent name to try, or null if nothing is
 * similar enough. Threshold is deliberately high so we only reuse a clear match.
 */
export async function findLearnedIntent(ctx: AssistantCtx, question: string): Promise<string | null> {
  const kw = keywords(question);
  if (kw.size < 1) return null;
  try {
    const past = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const r = await tx.execute(sql`
          SELECT question_norm, intent FROM ai_copilot_interactions
          WHERE tenant_id = ${ctx.tenantId}::uuid AND handled = true
            AND intent IS NOT NULL AND intent <> 'refusal'
          ORDER BY created_at DESC LIMIT 300
        `);
        return r.rows as Array<{ question_norm: string; intent: string }>;
      },
      txOpts(ctx)
    );
    let best: string | null = null;
    let bestScore = 0;
    for (const p of past) {
      const pk = keywords(p.question_norm);
      if (!pk.size) continue;
      let inter = 0;
      for (const w of kw) if (pk.has(w)) inter++;
      const score = inter / Math.max(kw.size, pk.size); // Jaccard-style overlap
      if (score > bestScore) {
        bestScore = score;
        best = p.intent;
      }
    }
    return bestScore >= 0.6 ? best : null;
  } catch {
    return null;
  }
}
