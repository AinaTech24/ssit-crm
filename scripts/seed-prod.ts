/**
 * Production seed — the real-customers counterpart to src/db/seed.ts.
 *
 * Seeds ONLY what a live platform needs and NOTHING fake:
 *   1. subscription packages (so the platform admin can assign plans to tenants)
 *   2. the automation recipe library
 *   3. ONE platform admin (Equitywala), credentials from env — NO known default ships
 *
 * It deliberately does NOT create the "Demo Wealth Advisors" tenant or any
 * sample investors/leads. Run once on a fresh DB after migrations:
 *
 *   ADMIN_EMAIL=you@firm.com ADMIN_PASSWORD='<strong>' ADMIN_NAME='Your Name' \
 *   ALLOW_SYSTEM_TX=1 npm run seed:prod
 *
 * Idempotent (ON CONFLICT upserts) — safe to re-run.
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { withSystem } from "../src/db/client";
import { ALL_RECIPES } from "../src/lib/recipes";
import { ALL_MODULES, PACKAGE_PRESETS, PLATFORM_TENANT_ID } from "../src/lib/platform";

const PACKAGES = [
  { key: "starter", name: "Starter", description: "Solo MFD, ≤200 clients. Core CRM + ops only.", monthly_price_paise: 1499 * 100, yearly_price_paise: 14_999 * 100, setup_cost_paise: 5_000 * 100, max_users: 2, max_investors: 200, storage_limit_gb: 5, trial_days: 14, sort_order: 1 },
  { key: "growth", name: "Growth", description: "2–5 staff, 200–1,000 clients. Includes WhatsApp + automation.", monthly_price_paise: 3999 * 100, yearly_price_paise: 39_999 * 100, setup_cost_paise: 5_000 * 100, max_users: 3, max_investors: 1_000, storage_limit_gb: 25, trial_days: 14, sort_order: 2, badge: "Most Popular" },
  { key: "professional", name: "Professional", description: "5–15 staff, 1,000–5,000 clients. Advanced AI + custom reports.", monthly_price_paise: 8999 * 100, yearly_price_paise: 89_999 * 100, setup_cost_paise: 5_000 * 100, max_users: 7, max_investors: 5_000, storage_limit_gb: 100, trial_days: 14, sort_order: 3 },
  { key: "premium", name: "Premium / Enterprise", description: "15+ staff, 5,000+ clients. Full white-label + sub-distributor.", monthly_price_paise: 19999 * 100, yearly_price_paise: 199_999 * 100, setup_cost_paise: 0, max_users: 25, max_investors: 25_000, storage_limit_gb: 500, trial_days: 30, sort_order: 4 },
  { key: "custom", name: "Custom", description: "Negotiated pricing + custom integrations.", monthly_price_paise: 0, yearly_price_paise: 0, setup_cost_paise: 0, max_users: 100, max_investors: 100_000, storage_limit_gb: 1_000, trial_days: 0, sort_order: 5, is_public: false },
] as const;

async function seedPackages() {
  console.log("Seeding packages…");
  await withSystem(async (tx) => {
    for (const p of PACKAGES) {
      const preset = PACKAGE_PRESETS[p.key] ?? { modules: ALL_MODULES, flags: {} };
      await tx.execute(sql`
        INSERT INTO packages (
          id, key, name, description, monthly_price_paise, yearly_price_paise, setup_cost_paise,
          max_users, max_investors, storage_limit_gb, trial_days,
          enabled_modules, feature_flags, sort_order, is_active, is_public, badge, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), ${p.key}, ${p.name}, ${p.description},
          ${p.monthly_price_paise}, ${p.yearly_price_paise}, ${p.setup_cost_paise},
          ${p.max_users}, ${p.max_investors}, ${p.storage_limit_gb}, ${p.trial_days},
          ${JSON.stringify(preset.modules)}::jsonb, ${JSON.stringify(preset.flags)}::jsonb,
          ${p.sort_order}, true, ${(p as any).is_public ?? true}, ${(p as any).badge ?? null}, now(), now()
        )
        ON CONFLICT (key) DO UPDATE SET
          name = EXCLUDED.name, description = EXCLUDED.description,
          monthly_price_paise = EXCLUDED.monthly_price_paise, yearly_price_paise = EXCLUDED.yearly_price_paise,
          max_users = EXCLUDED.max_users, max_investors = EXCLUDED.max_investors,
          storage_limit_gb = EXCLUDED.storage_limit_gb, trial_days = EXCLUDED.trial_days,
          enabled_modules = EXCLUDED.enabled_modules, feature_flags = EXCLUDED.feature_flags,
          sort_order = EXCLUDED.sort_order, badge = EXCLUDED.badge, updated_at = now()
      `);
    }
  });
  console.log(`✓ ${PACKAGES.length} packages seeded`);
}

async function seedRecipes() {
  console.log(`Seeding ${ALL_RECIPES.length} recipes…`);
  await withSystem(async (tx) => {
    for (const r of ALL_RECIPES) {
      await tx.execute(sql`
        INSERT INTO recipes (id, key, name, description, category, graph, tags, created_at, updated_at)
        VALUES (
          gen_random_uuid(), ${r.key}, ${r.name}, ${r.description}, ${r.category},
          ${JSON.stringify(r.graph)}::jsonb, ${JSON.stringify(r.tags ?? [])}::jsonb, now(), now()
        )
        ON CONFLICT (key) DO UPDATE SET
          name = EXCLUDED.name, description = EXCLUDED.description, category = EXCLUDED.category,
          graph = EXCLUDED.graph, tags = EXCLUDED.tags, updated_at = now()
      `);
    }
  });
  console.log("✓ recipes seeded");
}

async function seedPlatformAdmin() {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";
  const name = process.env.ADMIN_NAME || "Platform Admin";
  if (!email || !password) {
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD to create the platform admin (no default ships in production).");
  }
  if (password.length < 10) throw new Error("ADMIN_PASSWORD must be at least 10 characters.");

  console.log("Seeding platform admin…");
  const hash = await bcrypt.hash(password, 12);
  await withSystem(async (tx) => {
    await tx.execute(sql`
      INSERT INTO tenants (id, legal_name, display_name, arn, plan, status, created_at, updated_at)
      VALUES (${PLATFORM_TENANT_ID}::uuid, 'Equitywala Platform', 'Equitywala Platform', 'PLATFORM', 'enterprise', 'active', now(), now())
      ON CONFLICT (id) DO NOTHING
    `);
    await tx.execute(sql`
      INSERT INTO users (id, tenant_id, email, name, password_hash, roles, status, activated_at, created_at, updated_at)
      VALUES (gen_random_uuid(), ${PLATFORM_TENANT_ID}::uuid, ${email}, ${name}, ${hash},
              ARRAY['platform_admin']::text[], 'active', now(), now(), now())
      ON CONFLICT (tenant_id, email) DO NOTHING
    `);
  });
  console.log(`✓ platform admin seeded — login: ${email} → /super-admin`);
}

async function main() {
  await seedPackages();
  await seedRecipes();
  await seedPlatformAdmin();
  console.log("\n✓ Production seed complete (no demo data).");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
