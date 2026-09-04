/**
 * Seed script.
 *   `npm run seed` populates:
 *     - 24 workflow recipes (global, all tenants share)
 *     - 5 packages (Starter / Growth / Pro / Premium / Custom)
 *     - 1 Equitywala platform admin (admin@ssit.com / ssit12345)
 *     - 1 demo MFD tenant (Demo Wealth Advisors / owner@demo.in / demo12345)
 *       with 5 team users + 10 leads + 20 clients + 5 families + 10 SIPs
 *       + 5 SIP rejections + 10 tasks + 5 review meetings + 5 service
 *       requests + 1 DDQ scorecard + a month of content calendar entries.
 *
 * Idempotent — re-running is safe (uses ON CONFLICT … DO NOTHING / UPDATE).
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { db, withSystem } from "./client";
import { ALL_RECIPES } from "@/lib/recipes";
import { ALL_MODULES, PACKAGE_PRESETS, PLATFORM_TENANT_ID } from "@/lib/platform";
import { MASTER_SEEDS } from "@/lib/masters/seeds";

async function seedRecipes() {
  console.log(`Seeding ${ALL_RECIPES.length} recipes…`);
  await withSystem(async (tx) => {
    for (const r of ALL_RECIPES) {
      await tx.execute(sql`
        INSERT INTO recipes (id, key, name, description, category, graph, tags, created_at, updated_at)
        VALUES (
          gen_random_uuid(), ${r.key}, ${r.name}, ${r.description}, ${r.category},
          ${JSON.stringify(r.graph)}::jsonb, ${JSON.stringify(r.tags ?? [])}::jsonb,
          now(), now()
        )
        ON CONFLICT (key) DO UPDATE
        SET name = EXCLUDED.name, description = EXCLUDED.description, category = EXCLUDED.category,
            graph = EXCLUDED.graph, tags = EXCLUDED.tags, updated_at = now()
      `);
    }
  });
  console.log("✓ recipes seeded");
}

async function seedPackages() {
  console.log("Seeding packages…");
  const presets = [
    {
      key: "starter",
      name: "Starter",
      description: "Solo MFD, ≤200 clients. Core CRM + ops only.",
      monthly_price_paise: 1499 * 100,
      yearly_price_paise: 14_999 * 100,
      setup_cost_paise: 5_000 * 100,
      max_users: 2,
      max_investors: 200,
      storage_limit_gb: 5,
      trial_days: 14,
      sort_order: 1,
    },
    {
      key: "growth",
      name: "Growth",
      description: "2–5 staff, 200–1,000 clients. Includes WhatsApp + automation.",
      monthly_price_paise: 3999 * 100,
      yearly_price_paise: 39_999 * 100,
      setup_cost_paise: 5_000 * 100,
      max_users: 3,
      max_investors: 1_000,
      storage_limit_gb: 25,
      trial_days: 14,
      sort_order: 2,
      badge: "Most Popular",
    },
    {
      key: "professional",
      name: "Professional",
      description: "5–15 staff, 1,000–5,000 clients. Advanced AI + custom reports.",
      monthly_price_paise: 8999 * 100,
      yearly_price_paise: 89_999 * 100,
      setup_cost_paise: 5_000 * 100,
      max_users: 7,
      max_investors: 5_000,
      storage_limit_gb: 100,
      trial_days: 14,
      sort_order: 3,
    },
    {
      key: "premium",
      name: "Premium / Enterprise",
      description: "15+ staff, 5,000+ clients. Full white-label + sub-distributor.",
      monthly_price_paise: 19999 * 100,
      yearly_price_paise: 199_999 * 100,
      setup_cost_paise: 0,
      max_users: 25,
      max_investors: 25_000,
      storage_limit_gb: 500,
      trial_days: 30,
      sort_order: 4,
    },
    {
      key: "custom",
      name: "Custom",
      description: "Negotiated pricing + custom integrations.",
      monthly_price_paise: 0,
      yearly_price_paise: 0,
      setup_cost_paise: 0,
      max_users: 100,
      max_investors: 100_000,
      storage_limit_gb: 1_000,
      trial_days: 0,
      sort_order: 5,
      is_public: false,
    },
  ];

  await withSystem(async (tx) => {
    for (const p of presets) {
      const preset = PACKAGE_PRESETS[p.key] ?? { modules: ALL_MODULES, flags: {} };
      await tx.execute(sql`
        INSERT INTO packages (
          id, key, name, description, monthly_price_paise, yearly_price_paise, setup_cost_paise,
          max_users, max_investors, storage_limit_gb, trial_days,
          enabled_modules, feature_flags, sort_order, is_active, is_public, badge,
          created_at, updated_at
        )
        VALUES (
          gen_random_uuid(), ${p.key}, ${p.name}, ${p.description},
          ${p.monthly_price_paise}, ${p.yearly_price_paise}, ${p.setup_cost_paise},
          ${p.max_users}, ${p.max_investors}, ${p.storage_limit_gb}, ${p.trial_days},
          ${JSON.stringify(preset.modules)}::jsonb,
          ${JSON.stringify(preset.flags)}::jsonb,
          ${p.sort_order}, true, ${(p as any).is_public ?? true}, ${(p as any).badge ?? null},
          now(), now()
        )
        ON CONFLICT (key) DO UPDATE
        SET name = EXCLUDED.name, description = EXCLUDED.description,
            monthly_price_paise = EXCLUDED.monthly_price_paise,
            yearly_price_paise = EXCLUDED.yearly_price_paise,
            max_users = EXCLUDED.max_users, max_investors = EXCLUDED.max_investors,
            storage_limit_gb = EXCLUDED.storage_limit_gb, trial_days = EXCLUDED.trial_days,
            enabled_modules = EXCLUDED.enabled_modules, feature_flags = EXCLUDED.feature_flags,
            sort_order = EXCLUDED.sort_order, badge = EXCLUDED.badge,
            updated_at = now()
      `);
    }
  });
  console.log("✓ packages seeded");
}

async function seedSsitAdmin() {
  console.log("Seeding Equitywala platform admin…");
  await withSystem(async (tx) => {
    // Platform tenant — sentinel that Equitywala staff live under.
    await tx.execute(sql`
      INSERT INTO tenants (id, legal_name, display_name, arn, plan, status, created_at, updated_at)
      VALUES (
        ${PLATFORM_TENANT_ID}::uuid, 'Equitywala Platform', 'Equitywala Platform',
        'PLATFORM', 'enterprise', 'active', now(), now()
      )
      ON CONFLICT (id) DO NOTHING
    `);

    // Production: pass ADMIN_EMAIL + ADMIN_PASSWORD so no known default ships.
    // Dev: falls back to the documented demo credentials.
    const email = (process.env.ADMIN_EMAIL || "admin@ssit.com").toLowerCase();
    const password = process.env.ADMIN_PASSWORD || "ssit12345";
    const name = process.env.ADMIN_NAME || "Equitywala Admin";
    const hash = await bcrypt.hash(password, 12);
    await tx.execute(sql`
      INSERT INTO users (
        id, tenant_id, email, name, password_hash, roles, status, activated_at, created_at, updated_at
      )
      VALUES (
        gen_random_uuid(), ${PLATFORM_TENANT_ID}::uuid, ${email}, ${name},
        ${hash}, ARRAY['platform_admin']::text[], 'active', now(), now(), now()
      )
      ON CONFLICT (tenant_id, email) DO NOTHING
    `);
  });
  const shownEmail = (process.env.ADMIN_EMAIL || "admin@ssit.com").toLowerCase();
  console.log(
    process.env.ADMIN_PASSWORD
      ? `✓ Equitywala admin seeded — login: ${shownEmail} (password from ADMIN_PASSWORD)`
      : `✓ Equitywala admin seeded — login: ${shownEmail} / ssit12345`
  );
}

// Helper: days from now (negative = past)
function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function seedDemoTenant() {
  console.log("Seeding Demo Wealth Advisors…");

  const tenantId = uuid();
  const branchId = uuid();
  const ownerId = uuid();
  const rmId = uuid();
  const opsId = uuid();
  const mktId = uuid();
  const compId = uuid();
  const teamId = uuid();
  const subId = uuid();

  await withSystem(async (tx) => {
    // Skip if demo tenant already exists
    const exists = await tx.execute(sql`SELECT id FROM tenants WHERE arn = 'ARN-123456' LIMIT 1`);
    if ((exists.rows as any[]).length > 0) {
      console.log("✓ Demo tenant already exists, skipping");
      return;
    }

    await tx.execute(sql`
      INSERT INTO tenants (
        id, legal_name, display_name, arn, principal_euin, gst_number,
        primary_color, secondary_color,
        address, phone, email, website, plan, status, trial_ends_at,
        aum_range, sip_book_range, team_size, current_software_used,
        created_at, updated_at
      )
      VALUES (
        ${tenantId}, 'Demo Wealth Advisors', 'Demo Wealth', 'ARN-123456', 'E123456', '24ABCDE1234F1Z5',
        '#0ea5e9', '#22c55e',
        ${JSON.stringify({ line1: "204, Wealth Tower", city: "Ahmedabad", state: "Gujarat", pincode: "380015", country: "India" })}::jsonb,
        '+919876543210', 'owner@demo.in', 'https://demowealth.in',
        'professional', 'active',
        now() + interval '60 days',
        '₹50Cr – ₹100Cr', '₹50L – ₹1Cr', '11–25', 'Excel + Google Sheets',
        now(), now()
      )
    `);

    await tx.execute(sql`
      INSERT INTO branches (id, tenant_id, name, code, is_hq, created_at, updated_at)
      VALUES (${branchId}, ${tenantId}, 'Ahmedabad HQ', 'HQ', 'true', now(), now())
    `);

    // 5 demo users
    const users = [
      { id: ownerId, email: "owner@demo.in", name: "Rajesh Demo (Owner)", roles: ["owner", "rm", "compliance"], euin: "E123456" },
      { id: rmId, email: "rm@demo.in", name: "Pooja Shah (RM)", roles: ["rm"], euin: "E123457", nismExp: "2027-08-15" },
      { id: opsId, email: "ops@demo.in", name: "Sneha Mehta (Ops)", roles: ["back_office", "ops"] },
      { id: mktId, email: "marketing@demo.in", name: "Aarav Patel (Marketing)", roles: ["marketing"] },
      { id: compId, email: "compliance@demo.in", name: "Meera Joshi (Compliance)", roles: ["compliance"] },
      { id: teamId, email: "team@demo.in", name: "Ravi Khanna (Team Member)", roles: ["team_member"] },
    ];
    const pwHash = await bcrypt.hash("demo12345", 12);
    for (const u of users) {
      const rolesLiteral = sql.raw(`ARRAY[${u.roles.map((r: string) => `'${r}'`).join(",")}]::text[]`);
      await tx.execute(sql`
        INSERT INTO users (
          id, tenant_id, branch_id, email, name, password_hash, roles, status,
          euin, nism_expiry_at, activated_at, created_at, updated_at
        )
        VALUES (
          ${u.id}, ${tenantId}, ${branchId}, ${u.email}, ${u.name}, ${pwHash},
          ${rolesLiteral}, 'active', ${u.euin ?? null}, ${u.nismExp ?? null},
          now(), now(), now()
        )
      `);
    }

    // Subscription — Professional package, active
    const pkgRes = await tx.execute(sql`SELECT id FROM packages WHERE key = 'professional' LIMIT 1`);
    const pkgId = (pkgRes.rows[0] as any).id;
    await tx.execute(sql`
      INSERT INTO subscriptions (
        id, tenant_id, package_id, package_key, status, billing_cycle,
        license_start_at, license_end_at, trial_ends_at, next_renewal_at,
        created_at, updated_at
      )
      VALUES (
        ${subId}, ${tenantId}, ${pkgId}, 'professional', 'active', 'yearly',
        now() - interval '30 days', now() + interval '335 days',
        now() + interval '60 days', now() + interval '335 days',
        now(), now()
      )
    `);
    await tx.execute(sql`
      INSERT INTO subscription_events (id, subscription_id, tenant_id, event_type, actor, to_status, to_package, notes, at)
      VALUES
        (gen_random_uuid(), ${subId}, ${tenantId}, 'created', 'seed', 'trial', 'professional', 'Tenant created', now() - interval '30 days'),
        (gen_random_uuid(), ${subId}, ${tenantId}, 'activated', 'seed', 'active', 'professional', 'Activated after payment', now() - interval '29 days')
    `);

    // Master values for this tenant
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

    // 5 families
    const familyIds = Array.from({ length: 5 }, () => uuid());
    const familyNames = ["Patel", "Shah", "Mehta", "Iyer", "Kumar"];
    for (let i = 0; i < 5; i++) {
      await tx.execute(sql`
        INSERT INTO families (id, tenant_id, branch_id, head_name, created_at, updated_at)
        VALUES (${familyIds[i]}, ${tenantId}, ${branchId}, ${familyNames[i] + " Family"}, now(), now())
      `);
    }

    // 20 clients
    const clients = [
      { name: "Rajesh Patel", pan: "ABCPP1234E", phone: "+919812345601", segment: "HNI", aum: 18500000, sip: 35000, family: 0 },
      { name: "Priya Patel", pan: "ABCPP1235F", phone: "+919812345602", segment: "Affluent", aum: 4800000, sip: 12000, family: 0 },
      { name: "Aarav Patel", pan: "ABCPP1236G", phone: "+919812345603", segment: "Retail", aum: 280000, sip: 5000, family: 0 },
      { name: "Pooja Shah", pan: "ABCSS2234E", phone: "+919812345610", segment: "HNI", aum: 12500000, sip: 28000, family: 1 },
      { name: "Sneha Shah", pan: "ABCSS2235F", phone: "+919812345611", segment: "Affluent", aum: 3200000, sip: 8000, family: 1 },
      { name: "Hardik Mehta", pan: "ABCMM3234E", phone: "+919812345620", segment: "HNI", aum: 32000000, sip: 75000, family: 2 },
      { name: "Meera Mehta", pan: "ABCMM3235F", phone: "+919812345621", segment: "Affluent", aum: 5600000, sip: 18000, family: 2 },
      { name: "Suresh Iyer", pan: "ABCII4234E", phone: "+919812345630", segment: "HNI", aum: 21000000, sip: 50000, family: 3 },
      { name: "Lakshmi Iyer", pan: "ABCII4235F", phone: "+919812345631", segment: "Affluent", aum: 4200000, sip: 15000, family: 3 },
      { name: "Arvind Kumar", pan: "ABCKK5234E", phone: "+919812345640", segment: "Retail", aum: 850000, sip: 3000, family: 4 },
      { name: "Anita Kumar", pan: "ABCKK5235F", phone: "+919812345641", segment: "Retail", aum: 620000, sip: 2500, family: 4 },
      { name: "Vikram Joshi", pan: "ABCJJ6234E", phone: "+919812345650", segment: "Affluent", aum: 3800000, sip: 12000 },
      { name: "Neha Gupta", pan: "ABCGG7234E", phone: "+919812345660", segment: "Retail", aum: 420000, sip: 3000 },
      { name: "Ramesh Bhatt", pan: "ABCBB8234E", phone: "+919812345670", segment: "Affluent", aum: 6500000, sip: 22000 },
      { name: "Geeta Desai", pan: "ABCDD9234E", phone: "+919812345680", segment: "HNI", aum: 15000000, sip: 40000 },
      { name: "Sandeep Yadav", pan: "ABCYY1334E", phone: "+919812345690", segment: "Retail", aum: 180000, sip: 2000 },
      { name: "Divya Trivedi", pan: "ABCTT1434E", phone: "+919812345601", segment: "NRI", aum: 8500000, sip: 0 },
      { name: "Manish Sharma", pan: "ABCSH1534E", phone: "+919812345602", segment: "Affluent", aum: 4500000, sip: 12000 },
      { name: "Kavita Pandey", pan: "ABCPN1634E", phone: "+919812345603", segment: "Retail", aum: 320000, sip: 4000 },
      { name: "Pradeep Verma", pan: "ABCVR1734E", phone: "+919812345604", segment: "HNI", aum: 19500000, sip: 55000 },
    ];
    const investorIds: string[] = [];
    for (let i = 0; i < clients.length; i++) {
      const c = clients[i];
      const id = uuid();
      investorIds.push(id);
      const familyId = c.family !== undefined ? familyIds[c.family] : null;
      const dob = new Date(1970 + (i * 3) % 30, i % 12, (i * 7) % 28 + 1).toISOString().slice(0, 10);
      // Compute next_review_at as a real Date — HNI clients reviewed quarterly, others half-yearly.
      const reviewIntervalDays = c.segment === "HNI" ? 90 : 180;
      const lastReviewDaysAgo = (i % 90) + 1;
      const nextReview = new Date(Date.now() + (reviewIntervalDays - lastReviewDaysAgo) * 24 * 60 * 60 * 1000);
      await tx.execute(sql`
        INSERT INTO investors (
          id, tenant_id, branch_id, family_id, pan, name, dob, gender,
          email, phone, whatsapp_phone, investor_category, segment_tag,
          kyc_status, risk_profile, risk_profile_signed_at,
          aum, active_sip_amount, lifetime_inflow,
          rm_id, onboarded_at, last_transaction_at, last_contact_at, last_review_at, next_review_at,
          nominee_name, nominee_relation, status, created_at, updated_at
        )
        VALUES (
          ${id}, ${tenantId}, ${branchId}, ${familyId},
          ${c.pan}, ${c.name}, ${dob}, ${i % 2 === 0 ? "M" : "F"},
          ${c.name.toLowerCase().replace(/ /g, ".") + "@demo.in"}, ${c.phone}, ${c.phone},
          ${c.segment === "NRI" ? "nri" : "individual"}, ${c.segment},
          'verified', ${c.segment === "HNI" ? "aggressive" : c.segment === "Retail" ? "conservative" : "moderate"},
          ${daysFromNow(-(i + 1) * 30).toISOString()}::timestamptz,
          ${c.aum}, ${c.sip}, ${c.aum * 1.2},
          ${i % 3 === 0 ? rmId : ownerId},
          ${daysFromNow(-(i + 1) * 30).toISOString()}::timestamptz,
          ${daysFromNow(-((i % 30) + 1)).toISOString()}::timestamptz,
          ${daysFromNow(-((i % 15) + 1)).toISOString()}::timestamptz,
          ${daysFromNow(-((i % 90) + 1)).toISOString()}::timestamptz,
          ${nextReview.toISOString()}::timestamptz,
          ${i % 4 === 0 ? null : "Spouse Name"}, ${i % 4 === 0 ? null : "spouse"},
          ${i % 7 === 0 ? "dormant" : "active"}, now(), now()
        )
      `);
    }

    // 10 leads
    const leadSources = ["website", "referral", "meta_ads", "google_ads", "walk_in", "linkedin"];
    const leadStages = ["new", "contacted", "qualified", "proposal_sent", "new", "contacted", "qualified", "converted", "lost", "new"];
    const leadNames = [
      "Ankit Trivedi", "Reema Kapoor", "Mohit Arora", "Sneha Reddy", "Kunal Tiwari",
      "Anjali Desai", "Rohit Saxena", "Tanya Aggarwal", "Vivek Mishra", "Riya Kapoor",
    ];
    for (let i = 0; i < 10; i++) {
      await tx.execute(sql`
        INSERT INTO leads (
          id, tenant_id, branch_id, name, email, phone, city,
          source, stage, stage_changed_at, score, intended_amount,
          owner_id, next_follow_up_at, last_contact_at, notes,
          created_at, updated_at
        )
        VALUES (
          gen_random_uuid(), ${tenantId}, ${branchId},
          ${leadNames[i]}, ${leadNames[i].toLowerCase().replace(/ /g, ".") + "@gmail.com"},
          ${"+9198765432" + String(50 + i).padStart(2, "0")}, ${["Mumbai", "Pune", "Bengaluru", "Hyderabad", "Surat"][i % 5]},
          ${leadSources[i % leadSources.length]}, ${leadStages[i]},
          ${daysFromNow(-(i + 1)).toISOString()}::timestamptz, ${String(20 + (i * 7) % 80)}, ${String(100000 + i * 50000)},
          ${i % 2 === 0 ? rmId : ownerId},
          ${daysFromNow((i % 7) + 1).toISOString()}::timestamptz, ${daysFromNow(-(i + 1)).toISOString()}::timestamptz,
          ${i === 7 ? "Converted — see Vikram Joshi client" : i === 8 ? "Decided to invest elsewhere" : "Initial interest noted"},
          ${daysFromNow(-(i + 1) * 3).toISOString()}::timestamptz, now()
        )
      `);
    }

    // 10 SIPs
    for (let i = 0; i < 10; i++) {
      await tx.execute(sql`
        INSERT INTO sips (
          id, tenant_id, investor_id, scheme_code, scheme_name, amount, frequency, sip_date,
          start_date, next_installment_at, status, created_at, updated_at
        )
        VALUES (
          gen_random_uuid(), ${tenantId}, ${investorIds[i]},
          ${["HDFC-TOP100", "AXIS-BLUE", "PARAG-FLEX", "SBI-CONTRA", "MIRAE-ELSS"][i % 5]},
          ${["HDFC Top 100 Fund", "Axis Bluechip Fund", "Parag Parikh Flexi Cap", "SBI Contra Fund", "Mirae Asset ELSS"][i % 5]},
          ${clients[i].sip * 100}, 'monthly', ${(i % 28 + 1).toString()},
          ${daysFromNow(-(i + 1) * 90).toISOString().slice(0, 10)}::date,
          ${daysFromNow((i % 28) + 1).toISOString().slice(0, 10)}::date,
          ${i === 9 ? "stopped" : "active"}, now(), now()
        )
      `);
    }

    // 5 SIP rejections (as transactions with status=rejected)
    const reasons = [
      { code: "INSUFFICIENT_BALANCE", desc: "Insufficient funds in linked bank account" },
      { code: "MANDATE_EXPIRED", desc: "NACH mandate expired" },
      { code: "MANDATE_NOT_FOUND", desc: "No active mandate for this folio" },
      { code: "TECH_REJECT", desc: "Bank technical error" },
      { code: "INSUFFICIENT_BALANCE", desc: "Insufficient funds in linked bank account" },
    ];
    for (let i = 0; i < 5; i++) {
      const r = reasons[i];
      await tx.execute(sql`
        INSERT INTO transactions (
          id, tenant_id, investor_id, scheme_code, scheme_name,
          type, direction, amount, status, reason_code, reason_description,
          order_date, source_feed, created_at, updated_at
        )
        VALUES (
          gen_random_uuid(), ${tenantId}, ${investorIds[i + 2]},
          'HDFC-TOP100', 'HDFC Top 100 Fund',
          'sip', 'inflow', ${clients[i + 2].sip * 100},
          'rejected', ${r.code}, ${r.desc},
          ${daysFromNow(-(i + 1)).toISOString().slice(0, 10)}::date, 'cams',
          ${daysFromNow(-(i + 1)).toISOString()}::timestamptz, now()
        )
      `);
    }

    // 10 tasks (open, varied)
    const taskTitles = [
      ["Confirm balance & retry SIP — Aarav Patel", "sip_retry", "high", rmId, 1, investorIds[2]],
      ["Mandate renewal — Hardik Mehta", "mandate_renewal", "urgent", opsId, 2, investorIds[5]],
      ["Schedule HNI quarterly review — Suresh Iyer", "review_meeting", "high", rmId, 5, investorIds[7]],
      ["Collect re-KYC docs — Neha Gupta", "kyc_renewal", "normal", opsId, 14, investorIds[12]],
      ["Add nominee — Arvind Kumar", "nominee_update", "normal", opsId, 14, investorIds[9]],
      ["Birthday call — Pooja Shah", "engagement", "normal", rmId, 1, investorIds[3]],
      ["Follow up on lead Ankit Trivedi", "lead_followup", "high", rmId, 2, null],
      ["Goal review — Patel family", "goal_review", "normal", ownerId, 7, investorIds[0]],
      ["Quarterly newsletter content review", "internal", "normal", mktId, 3, null],
      ["DDQ Q3 checklist completion", "compliance", "high", compId, 10, null],
    ];
    for (const t of taskTitles) {
      await tx.execute(sql`
        INSERT INTO tasks (
          id, tenant_id, subject_type, subject_id, type, title, priority, status,
          assignee_id, due_at, created_at, updated_at
        )
        VALUES (
          gen_random_uuid(), ${tenantId},
          ${t[5] ? "investor" : "internal"}, ${t[5]},
          ${t[1]}, ${t[0]}, ${t[2]}, 'open',
          ${t[3]}, ${daysFromNow(t[4] as number).toISOString()}::timestamptz,
          now(), now()
        )
      `);
    }

    // 5 service requests
    const sr = [
      ["SR-2026-00001", "Update bank account", "bank_update", investorIds[0], "open", 24 * 7],
      ["SR-2026-00002", "Mobile number change request", "mobile_update", investorIds[3], "in_progress", 24 * 3],
      ["SR-2026-00003", "Need consolidated capital gains report FY24-25", "capital_gain_report", investorIds[5], "open", 24 * 3],
      ["SR-2026-00004", "Add nominee for joint folio", "nominee_update", investorIds[8], "waiting_customer", 24 * 14],
      ["SR-2026-00005", "Complaint: SIP debit not reflected in portfolio", "complaint", investorIds[2], "open", 24 * 21],
    ];
    for (const r of sr) {
      await tx.execute(sql`
        INSERT INTO service_requests (
          id, tenant_id, ticket_no, investor_id, type, subject, status, priority,
          channel, sla_resolution_at, sla_response_at, created_at, updated_at
        )
        VALUES (
          gen_random_uuid(), ${tenantId}, ${r[0]}, ${r[3]}, ${r[2]}, ${r[1]},
          ${r[4]}, 'normal', 'email',
          ${new Date(Date.now() + (r[5] as number) * 60 * 60 * 1000).toISOString()}::timestamptz,
          ${new Date(Date.now() + ((r[5] as number) / 4) * 60 * 60 * 1000).toISOString()}::timestamptz,
          ${daysFromNow(-2).toISOString()}::timestamptz, now()
        )
      `);
    }

    // 5 review meetings (as completed historical entries — informational only;
    // the review_meetings table is a TODO but investors.last_review_at carries the data)
    // 1 DDQ scorecard
    await tx.execute(sql`
      INSERT INTO ddq_scores (id, tenant_id, computed_at, overall_score, breakdown, findings)
      VALUES (
        gen_random_uuid(), ${tenantId}, now(), 87.5,
        ${JSON.stringify({
          nismValidity: 92,
          arnRenewalStatus: 100,
          kydCompleteness: 85,
          complaintRegisterCurrency: 100,
          empanelmentCompleteness: 73,
          sopSignoffCoverage: 68,
          auditTrailIntegrity: 100,
          consentLedger: 91,
        })}::jsonb,
        ${JSON.stringify([
          { category: "empanelment", message: "3 AMC empanelment docs missing", severity: "warn" },
          { category: "sop", message: "SOP sign-off coverage below 80%", severity: "warn" },
        ])}::jsonb
      )
    `);

    // 30 days of content calendar (would need content_calendar table — skip for now,
    // it's a TODO module. Sample broadcast campaign instead:)
    await tx.execute(sql`
      INSERT INTO campaigns (
        id, tenant_id, name, description, channel, status, total_recipients,
        sent_count, delivered_count, read_count, throttle_per_minute,
        created_at, updated_at
      )
      VALUES (
        gen_random_uuid(), ${tenantId}, 'Q3 Investor Newsletter', 'Monthly market commentary + portfolio tips',
        'email', 'sent', 18, 18, 17, 12, 60,
        now() - interval '10 days', now() - interval '10 days'
      ),
      (
        gen_random_uuid(), ${tenantId}, 'Diwali Greetings 2026', 'Festival WhatsApp wish to all clients',
        'whatsapp', 'sent', 20, 20, 19, 14, 60,
        now() - interval '20 days', now() - interval '20 days'
      )
    `);
  });

  console.log("✓ Demo Wealth Advisors seeded");
  console.log("  Logins (password: demo12345):");
  console.log("    owner@demo.in        — MFD Owner");
  console.log("    rm@demo.in           — Relationship Manager");
  console.log("    ops@demo.in          — Back Office");
  console.log("    marketing@demo.in    — Marketing Executive");
  console.log("    compliance@demo.in   — Compliance Officer");
}

async function main() {
  await seedRecipes();
  await seedPackages();
  await seedSsitAdmin();
  await seedDemoTenant();
  console.log("\nAll seed data loaded. Login:");
  console.log("  Equitywala admin:  admin@ssit.com / ssit12345  → /super-admin");
  console.log("  Demo owner:  owner@demo.in / demo12345      → /dashboard");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
