/**
 * Public lead-capture form endpoints (no auth):
 *   GET  /api/public/lead-forms/[slug]   — return form definition for rendering
 *   POST /api/public/lead-forms/[slug]   — accept a submission, create a lead
 *
 * No session — caller is the public internet. We resolve the tenant via
 * the slug. The actual DB work runs inside withTenant(form.tenantId,…)
 * so RLS scopes correctly. withSystem is used ONLY for the slug → tenant
 * lookup (a single read, no PII).
 *
 * Rate-limited per IP per hour using the existing in-memory enforcer.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { withSystem, withTenant } from "@/db/client";
import { leadCaptureForms, leads, tenants } from "@/db/schema";
import { pickRmForNewLead } from "@/lib/leads/assign";
import { enforce } from "@/lib/rate-limit";
import {
  normalizeEmail,
  normalizeLeadSource,
  normalizePan,
  normalizePhoneLast10,
} from "@/lib/leads/normalize";
import { scoreFields } from "@/lib/leads/score";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const limited = enforce(req, `lead-form.get.${slug}`, { limit: 60, windowSec: 60 });
  if (limited) return limited;

  // Single read in system context to resolve the slug. We return form
  // definition + tenant display branding only — no PII, no inbound data.
  const form = await withSystem(async (tx) => {
    const f = (
      await tx
        .select({
          id: leadCaptureForms.id,
          tenantId: leadCaptureForms.tenantId,
          name: leadCaptureForms.name,
          description: leadCaptureForms.description,
          fields: leadCaptureForms.fields,
          branding: leadCaptureForms.branding,
          enabled: leadCaptureForms.enabled,
        })
        .from(leadCaptureForms)
        .where(eq(leadCaptureForms.slug, slug))
        .limit(1)
    )[0];
    if (!f) return null;
    const t = (
      await tx
        .select({
          displayName: tenants.displayName,
          primaryColor: tenants.primaryColor,
          logoUrl: tenants.logoUrl,
          arn: tenants.arn,
        })
        .from(tenants)
        .where(eq(tenants.id, f.tenantId))
        .limit(1)
    )[0];
    return { f, t };
  });

  if (!form?.f) {
    return NextResponse.json({ error: "form not found" }, { status: 404 });
  }
  if (!form.f.enabled) {
    return NextResponse.json({ error: "form retired" }, { status: 410 });
  }

  return NextResponse.json({
    form: {
      id: form.f.id,
      name: form.f.name,
      description: form.f.description,
      fields: form.f.fields ?? [],
      branding: form.f.branding ?? null,
    },
    tenant: form.t
      ? {
          displayName: form.t.displayName,
          primaryColor: form.t.primaryColor,
          logoUrl: form.t.logoUrl,
          arn: form.t.arn,
        }
      : null,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  // 5 submissions per IP per hour — abuse-control, can be overridden per
  // form via rate_limit_per_hour but we ignore that for now and use the
  // global default.
  const limited = enforce(req, `lead-form.submit.lookup.${slug}`, {
    limit: 60,
    windowSec: 60 * 60,
  });
  if (limited) return limited;

  const body = await req.json().catch(() => ({}));

  // Resolve form + tenant (system read).
  const form = await withSystem(async (tx) => {
    return (
      await tx.select().from(leadCaptureForms).where(eq(leadCaptureForms.slug, slug)).limit(1)
    )[0];
  });
  if (!form) return NextResponse.json({ error: "form not found" }, { status: 404 });
  if (!form.enabled) return NextResponse.json({ error: "form retired" }, { status: 410 });

  const perFormLimit = Math.max(1, Number.parseInt(String(form.rateLimitPerHour ?? "5"), 10) || 5);
  const formLimited = enforce(req, `lead-form.submit.${form.id}`, {
    limit: perFormLimit,
    windowSec: 60 * 60,
  });
  if (formLimited) return formLimited;

  // Validate the four universals — name + at least one of email/phone.
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const phone = String(body.phone ?? "").trim();
  const pan = normalizePan(body.pan);
  const notes = String(body.notes ?? "").trim();
  if (!name || (!email && !phone)) {
    return NextResponse.json(
      { error: "name + at least one of email/phone is required" },
      { status: 400 }
    );
  }
  // Honeypot — silently accept (200) without persisting if the bot
  // populated any of these. Returns the same shape as success so
  // scrapers don't learn we trapped them.
  if (body._gotcha || body.website || body.url) {
    return NextResponse.json({ ok: true, leadId: null });
  }

  // Required custom fields per the form definition.
  const fields = (form.fields ?? []) as Array<{
    key: string;
    label: string;
    required?: boolean;
  }>;
  const extras: Record<string, string> = {};
  for (const f of fields) {
    const v = body[f.key];
    if (f.required && (v === undefined || v === null || String(v).trim() === "")) {
      return NextResponse.json(
        { error: `${f.label} is required` },
        { status: 400 }
      );
    }
    if (v !== undefined && v !== null) extras[f.key] = String(v);
  }

  // Create the lead inside the form's tenant scope.
  const leadId = uuid();
  await withTenant(form.tenantId, async (tx) => {
    let rmId: string | null = form.defaultRmId ?? null;
    if (!rmId) {
      rmId = await pickRmForNewLead(tx, { strategy: "least_loaded" });
    }
    // Roll the extras into the notes field so they're visible to the RM
    // without needing a custom_fields column. Format: original notes
    // followed by a "Form responses" block.
    const composedNotes = [
      notes || "",
      Object.keys(extras).length
        ? "\n\n---\nForm responses:\n" +
          Object.entries(extras)
            .map(([k, v]) => `  ${k}: ${v}`)
            .join("\n")
        : "",
    ]
      .join("")
      .trim();

    // Deterministic initial score from the captured signals.
    const initialScore = scoreFields({
      source: normalizeLeadSource(form.leadSource),
      stage: "new",
      email: email || null,
      phone: phone || null,
      pan: pan ?? null,
    });

    await tx.execute(sql`
      INSERT INTO leads (
        id, tenant_id, name, email, email_normalized, phone, phone_normalized,
        pan, source, source_campaign, owner_id, stage, stage_changed_at,
        lead_score, score_band, scored_at,
        notes, created_at, updated_at
      ) VALUES (
        ${leadId}::uuid, ${form.tenantId}::uuid, ${name},
        ${email || null}, ${normalizeEmail(email)}, ${phone || null},
        ${normalizePhoneLast10(phone)}, ${pan},
        ${normalizeLeadSource(form.leadSource)}, ${form.sourceCampaign},
        ${rmId}::uuid,
        'new', now(),
        ${initialScore.leadScore}, ${initialScore.scoreBand}, now(),
        ${composedNotes || null},
        now(), now()
      )
    `);

    // Emit an event so workflow recipes (lead_welcome, lead_nurture_drip)
    // can pick it up exactly like a manually-created lead would.
    await tx.execute(sql`
      INSERT INTO events_outbox (
        tenant_id, kind, entity_type, entity_id, after, meta, occurred_at
      ) VALUES (
        ${form.tenantId}::uuid,
        'lead.created',
        'lead',
        ${leadId}::uuid,
        ${JSON.stringify({
          leadId,
          name,
          email: email || null,
          phone: phone || null,
          source: normalizeLeadSource(form.leadSource),
          source_campaign: form.sourceCampaign,
          form_slug: slug,
        })}::jsonb,
        ${JSON.stringify({ source: "public_lead_form", formId: form.id, formSlug: slug })}::jsonb,
        now()
      )
    `);
  });

  // Suppress unused-import warning (leads is needed for type-resolution
  // via the schema barrel — explicit reference keeps tree-shake from
  // dropping it during dev hot-reload).
  void leads;
  void and;

  return NextResponse.json({ ok: true, leadId });
}
