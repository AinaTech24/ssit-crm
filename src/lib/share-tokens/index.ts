/**
 * Share-token helpers.
 *
 * createShareToken — RM-side: generates plaintext + persists the hash.
 *   Returns { token, url } once. The plaintext is never stored.
 *
 * resolveShareToken — public-form-side: hashes the URL token and looks it up
 *   in the system (cross-tenant) context. Validates not expired, not used,
 *   not revoked.
 *
 * markShareTokenUsed — public-form-side: stamps used_at + stores the result
 *   payload (form submission JSON).
 */

import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { shareTokens } from "@/db/schema";

export type ShareTokenKind =
  | "risk_profile"
  | "document_collection"
  | "proposal_approval"
  | "onboarding_progress"
  | "portfolio_view"
  | "feedback"
  | "financial_discovery";
export type ShareTokenSubjectType = "lead" | "investor" | "proposal";

/** Token kinds that are re-usable (not consumed on first view). */
const MULTI_USE_KINDS: ShareTokenKind[] = ["onboarding_progress", "portfolio_view"];

export interface CreateShareTokenInput {
  tenantId: string;
  kind: ShareTokenKind;
  subjectType: ShareTokenSubjectType;
  subjectId: string;
  payload?: Record<string, unknown>;
  expiresInDays?: number;
  createdBy?: string;
}

export interface CreateShareTokenResult {
  id: string;
  token: string;
  url: string;
  expiresAt: Date;
}

/** Per-kind URL path prefix on the public form site. */
const KIND_TO_PATH: Record<ShareTokenKind, string> = {
  risk_profile: "/r",
  document_collection: "/d",
  proposal_approval: "/p",
  onboarding_progress: "/onboarding",
  portfolio_view: "/portfolio",
  feedback: "/f",
  financial_discovery: "/fd",
};

export async function createShareToken(input: CreateShareTokenInput): Promise<CreateShareTokenResult> {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + (input.expiresInDays ?? 7) * 24 * 60 * 60 * 1000);

  const row = await withTenant(input.tenantId, async (tx) => {
    const [inserted] = await tx
      .insert(shareTokens)
      .values({
        tenantId: input.tenantId,
        kind: input.kind,
        tokenHash,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        payload: input.payload ?? null,
        expiresAt,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    return inserted;
  });

  const base = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return {
    id: row.id,
    token,
    url: `${base}${KIND_TO_PATH[input.kind]}/${token}`,
    expiresAt,
  };
}

/**
 * Resolve a public-form token. Runs in withSystem (cross-tenant) because the
 * client clicking the link is unauthenticated. Returns the underlying row +
 * validates that it's usable; throws on any issue.
 */
export async function resolveShareToken(token: string): Promise<{
  id: string;
  tenantId: string;
  kind: ShareTokenKind;
  subjectType: ShareTokenSubjectType;
  subjectId: string;
  payload: Record<string, unknown> | null;
  expiresAt: Date;
}> {
  if (!token || token.length < 16) throw new Error("Invalid token");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const row = await withSystem(async (tx) => {
    const [r] = await tx.select().from(shareTokens).where(eq(shareTokens.tokenHash, tokenHash)).limit(1);
    return r;
  });
  if (!row) throw new Error("Token not found");
  if (row.revokedAt) throw new Error("This link was revoked");
  if (row.usedAt && !MULTI_USE_KINDS.includes(row.kind as ShareTokenKind))
    throw new Error("This link has already been used");
  if (new Date(row.expiresAt as any) < new Date()) throw new Error("This link has expired");
  return {
    id: row.id,
    tenantId: row.tenantId!,
    kind: row.kind as ShareTokenKind,
    subjectType: row.subjectType as ShareTokenSubjectType,
    subjectId: row.subjectId,
    payload: (row.payload as any) ?? null,
    expiresAt: row.expiresAt as any,
  };
}

/** Stamp the token used + store the form submission result. */
export async function markShareTokenUsed(opts: {
  id: string;
  result: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  await withSystem(async (tx) => {
    await tx
      .update(shareTokens)
      .set({
        usedAt: new Date(),
        result: opts.result as any,
        lastSeenIp: opts.ipAddress ?? null,
        lastSeenUserAgent: opts.userAgent ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(shareTokens.id, opts.id), isNull(shareTokens.usedAt)));
  });
}

/**
 * Atomically CLAIM a single-use token before doing any work.
 *
 * Runs one conditional UPDATE (`WHERE id = ? AND used_at IS NULL`) and reports
 * whether it actually claimed the row. This is the serialization point that
 * makes a single-use token genuinely single-use under concurrency: two racing
 * submits both pass the read-only validation, but only the first claim's UPDATE
 * affects a row — the loser gets `false` and aborts before inserting anything.
 *
 * Pair with `finalizeShareToken` (on success, to store the result payload) or
 * `releaseShareToken` (on failure, to let the user retry).
 */
export async function claimShareToken(id: string): Promise<boolean> {
  return withSystem(async (tx) => {
    const claimed = await tx
      .update(shareTokens)
      .set({ usedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(shareTokens.id, id), isNull(shareTokens.usedAt)))
      .returning({ id: shareTokens.id });
    return claimed.length === 1;
  });
}

/** Release a previously-claimed token (set used_at back to NULL) so the client
 *  can retry — call this if the work after `claimShareToken` fails. */
export async function releaseShareToken(id: string): Promise<void> {
  await withSystem(async (tx) => {
    await tx
      .update(shareTokens)
      .set({ usedAt: null, updatedAt: new Date() })
      .where(eq(shareTokens.id, id));
  });
}

/** Store the result payload on an already-claimed token (success path). Unlike
 *  `markShareTokenUsed`, this does NOT condition on used_at being NULL — the
 *  token was already claimed by `claimShareToken`. */
export async function finalizeShareToken(opts: {
  id: string;
  result: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  await withSystem(async (tx) => {
    await tx
      .update(shareTokens)
      .set({
        result: opts.result as any,
        lastSeenIp: opts.ipAddress ?? null,
        lastSeenUserAgent: opts.userAgent ?? null,
        updatedAt: new Date(),
      })
      .where(eq(shareTokens.id, opts.id));
  });
}

/** Look up active (unused, unexpired) tokens for a subject — for the lead
 *  detail page to show "1 share link pending". */
export async function listActiveTokens(tenantId: string, subjectType: ShareTokenSubjectType, subjectId: string) {
  return withTenant(tenantId, async (tx) => {
    return tx
      .select()
      .from(shareTokens)
      .where(
        and(
          eq(shareTokens.subjectType, subjectType),
          eq(shareTokens.subjectId, subjectId),
          isNull(shareTokens.usedAt),
          isNull(shareTokens.revokedAt)
        )
      );
  });
}
