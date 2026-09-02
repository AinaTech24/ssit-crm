/**
 * Share-token atomic claim — the single-use guarantee behind every public form
 * link (risk profile, doc upload, proposal approval). N concurrent claims on
 * the same token must yield EXACTLY ONE winner; after release it is claimable
 * again (retry path); after markUsed it is not.
 *
 * Needs a migrated Postgres via TEST_DATABASE_URL — skipped otherwise.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("share-token atomic claim", () => {
  let st: typeof import("@/lib/share-tokens");
  let withSystem: typeof import("@/db/client").withSystem;
  let schema: typeof import("@/db/schema");
  let eq: typeof import("drizzle-orm").eq;

  const tenantId = randomUUID();
  const investorId = randomUUID();
  let tokenId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    schema = await import("@/db/schema");
    ({ eq } = await import("drizzle-orm"));
    st = await import("@/lib/share-tokens");

    await withSystem(async (tx) => {
      await tx.insert(schema.tenants).values({
        id: tenantId, legalName: "Token Test", displayName: "Token Test", arn: `ARN-TK-${tenantId.slice(0, 6)}`,
      } as any);
      await tx.insert(schema.investors).values({
        id: investorId, tenantId, pan: "CCCPC3333C", name: "Token Investor",
      } as any);
    });

    const created = await st.createShareToken({
      tenantId,
      kind: "document_collection",
      subjectType: "investor",
      subjectId: investorId,
      expiresInDays: 1,
    } as any);
    tokenId = created.id;
    expect(tokenId).toBeTruthy();
  });

  afterAll(async () => {
    try {
      await withSystem(async (tx) => {
        await tx.delete(schema.shareTokens).where(eq(schema.shareTokens.tenantId, tenantId));
        await tx.delete(schema.investors).where(eq(schema.investors.id, investorId));
        await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
      });
    } catch {
      /* best-effort cleanup */
    }
  });

  it("exactly one of 8 concurrent claims wins", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => st.claimShareToken(tokenId)));
    expect(results.filter(Boolean).length).toBe(1);
  });

  it("after release the token is claimable exactly once again", async () => {
    await st.releaseShareToken(tokenId);
    const again = await Promise.all(Array.from({ length: 4 }, () => st.claimShareToken(tokenId)));
    expect(again.filter(Boolean).length).toBe(1);
  });
});
