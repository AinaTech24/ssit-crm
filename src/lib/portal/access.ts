import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { withSystem, type Tx } from "@/db/client";
import { investorPortalAccess } from "@/db/schema";

export const PORTAL_SCOPES = ["portfolio", "goals", "service_requests"] as const;
export type PortalScope = (typeof PORTAL_SCOPES)[number];

export function hashPortalToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issuePortalAccess(
  tx: Tx,
  input: { tenantId: string; investorId: string; userId: string; expiresInDays: number }
) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashPortalToken(token);
  const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000);

  await tx
    .update(investorPortalAccess)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(investorPortalAccess.tenantId, input.tenantId),
        eq(investorPortalAccess.investorId, input.investorId),
        isNull(investorPortalAccess.revokedAt)
      )
    );

  await tx.insert(investorPortalAccess).values({
    tenantId: input.tenantId,
    investorId: input.investorId,
    tokenHash,
    createdByUserId: input.userId,
    expiresAt,
    scopes: [...PORTAL_SCOPES],
  });

  return { token, expiresAt };
}

export async function resolvePortalAccess(token: string, touch = true) {
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return null;
  const tokenHash = hashPortalToken(token);

  return withSystem(async (tx) => {
    const [access] = await tx
      .select({
        id: investorPortalAccess.id,
        tenantId: investorPortalAccess.tenantId,
        investorId: investorPortalAccess.investorId,
        scopes: investorPortalAccess.scopes,
        expiresAt: investorPortalAccess.expiresAt,
      })
      .from(investorPortalAccess)
      .where(
        and(
          eq(investorPortalAccess.tokenHash, tokenHash),
          isNull(investorPortalAccess.revokedAt),
          gt(investorPortalAccess.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!access) return null;
    if (touch) {
      await tx.execute(sql`
        UPDATE investor_portal_access
        SET last_accessed_at = now(), updated_at = now()
        WHERE id = ${access.id}
      `);
    }
    return access;
  });
}

