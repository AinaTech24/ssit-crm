/**
 * POST /api/auth/signup
 * Body: { firmName, arn, ownerName, ownerEmail, password }
 *
 * Creates a tenant + the owner user in a single transaction.
 * The owner is auto-granted [owner, rm, compliance] roles for solo MFDs.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { sql, eq, asc } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { packages, subscriptions, subscriptionEvents } from "@/db/schema";
import { PLATFORM_TENANT_ID } from "@/lib/platform";
import { signSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";
import { MASTER_SEEDS } from "@/lib/masters/seeds";
import { installDefaultRecipes } from "@/lib/recipes/install-defaults";
import { issueEmailVerification } from "@/lib/auth/email-verification";
import { enforce } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Self-serve free-trial length, in days. */
const TRIAL_DAYS = 14;

export async function POST(req: NextRequest) {
  // 5 tenant creations per IP per hour. Stops drive-by spam of fake tenants
  // (which is also a customer-acquisition-cost waste if you have welcome
  // emails / WhatsApp sends configured).
  const limited = enforce(req, "auth.signup", { limit: 5, windowSec: 60 * 60 });
  if (limited) return limited;

  const body = await req.json().catch(() => ({}));
  const firmName = String(body.firmName ?? "").trim();
  const arn = String(body.arn ?? "").trim();
  const ownerName = String(body.ownerName ?? "").trim();
  const ownerEmail = String(body.ownerEmail ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!firmName || !arn || !ownerName || !ownerEmail || password.length < 8) {
    return NextResponse.json(
      { error: "firmName, arn, ownerName, ownerEmail, password (min 8 chars) all required" },
      { status: 400 }
    );
  }

  // An email reserved for an Equitywala Admin / Super Admin can't be reused for an MFD
  // signup either — otherwise two rows would share the email across tenants and
  // login would become ambiguous.
  const adminEmailTaken = await withSystem(async (tx) => {
    const r = await tx.execute(
      sql`SELECT 1 FROM users WHERE lower(email) = ${ownerEmail} AND tenant_id = ${PLATFORM_TENANT_ID}::uuid LIMIT 1`
    );
    return r.rows.length > 0;
  });
  if (adminEmailTaken) {
    return NextResponse.json({ error: "Email already in use" }, { status: 409 });
  }

  const tenantId = uuid();
  const userId = uuid();
  const branchId = uuid();
  const subId = uuid();
  const passwordHash = await bcrypt.hash(password, 12);
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  try {
    await withSystem(async (tx) => {
      // Free this ARN if a soft-deleted tenant still holds it (deleting should
      // have released it) so signup with a reused ARN works.
      await tx.execute(sql`
        UPDATE tenants
        SET arn = arn || '_deleted_' || to_char(now(), 'YYYYMMDDHH24MISS'), updated_at = now()
        WHERE arn = ${arn} AND deleted_at IS NOT NULL
      `);

      await tx.execute(sql`
        INSERT INTO tenants (id, legal_name, display_name, arn, plan, status, trial_ends_at, created_at, updated_at)
        VALUES (${tenantId}, ${firmName}, ${firmName}, ${arn}, 'starter', 'trial', ${trialEndsAt}, now(), now())
      `);

      await tx.execute(sql`
        INSERT INTO branches (id, tenant_id, name, code, is_hq, created_at, updated_at)
        VALUES (${branchId}, ${tenantId}, 'Head Office', 'HQ', 'true', now(), now())
      `);

      await tx.execute(sql`
        INSERT INTO users (id, tenant_id, branch_id, email, name, password_hash, roles, status, activated_at, created_at, updated_at)
        VALUES (
          ${userId}, ${tenantId}, ${branchId}, ${ownerEmail}, ${ownerName}, ${passwordHash},
          ARRAY['owner', 'rm', 'compliance']::text[], 'active', now(), now(), now()
        )
      `);

      // Create the trial subscription. WITHOUT this row the license gate
      // (loadTenantLicense → "no_subscription", isRestricted) locks the brand-new
      // tenant straight out of their own dashboard — self-serve signup dead-ends.
      // Mirrors the Equitywala-admin provisioning path (super-admin/tenants/route.ts).
      // Default to the public "starter" plan; fall back to the lowest-sorted
      // active package so signup still works if "starter" was renamed.
      const pkg =
        (await tx.select().from(packages).where(eq(packages.key, "starter")).limit(1))[0] ??
        (await tx
          .select()
          .from(packages)
          .where(eq(packages.isActive, true))
          .orderBy(asc(packages.sortOrder))
          .limit(1))[0];
      if (!pkg) {
        // No package catalog → cannot grant a license. Fail loudly and roll the
        // whole signup back rather than create a locked-out orphan tenant.
        throw new Error("no_package_configured");
      }
      // Create the subscription in `pending` state — the owner must CHOOSE a
      // package (and pay, if Razorpay is configured) before they get dashboard
      // access. The license gate routes `pending` tenants to /onboarding/choose-plan.
      // `pkg` (starter) is a placeholder packageId so the FK is satisfied; the
      // real package + active status are set when they complete onboarding.
      await tx.insert(subscriptions).values({
        id: subId,
        tenantId,
        packageId: pkg.id,
        packageKey: pkg.key,
        status: "pending",
        billingCycle: "monthly",
        licenseStartAt: new Date(),
        trialEndsAt,
      } as any);
      await tx.insert(subscriptionEvents).values({
        subscriptionId: subId,
        tenantId,
        eventType: "created",
        actor: "system:self_serve_signup",
        toStatus: "pending",
        toPackage: pkg.key,
        notes: `Self-serve signup — awaiting package selection${""}.`,
      } as any);

      // Seed the 15 master_values defaults for this tenant.
      for (const [masterType, rows] of Object.entries(MASTER_SEEDS)) {
        for (const r of rows) {
          await tx.execute(sql`
            INSERT INTO master_values (
              id, tenant_id, master_type, key, label, sort_order,
              is_active, is_system_default, meta, created_at, updated_at
            )
            VALUES (
              gen_random_uuid(), ${tenantId}, ${masterType}, ${r.key}, ${r.label},
              ${r.sortOrder ?? 0}, true, true,
              ${r.meta ? JSON.stringify(r.meta) : null}::jsonb,
              now(), now()
            )
            ON CONFLICT (tenant_id, master_type, key) DO NOTHING
          `);
        }
      }

      // Pre-install the 9 default workflow recipes (disabled — owner
      // reviews + enables each). Curated subset of ALL_RECIPES; the
      // remaining 15+ live in the library at /dashboard/workflows.
      try {
        const r = await installDefaultRecipes(tx, tenantId, userId);
        console.log(
          `[signup] installed ${r.installed.length} default recipes for tenant ${tenantId}`
        );
      } catch (err) {
        // Default-recipe install is additive — if it fails we still want
        // the tenant create to succeed. The owner can install from the
        // library later.
        console.error("[signup] default-recipe install failed:", err);
      }
    });
  } catch (err: any) {
    // Drizzle wraps the driver error and keeps the real Postgres error on
    // `.cause` — inspect both for the actual code / constraint / detail.
    const pg = (err?.cause ?? err) as any;
    const msg = String(pg?.message ?? err?.message ?? "");
    const code = String(pg?.code ?? err?.code ?? "");
    const constraint = String(pg?.constraint ?? err?.constraint ?? "");
    const detail = String(pg?.detail ?? "");
    // Detect duplicates by the Postgres unique-violation code (23505), not a
    // fragile constraint-name string match.
    const dup = code === "23505" || msg.includes("duplicate key") || msg.includes("unique constraint") || detail.includes("already exists");
    if ((dup && (constraint.includes("arn") || msg.includes("arn") || detail.includes("arn"))) || msg.includes("tenants_arn_unique")) {
      return NextResponse.json({ error: "ARN already registered" }, { status: 409 });
    }
    if ((dup && (constraint.includes("email") || msg.includes("email") || detail.includes("email"))) || msg.includes("users_tenant_email_unique")) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }
    // Common dev-time failure modes — give actionable guidance.
    if (msg.includes("ECONNREFUSED") || msg.includes("getaddrinfo") || msg.includes("connect ETIMEDOUT")) {
      return NextResponse.json(
        {
          error: "Database not reachable. Is Postgres running and DATABASE_URL correct in .env?",
          detail: msg,
        },
        { status: 503 }
      );
    }
    if (msg.includes('relation "tenants" does not exist') || msg.includes('relation "branches" does not exist')) {
      return NextResponse.json(
        {
          error: "Schema not migrated. Run: npm run db:push (then `psql $DATABASE_URL -f drizzle/migrations/0001_rls_policies.sql` to enable RLS).",
          detail: msg,
        },
        { status: 503 }
      );
    }
    if (msg.includes("ALLOW_SYSTEM_TX") || msg.includes("withSystem disabled")) {
      return NextResponse.json(
        { error: "Server config: set ALLOW_SYSTEM_TX=1 in .env (required during signup before tenant exists) and restart `npm run dev`." },
        { status: 503 }
      );
    }
    if (msg.includes("no_package_configured")) {
      return NextResponse.json(
        { error: "Signups are temporarily unavailable (no billing plan is configured). Please contact support." },
        { status: 503 }
      );
    }
    console.error("[signup] failed", err);
    // In dev, surface the real error to speed up debugging. Never in production.
    return NextResponse.json(
      {
        error: "signup failed",
        detail: process.env.NODE_ENV !== "production" ? msg : undefined,
      },
      { status: 500 }
    );
  }

  // Issue an email-verification token + send the confirm link (best-effort).
  // We still log the owner in immediately (frictionless trial), but the
  // unverified state is recorded so the app can nudge them and gate
  // abuse-prone actions (e.g. inviting a team) until they confirm.
  let emailSent = false;
  try {
    const v = await issueEmailVerification({
      userId,
      tenantId,
      email: ownerEmail,
      name: ownerName,
      firmName,
    });
    emailSent = v.emailSent;
  } catch (err) {
    console.error("[signup] email-verification issue failed:", err);
  }

  const token = await signSession({
    userId,
    tenantId,
    branchId,
    roles: ["owner", "rm", "compliance"],
    email: ownerEmail,
    name: ownerName,
  });

  const res = NextResponse.json({ ok: true, tenantId, userId, verificationEmailSent: emailSent });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
  return res;
}
