/**
 * RLS isolation — BEHAVIORAL check (complements the static catalog guard in
 * scripts/check-rls.mjs): two tenants, one investor each; withTenant(A) must
 * see only A's rows, withTenant(B) only B's, and a cross-tenant SELECT by id
 * returns nothing.
 *
 * Needs a migrated Postgres: set TEST_DATABASE_URL (CI sets it after
 * migrate:all). Skipped otherwise so the suite stays green on a laptop.
 * NOTE: when the connection uses the privileged/superuser role, RLS policies
 * are FORCEd (FORCE ROW LEVEL SECURITY in the migrations), so isolation is
 * still exercised.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("RLS tenant isolation (behavioral)", () => {
  // Import lazily AFTER env wiring so db/client picks up the test connection.
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let schema: typeof import("@/db/schema");
  let eq: typeof import("drizzle-orm").eq;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const invA = randomUUID();
  const invB = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withTenant, withSystem } = await import("@/db/client"));
    schema = await import("@/db/schema");
    ({ eq } = await import("drizzle-orm"));

    await withSystem(async (tx) => {
      await tx.insert(schema.tenants).values([
        { id: tenantA, legalName: "RLS Test A", displayName: "RLS Test A", arn: `ARN-TA-${tenantA.slice(0, 6)}` } as any,
        { id: tenantB, legalName: "RLS Test B", displayName: "RLS Test B", arn: `ARN-TB-${tenantB.slice(0, 6)}` } as any,
      ]);
      await tx.insert(schema.investors).values([
        { id: invA, tenantId: tenantA, pan: "AAAPA1111A", name: "Investor A" } as any,
        { id: invB, tenantId: tenantB, pan: "BBBPB2222B", name: "Investor B" } as any,
      ]);
    });
  });

  afterAll(async () => {
    try {
      await withSystem(async (tx) => {
        await tx.delete(schema.investors).where(eq(schema.investors.id, invA));
        await tx.delete(schema.investors).where(eq(schema.investors.id, invB));
        await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
        await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
      });
    } catch {
      /* best-effort cleanup */
    }
  });

  it("tenant A sees only its own investors", async () => {
    const rows = await withTenant(tenantA, async (tx) => tx.select().from(schema.investors));
    expect(rows.some((r: any) => r.id === invA)).toBe(true);
    expect(rows.some((r: any) => r.id === invB)).toBe(false);
  });

  it("tenant B cannot read tenant A's investor even by id", async () => {
    const rows = await withTenant(tenantB, async (tx) =>
      tx.select().from(schema.investors).where(eq(schema.investors.id, invA))
    );
    expect(rows.length).toBe(0);
  });

  it("tenant B cannot UPDATE tenant A's investor", async () => {
    await withTenant(tenantB, async (tx) => {
      await tx.update(schema.investors).set({ name: "HACKED" } as any).where(eq(schema.investors.id, invA));
    });
    const after = await withTenant(tenantA, async (tx) =>
      tx.select().from(schema.investors).where(eq(schema.investors.id, invA))
    );
    expect((after[0] as any)?.name).toBe("Investor A");
  });
});
