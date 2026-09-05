/**
 * Equitywala tenant management — create new MFD tenant + owner user + subscription
 * in one transaction.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { subscriptions, subscriptionEvents } from "@/db/schema";
import { MASTER_SEEDS } from "@/lib/masters/seeds";

export const dynamic = "force-dynamic";

const Body = z.object({
  firmName: z.string().min(2),
  // ARN is optional — a firm can be onboarded before its ARN is issued.
  arn: z.string().trim().optional().default(""),
  ownerName: z.string().min(2),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(8),
  // Optional SECOND login for the same firm. This creates a second USER row in
  // the same tenant with identical access — two people, two passwords, one
  // firm. It is not a shared credential, so either can be disabled or have its
  // password changed without touching the other.
  additionalEmail: z.union([z.string().email(), z.literal("")]).default(""),
  additionalPassword: z.union([z.string().min(8), z.literal("")]).default(""),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.tenant.create");
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const body = parse.data;

    const ownerEmail = body.ownerEmail.trim().toLowerCase();
    const addEmail = body.additionalEmail.trim().toLowerCase();
    const addPassword = body.additionalPassword;

    // Both or neither — a password with no address (or vice versa) is a typo,
    // and silently ignoring it would leave the second person unable to log in
    // with no indication why.
    if (Boolean(addEmail) !== Boolean(addPassword)) {
      return NextResponse.json(
        { error: "Additional email and additional password must be filled in together." },
        { status: 400 }
      );
    }
    if (addEmail && addEmail === ownerEmail) {
      return NextResponse.json(
        { error: "The additional email must be different from the owner email." },
        { status: 400 }
      );
    }

    // Login resolves an address GLOBALLY — see the query in
    // src/app/api/auth/login/route.ts, which is "WHERE lower(email) = $1 ORDER BY
    // created_at DESC LIMIT 1" with no tenant scope. So reusing an address that
    // already exists anywhere means the NEWER row wins and the older account
    // becomes unreachable: onboarding a firm with a platform admin's address
    // would lock that admin out of /super-admin. Refuse instead.
    const taken = await withPlatformAdmin(session.userId, async (tx) => {
      const r = await tx.execute(
        addEmail
          ? sql`SELECT lower(email) AS email FROM users WHERE lower(email) IN (${ownerEmail}, ${addEmail})`
          : sql`SELECT lower(email) AS email FROM users WHERE lower(email) = ${ownerEmail}`
      );
      return (r.rows as Array<{ email: string }>).map((x) => x.email);
    });
    if (taken.length > 0) {
      return NextResponse.json(
        {
          error:
            `Already in use: ${taken.join(", ")}. Sign-in matches an email across the whole platform, so reusing one would shadow the existing account.`,
        },
        { status: 409 }
      );
    }

    const tenantId = uuid();
    const branchId = uuid();
    const userId = uuid();
    const additionalUserId = uuid();
    const subId = uuid();
    const passwordHash = await bcrypt.hash(body.ownerPassword, 12);
    const additionalHash = addEmail ? await bcrypt.hash(addPassword, 12) : null;
    // Display name only — the person renames themselves in Settings → Profile.
    const additionalName = addEmail ? addEmail.split("@")[0] : "";
    // Normalise ARN: empty string → null (optional column, unique index treats
    // NULLs as distinct so multiple ARN-less tenants coexist).
    const arn = body.arn && body.arn.trim() ? body.arn.trim() : null;

    await withPlatformAdmin(session.userId, async (tx) => {
      // If a SOFT-DELETED tenant still holds this ARN, free it first (deleting a
      // tenant is meant to release its ARN) so re-creation succeeds. Active
      // tenants holding the ARN are left alone → the INSERT below 409s clearly.
      // Skipped entirely when no ARN was provided.
      if (arn) {
        await tx.execute(sql`
          UPDATE tenants
          SET arn = arn || '_deleted_' || to_char(now(), 'YYYYMMDDHH24MISS'), updated_at = now()
          WHERE arn = ${arn} AND deleted_at IS NOT NULL
        `);
      }

      // Tenant — seed the contact email from the owner's email so the detail
      // page isn't left blank (admin can change it later).
      await tx.execute(sql`
        INSERT INTO tenants (id, legal_name, display_name, arn, email, status, created_at, updated_at)
        VALUES (${tenantId}, ${body.firmName}, ${body.firmName}, ${arn}, ${body.ownerEmail.toLowerCase()}, 'active', now(), now())
      `);

      // Branch
      await tx.execute(sql`
        INSERT INTO branches (id, tenant_id, name, code, is_hq, created_at, updated_at)
        VALUES (${branchId}, ${tenantId}, 'Head Office', 'HQ', 'true', now(), now())
      `);

      // Owner user
      await tx.execute(sql`
        INSERT INTO users (id, tenant_id, branch_id, email, name, password_hash, roles, status, activated_at, created_at, updated_at)
        VALUES (${userId}, ${tenantId}, ${branchId}, ${body.ownerEmail.toLowerCase()}, ${body.ownerName},
                ${passwordHash}, ARRAY['owner','rm','compliance']::text[], 'active', now(), now(), now())
      `);

      // Second login for the same firm, same roles as the owner.
      if (addEmail && additionalHash) {
        await tx.execute(sql`
          INSERT INTO users (id, tenant_id, branch_id, email, name, password_hash, roles, status, activated_at, created_at, updated_at)
          VALUES (${additionalUserId}, ${tenantId}, ${branchId}, ${addEmail}, ${additionalName},
                  ${additionalHash}, ARRAY['owner','rm','compliance']::text[], 'active', now(), now(), now())
        `);
      }

      // Per-tenant ACCESS OVERRIDE row. Every firm gets one at creation so a
      // platform admin can immediately customise its sidebar / fields — the
      // Module & Field Access Center writes into this row.
      await tx.insert(subscriptions).values({
        id: subId,
        tenantId,
        status: "active",
      } as any);

      // Seed masters for this tenant
      for (const [masterType, rows] of Object.entries(MASTER_SEEDS)) {
        for (const r of rows) {
          await tx.execute(sql`
            INSERT INTO master_values (id, tenant_id, master_type, key, label, sort_order,
              is_active, is_system_default, meta, created_at, updated_at)
            VALUES (gen_random_uuid(), ${tenantId}, ${masterType}, ${r.key}, ${r.label},
              ${r.sortOrder ?? 0}, true, true,
              ${r.meta ? JSON.stringify(r.meta) : null}::jsonb, now(), now())
            ON CONFLICT (tenant_id, master_type, key) DO NOTHING
          `);
        }
      }

      // Audit (append-only): who provisioned this tenant.
      await tx.insert(subscriptionEvents).values({
        subscriptionId: subId,
        tenantId,
        eventType: "created" as any,
        actor: `ssit_admin:${session.userId}`,
        toStatus: "active",
        notes: `Provisioned '${body.firmName}' (ARN ${arn ?? "—"}).`,
      } as any);
    });

    return NextResponse.json({ tenantId, userId, subscriptionId: subId }, { status: 201 });
  } catch (err: any) {
    // Drizzle wraps the driver error ("Failed query: …") and keeps the real
    // Postgres error on `.cause` — inspect both so we read the actual code /
    // constraint / detail.
    const pg = (err?.cause ?? err) as any;
    const code = String(pg?.code ?? err?.code ?? "");
    const constraint = String(pg?.constraint ?? err?.constraint ?? "");
    const detail = String(pg?.detail ?? "");
    const msg = String(pg?.message ?? err?.message ?? "");
    const dup = code === "23505" || msg.includes("duplicate key") || msg.includes("unique constraint") || detail.includes("already exists");
    if (dup && (constraint.includes("arn") || msg.includes("arn") || detail.includes("arn"))) {
      return NextResponse.json(
        { error: "ARN already registered — this ARN is already in use by another tenant (including cancelled or deleted ones). Use a different ARN, or delete the existing tenant first." },
        { status: 409 }
      );
    }
    if (dup && (constraint.includes("email") || msg.includes("email") || detail.includes("email"))) {
      return NextResponse.json({ error: "Owner email already in use by another user." }, { status: 409 });
    }
    if (dup) {
      return NextResponse.json({ error: `Duplicate value — violates ${constraint || "a unique constraint"}.` }, { status: 409 });
    }
    console.error("[create-tenant]", err);
    // Platform-admin-only tool → surface the real error (instead of an opaque
    // "internal") so Equitywala staff can act on it. A thrown 4xx status is preserved.
    const status = typeof err?.status === "number" ? err.status : 500;
    return NextResponse.json({ error: msg || "internal", code: code || undefined }, { status });
  }
}
