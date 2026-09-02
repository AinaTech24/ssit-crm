/**
 * Vartify template-sync worker.
 *
 * For EACH tenant that has connected Vartify, polls THAT firm's template list
 * (GET /whatsapp/templates with their own token) and mirrors each template's
 * Meta approval status into `whatsapp_templates`. When a template that already
 * passed internal approval (templates.status = 'pending_approval') is APPROVED
 * on Meta, we flip templates.status → 'approved' so the pipeline will send it.
 *
 * Per-tenant by construction: every MFD holds its own Vartify token, so there
 * is no shared workspace to read. The previous provider was a single operator-
 * owned workspace, and this worker fetched ONE list with the env key and copied
 * it into every tenant — which under per-tenant tokens would both fail (no env
 * key) and leak one firm's template names into every other firm's registry.
 *
 * A tenant with no Vartify integration is skipped silently — not an error.
 *
 * Runs every 15 minutes (WORKER_GROUPS includes "wa_sync").
 */

import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { getTenantIntegration } from "@/lib/comms/integrations";
import { fetchVartifyTemplatesDetailed } from "@/lib/comms/adapters/vartify";

export async function syncAllTenants(): Promise<{ tenants: number; updated: number }> {
  let updated = 0;
  let synced = 0;

  const tenants = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT id FROM tenants WHERE status NOT IN ('churned', 'suspended')
    `);
    return r.rows as Array<{ id: string }>;
  });

  for (const t of tenants) {
    // This firm's OWN Vartify token. No integration → nothing to sync.
    const integ = await withTenant(t.id, async (tx) =>
      getTenantIntegration(tx, t.id, "vartify").catch(() => null)
    );
    const apiKey = (integ?.config as any)?.apiKey as string | undefined;
    if (!integ?.isActive || !apiKey) continue;

    // ?status=all — a PENDING/REJECTED template must be mirrored too, otherwise
    // its status can never move in the registry.
    const fetched = await fetchVartifyTemplatesDetailed({
      apiKey,
      baseUrl: (integ?.config as any)?.webhookUrl,
      status: "all",
    });
    if (!fetched.ok) {
      // One firm's bad token must not stop the rest of the sweep.
      console.warn(`[vartify-template-sync] tenant ${t.id}: ${fetched.error}`);
      continue;
    }
    const metaTemplates = fetched.templates;
    if (!metaTemplates.length) continue;
    synced++;

    await withSystem(async (tx) => {
      for (const meta of metaTemplates as Array<any>) {
        const name = meta.name ?? meta.template_name;
        if (!name) continue;
        await tx.execute(sql`
          INSERT INTO whatsapp_templates
            (id, tenant_id, template_id, meta_template_name, meta_language, category, meta_status,
             meta_rejection_reason, components, last_synced_at, created_at, updated_at)
          VALUES (
            gen_random_uuid(), ${t.id},
            (SELECT id FROM templates WHERE tenant_id = ${t.id} AND channel = 'whatsapp' AND key = ${name} LIMIT 1),
            ${name}, ${meta.language ?? "en"},
            ${(meta.category ?? "UTILITY").toString().toUpperCase()},
            ${(meta.status ?? "PENDING").toString().toUpperCase()},
            ${meta.rejected_reason ?? meta.rejection_reason ?? null},
            ${JSON.stringify(meta.components ?? [])}::jsonb,
            now(), now(), now()
          )
          ON CONFLICT (tenant_id, meta_template_name, meta_language) DO UPDATE
          SET meta_status = EXCLUDED.meta_status,
              meta_rejection_reason = EXCLUDED.meta_rejection_reason,
              components = EXCLUDED.components,
              template_id = COALESCE(whatsapp_templates.template_id, EXCLUDED.template_id),
              last_synced_at = now(),
              updated_at = now()
        `);
      }

      // Promote internally-approved WhatsApp templates that Meta has now approved.
      const res = await tx.execute(sql`
        UPDATE templates SET status = 'approved', updated_at = now()
        WHERE tenant_id = ${t.id} AND channel = 'whatsapp' AND status = 'pending_approval'
          AND key IN (
            SELECT meta_template_name FROM whatsapp_templates
            WHERE tenant_id = ${t.id} AND meta_status = 'APPROVED'
          )
      `);
      updated += (res as any).rowCount ?? 0;
    });
  }

  return { tenants: synced, updated };
}

export function startVartifyTemplateSyncWorker(): () => void {
  const INTERVAL = 15 * 60 * 1000;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { tenants, updated } = await syncAllTenants();
      if (tenants || updated) console.log(`[vartify-template-sync] tenants=${tenants} promoted=${updated}`);
    } catch (err) {
      console.error("[vartify-template-sync] failed:", err);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, INTERVAL);
  const kickoff = setTimeout(tick, 5000);
  return () => {
    clearInterval(timer);
    clearTimeout(kickoff);
  };
}
