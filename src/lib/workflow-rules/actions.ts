/**
 * Action handlers for Workflow Rules.
 *
 * Each handler is a small function: (action.config, ctx) → ActionResult.
 * We deliberately keep the handlers thin and reuse existing infrastructure:
 *   - send_email / send_whatsapp / send_sms — `dispatch()` from comms/pipeline
 *   - create_task — direct insert into `tasks`
 *   - update_field — UPDATE against the module's table
 *   - create_notification — insert into `notifications` table
 *   - webhook — outbound HTTP via fetch
 *   - schedule_meeting — insert into review_meetings
 *   - schedule_call — task with type='call'
 *   - convert_lead — re-uses /api/leads/[id]/convert flow
 *   - create_record — generic insert into another module's table
 *   - custom_function — runs a server-saved function (stub for now)
 *   - add_tag / remove_tag — appends/removes from a `tags` jsonb array
 */

import crypto from "node:crypto";
import { sql, eq, and } from "drizzle-orm";
import { getModule } from "./modules";
import type { Action } from "./types";
import {
  tasks,
  notifications,
  reviewMeetings,
  leads,
  investors,
  eventsOutbox,
  proposals,
  communications,
  shareTokens,
} from "@/db/schema";
import { v4 as uuid } from "uuid";
import { autoAdvance } from "@/lib/blueprints/auto-advance";
import { renderTemplateText } from "@/lib/comms/tokens";

export interface ActionContext {
  tenantId: string;
  subjectType: string;
  subjectId: string;
  record: Record<string, unknown>;
  tx: any;
}

export interface ActionResult {
  type: string;
  status: "succeeded" | "failed" | "skipped";
  detail?: string;
  externalId?: string;
  error?: string;
}

export async function executeAction(action: Action, ctx: ActionContext): Promise<ActionResult> {
  switch (action.type) {
    case "send_email":
      return runSendEmail(action.config, ctx);
    case "send_whatsapp":
      return runSendWhatsApp(action.config, ctx);
    case "send_sms":
      return runSendSms(action.config, ctx);
    case "create_task":
      return runCreateTask(action.config, ctx);
    case "schedule_meeting":
      return runScheduleMeeting(action.config, ctx);
    case "schedule_call":
      return runScheduleCall(action.config, ctx);
    case "update_field":
      return runUpdateField(action.config, ctx);
    case "add_tag":
      return runTagOp("add", action.config, ctx);
    case "remove_tag":
      return runTagOp("remove", action.config, ctx);
    case "webhook":
      return runWebhook(action.config, ctx);
    case "custom_function":
      return runCustomFunction(action.config, ctx);
    case "create_record":
      return runCreateRecord(action.config, ctx);
    case "convert_lead":
      return runConvertLead(action.config, ctx);
    case "create_notification":
      return runCreateNotification(action.config, ctx);
    default:
      return { type: action.type, status: "skipped", detail: "unknown action type" };
  }
}

// ---------------------------------------------------------------------------
// Comms (delegate to existing comms pipeline via dynamic import)
// ---------------------------------------------------------------------------

type CommChannel = "email" | "whatsapp" | "sms";
type ResolvedTarget =
  | { ok: true; recipient: string; investorId?: string; leadId?: string; extraVars: Record<string, string> }
  | { ok: false; reason: string };

/**
 * Resolve WHO a comms action sends to.
 *   "subject"  (default) — the record that fired the rule (its own email/phone)
 *   "referrer"           — the client who referred this lead (lead.referred_by_
 *                          investor_id → that investor's contact). The message
 *                          is logged against the REFERRER (investorId), so
 *                          consent + compliance apply to them, and the new
 *                          lead's name is exposed as {{referred_lead_name}}.
 */
async function resolveCommTarget(
  ctx: ActionContext,
  config: Record<string, unknown>,
  channel: CommChannel
): Promise<ResolvedTarget> {
  const rec = ctx.record as {
    email?: string | null;
    phone?: string | null;
    whatsapp_phone?: string | null;
    name?: string | null;
  };
  const pickContact = (r: { email?: string | null; phone?: string | null; whatsapp_phone?: string | null }) =>
    channel === "email" ? r.email : channel === "whatsapp" ? r.whatsapp_phone ?? r.phone : r.phone;

  const sendTo = String(config.recipient ?? "subject");

  if (sendTo === "referrer") {
    if (ctx.subjectType !== "lead") {
      return { ok: false, reason: "'Send to referring client' only applies to Lead rules." };
    }
    const leadRow = (
      await ctx.tx.execute(
        sql`SELECT referred_by_investor_id FROM leads WHERE id = ${ctx.subjectId}::uuid AND tenant_id = ${ctx.tenantId}::uuid LIMIT 1`
      )
    ).rows[0] as { referred_by_investor_id?: string | null } | undefined;
    const refId = leadRow?.referred_by_investor_id;
    if (!refId) return { ok: false, reason: "This lead has no linked referring client." };

    const inv = (
      await ctx.tx.execute(
        sql`SELECT id, email, phone, whatsapp_phone, name FROM investors WHERE id = ${refId}::uuid AND tenant_id = ${ctx.tenantId}::uuid LIMIT 1`
      )
    ).rows[0] as
      | { id: string; email?: string | null; phone?: string | null; whatsapp_phone?: string | null; name?: string | null }
      | undefined;
    if (!inv) return { ok: false, reason: "Referring client record not found." };

    const contact = pickContact(inv);
    if (!contact) return { ok: false, reason: `Referring client has no ${channel} contact on file.` };
    return {
      ok: true,
      recipient: String(contact),
      investorId: inv.id,
      leadId: undefined,
      extraVars: { referred_lead_name: String(rec?.name ?? "") },
    };
  }

  // Default: the triggering record itself.
  let contact = pickContact(rec);
  let investorId = ctx.subjectType === "investor" ? ctx.subjectId : undefined;
  const leadId = ctx.subjectType === "lead" ? ctx.subjectId : undefined;

  // Records like SIPs / transactions / goals carry no contact of their own but
  // reference an investor — resolve the client's contact so reminders (e.g. a
  // SIP-due nudge keyed on next_installment_at) actually reach the client.
  if (!contact && ctx.subjectType !== "investor") {
    const invId = (rec as { investor_id?: string | null; investorId?: string | null }).investor_id
      ?? (rec as { investor_id?: string | null; investorId?: string | null }).investorId;
    if (invId) {
      const inv = (
        await ctx.tx.execute(
          sql`SELECT id, email, phone, whatsapp_phone FROM investors WHERE id = ${invId}::uuid AND tenant_id = ${ctx.tenantId}::uuid LIMIT 1`
        )
      ).rows[0] as { id: string; email?: string | null; phone?: string | null; whatsapp_phone?: string | null } | undefined;
      if (inv) {
        contact = pickContact(inv);
        investorId = inv.id;
      }
    }
  }

  if (!contact) return { ok: false, reason: `No ${channel} contact on file for this record.` };
  return { ok: true, recipient: String(contact), investorId, leadId, extraVars: await enrichmentVars(ctx) };
}

/**
 * Derived tokens many reminder/confirmation templates want but that aren't raw
 * record columns: the owning user's NAME (rm_id / owner_id / assignee), and a
 * human-readable meeting time. Best-effort — missing values just don't render.
 */
async function enrichmentVars(ctx: ActionContext): Promise<Record<string, string>> {
  const rec = ctx.record as {
    rm_id?: string | null; owner_id?: string | null; assigned_to_user_id?: string | null; assignee_id?: string | null;
    meeting_date?: string | null; meeting_mode?: string | null; location_or_link?: string | null;
  };
  const out: Record<string, string> = {};
  const uid = rec.rm_id ?? rec.owner_id ?? rec.assigned_to_user_id ?? rec.assignee_id;
  if (uid) {
    const u = (
      await ctx.tx.execute(sql`SELECT name FROM users WHERE id = ${uid}::uuid AND tenant_id = ${ctx.tenantId}::uuid LIMIT 1`)
    ).rows[0] as { name?: string | null } | undefined;
    if (u?.name) {
      out.rm_name = u.name;
      out.advisor_name = u.name;
    }
  }
  if (rec.meeting_date) {
    const d = new Date(rec.meeting_date);
    if (!isNaN(d.getTime())) {
      out.meeting_when = d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
    }
  }
  // Online meetings carry a join link the client needs. {{meeting_join}} is a
  // ready-made line that's blank for offline meetings / when no link was pasted,
  // so templates can include it unconditionally.
  const link = String(rec.location_or_link ?? "").trim();
  if (rec.meeting_mode === "online" && link) {
    out.meeting_link = link;
    out.meeting_join = `Join online: ${link}`;
  } else {
    out.meeting_link = "";
    out.meeting_join = "";
  }
  return out;
}

/**
 * Expose the triggering record's scalar fields as template tokens so a template
 * can render {{name}}, {{referred_by_name}}, {{scheme_name}}, {{amount}}, etc.
 * directly from the record that fired the rule. Objects/arrays are skipped;
 * caller-supplied config.variables still take priority over these.
 */
function scalarVars(record: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record ?? {})) {
    if (v == null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = String(v);
    }
  }
  return out;
}

/** Format the structured AI meeting summary into a readable minutes block. */
function formatMinutes(m: {
  summary: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: Array<{ title: string; owner?: string; dueHint?: string }>;
  nextSteps: string[];
}): string {
  const out: string[] = [];
  if (m.summary) out.push(m.summary, "");
  if (m.keyPoints.length) { out.push("Key points:"); m.keyPoints.forEach((k) => out.push(`• ${k}`)); out.push(""); }
  if (m.decisions.length) { out.push("Decisions:"); m.decisions.forEach((d) => out.push(`• ${d}`)); out.push(""); }
  if (m.actionItems.length) {
    out.push("Action items:");
    m.actionItems.forEach((a) => out.push(`• ${a.title}${a.owner ? ` (${a.owner})` : ""}${a.dueHint ? ` — ${a.dueHint}` : ""}`));
    out.push("");
  }
  if (m.nextSteps.length) { out.push("Next steps:"); m.nextSteps.forEach((s) => out.push(`• ${s}`)); }
  return out.join("\n").trim();
}

/**
 * Optional AI minutes-of-meeting. When the email action sets config.aiMinutesFrom
 * (a record field, e.g. "discussion_points"), rewrite that text via Claude into
 * polished minutes and expose them as {{minutes}}. Returns:
 *   { kind: "none" } — not configured, send normally
 *   { kind: "ok" }   — minutes generated
 *   { kind: "skip" } — configured but nothing to summarise / AI failed → skip send
 */
async function maybeAiMinutes(
  config: Record<string, unknown>,
  ctx: ActionContext
): Promise<{ kind: "none" } | { kind: "ok"; minutes: string } | { kind: "skip"; reason: string }> {
  const field = typeof config.aiMinutesFrom === "string" ? config.aiMinutesFrom : "";
  if (!field) return { kind: "none" };
  const rec = ctx.record as Record<string, unknown>;
  const source = String(rec[field] ?? "").trim();
  if (!source) return { kind: "skip", reason: "No agenda/discussion points to summarise." };
  try {
    const { summariseMeeting } = await import("@/lib/ai/assistant");
    const extra = [rec.meeting_notes, rec.outcome_notes].map((v) => (v ? String(v) : "")).filter(Boolean).join("\n\n");
    const mom = await summariseMeeting({
      notes: [source, extra].filter(Boolean).join("\n\n"),
      agenda: source,
      meetingType: rec.meeting_type ? String(rec.meeting_type) : undefined,
      durationMinutes: Number(rec.duration_minutes) || undefined,
    });
    if ("error" in mom) return { kind: "skip", reason: `AI summary failed: ${mom.error}` };
    return { kind: "ok", minutes: formatMinutes(mom) };
  } catch (e: any) {
    return { kind: "skip", reason: `AI summary failed: ${e?.message ?? "error"}` };
  }
}

/** Public-form path per share-token kind (mirrors share-tokens/index.ts). */
const SHARE_PATHS: Record<string, string> = {
  risk_profile: "/r",
  document_collection: "/d",
  proposal_approval: "/p",
  onboarding_progress: "/onboarding",
  portfolio_view: "/portfolio",
  feedback: "/f",
};

/**
 * Optional single-use public form link. When the email action sets
 * config.shareLink (e.g. "risk_profile"), mint a share token for the subject and
 * expose it as {{share_link}} and {{<kind>_link}} (e.g. {{risk_profile_link}}).
 * Minted on the action's own tx so it's tied to the send. Only leads/investors
 * can be a share-token subject.
 */
async function maybeShareLink(config: Record<string, unknown>, ctx: ActionContext): Promise<Record<string, string>> {
  const kind = typeof config.shareLink === "string" ? config.shareLink : "";
  if (!kind || !SHARE_PATHS[kind]) return {};
  const subjectType = ctx.subjectType === "investor" ? "investor" : ctx.subjectType === "lead" ? "lead" : null;
  if (!subjectType) return {};

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  await ctx.tx.insert(shareTokens).values({
    tenantId: ctx.tenantId,
    kind,
    tokenHash,
    subjectType,
    subjectId: ctx.subjectId,
    expiresAt,
  } as any);

  const base = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const url = `${base}${SHARE_PATHS[kind]}/${token}`;
  return { share_link: url, [`${kind}_link`]: url };
}

async function runSendEmail(config: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult> {
  try {
    const { dispatch } = await import("@/lib/comms/pipeline");
    const target = await resolveCommTarget(ctx, config, "email");
    if (!target.ok) return { type: "send_email", status: "skipped", detail: target.reason };

    // Optional single-use public form link → {{risk_profile_link}} etc.
    const linkVars = await maybeShareLink(config, ctx);

    // Optional AI minutes-of-meeting → {{minutes}}.
    const ai = await maybeAiMinutes(config, ctx);
    if (ai.kind === "skip") return { type: "send_email", status: "skipped", detail: ai.reason };
    const aiVars = ai.kind === "ok" ? { minutes: ai.minutes } : {};
    // "Send from": record_owner → the client's RM mailbox (resolveEmailSender
    // prefers the acting user's own mailbox, falling back to the firm mailbox).
    const actorUserId =
      config.fromAddress === "record_owner" && ctx.subjectType === "investor"
        ? ((ctx.record as { rm_id?: string | null })?.rm_id ?? undefined)
        : undefined;
    const res = await dispatch(ctx.tx, {
      tenantId: ctx.tenantId,
      channel: "email",
      templateKey: String(config.templateKey ?? config.template ?? ""),
      recipient: target.recipient,
      variables: { ...scalarVars(ctx.record), ...linkVars, ...((config.variables ?? {}) as Record<string, string>), ...target.extraVars, ...aiVars },
      category: (config.category ?? "transactional") as any,
      investorId: target.investorId,
      leadId: target.leadId,
      actorUserId,
    });
    return { type: "send_email", status: res.status === "skipped" ? "skipped" : "succeeded", externalId: res.externalId, detail: res.skipped?.reason };
  } catch (e: any) {
    return { type: "send_email", status: "failed", error: e?.message ?? String(e) };
  }
}

async function runSendWhatsApp(config: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult> {
  try {
    const { dispatch } = await import("@/lib/comms/pipeline");
    const target = await resolveCommTarget(ctx, config, "whatsapp");
    if (!target.ok) return { type: "send_whatsapp", status: "skipped", detail: target.reason };
    const res = await dispatch(ctx.tx, {
      tenantId: ctx.tenantId,
      channel: "whatsapp",
      templateKey: String(config.templateKey ?? config.template ?? ""),
      recipient: target.recipient,
      variables: { ...scalarVars(ctx.record), ...((config.variables ?? {}) as Record<string, string>), ...target.extraVars },
      category: (config.category ?? "transactional") as any,
      investorId: target.investorId,
      leadId: target.leadId,
    });
    return { type: "send_whatsapp", status: res.status === "skipped" ? "skipped" : "succeeded", externalId: res.externalId, detail: res.skipped?.reason };
  } catch (e: any) {
    return { type: "send_whatsapp", status: "failed", error: e?.message ?? String(e) };
  }
}

async function runSendSms(config: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult> {
  try {
    const { dispatch } = await import("@/lib/comms/pipeline");
    const target = await resolveCommTarget(ctx, config, "sms");
    if (!target.ok) return { type: "send_sms", status: "skipped", detail: target.reason };
    const res = await dispatch(ctx.tx, {
      tenantId: ctx.tenantId,
      channel: "sms",
      templateKey: String(config.templateKey ?? config.template ?? ""),
      recipient: target.recipient,
      variables: { ...scalarVars(ctx.record), ...((config.variables ?? {}) as Record<string, string>), ...target.extraVars },
      category: (config.category ?? "transactional") as any,
      investorId: target.investorId,
      leadId: target.leadId,
    });
    return { type: "send_sms", status: res.status === "skipped" ? "skipped" : "succeeded", externalId: res.externalId, detail: res.skipped?.reason };
  } catch (e: any) {
    return { type: "send_sms", status: "failed", error: e?.message ?? String(e) };
  }
}

// ---------------------------------------------------------------------------
// Task / Meeting / Call
// ---------------------------------------------------------------------------

async function runCreateTask(_config: Record<string, unknown>, _ctx: ActionContext): Promise<ActionResult> {
  // Automated task creation via workflow rules is disabled per firm preference
  // ("turn off all auto tasks"). Restore the body (git history) to re-enable.
  return { type: "create_task", status: "skipped", detail: "auto task creation disabled" };
}

async function runScheduleMeeting(config: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult> {
  const dateOffset = (config.dateOffset as { amount?: number; unit?: string } | undefined) ?? undefined;
  const meetingDate = dateOffset
    ? offsetDate(dateOffset.amount ?? 3, (dateOffset.unit as any) ?? "day")
    : offsetDate(3, "day");

  if (ctx.subjectType !== "investor") {
    return { type: "schedule_meeting", status: "skipped", detail: "subject is not an investor" };
  }

  const inserted = await ctx.tx
    .insert(reviewMeetings)
    .values({
      tenantId: ctx.tenantId,
      investorId: ctx.subjectId,
      category: (config.category as any) ?? "review",
      meetingType: (config.meetingType as any) ?? "portfolio_review",
      meetingDate,
      durationMinutes: Number(config.durationMinutes ?? 30),
      meetingMode: (config.mode as any) ?? "online",
      status: "scheduled",
    })
    .returning({ id: reviewMeetings.id });
  return { type: "schedule_meeting", status: "succeeded", externalId: inserted[0]?.id };
}

async function runScheduleCall(config: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult> {
  return runCreateTask({ ...config, taskType: "call", title: config.title ?? "Call client" }, ctx);
}

// ---------------------------------------------------------------------------
// Field update
// ---------------------------------------------------------------------------

async function runUpdateField(config: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult> {
  const updates = (config.updates as Record<string, unknown> | undefined) ?? {};
  if (!Object.keys(updates).length) {
    return { type: "update_field", status: "skipped", detail: "no updates" };
  }

  // Determine table from subjectType
  const moduleKey = subjectTypeToModule(ctx.subjectType);
  const mod = moduleKey ? getModule(moduleKey) : undefined;
  if (!mod) {
    return { type: "update_field", status: "failed", error: `unknown module for ${ctx.subjectType}` };
  }

  // Build SET clause safely from catalog-defined writable fields
  const setParts: any[] = [];
  for (const [k, v] of Object.entries(updates)) {
    const field = mod.fields.find((f) => f.key === k);
    if (!field?.writable) continue;
    setParts.push(sql`${sql.identifier(k)} = ${v}`);
  }
  if (!setParts.length) {
    return { type: "update_field", status: "skipped", detail: "no writable fields in updates" };
  }
  setParts.push(sql`updated_at = now()`);

  await ctx.tx.execute(
    sql`UPDATE ${sql.identifier(mod.table)} SET ${sql.join(setParts, sql`, `)} WHERE id = ${ctx.subjectId} AND tenant_id = ${ctx.tenantId}::uuid`
  );
  return { type: "update_field", status: "succeeded" };
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

async function runTagOp(op: "add" | "remove", config: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult> {
  const tag = String(config.tag ?? "").trim();
  if (!tag) return { type: `${op}_tag`, status: "skipped", detail: "no tag provided" };

  const moduleKey = subjectTypeToModule(ctx.subjectType);
  const mod = moduleKey ? getModule(moduleKey) : undefined;
  if (!mod) return { type: `${op}_tag`, status: "failed", error: `unknown module for ${ctx.subjectType}` };

  const tagsExpr =
    op === "add"
      ? sql`COALESCE(tags, '[]'::jsonb) || ${JSON.stringify([tag])}::jsonb`
      : sql`COALESCE((SELECT jsonb_agg(elem) FROM jsonb_array_elements_text(tags) elem WHERE elem <> ${tag}), '[]'::jsonb)`;

  try {
    await ctx.tx.execute(
      sql`UPDATE ${sql.identifier(mod.table)} SET tags = ${tagsExpr}, updated_at = now() WHERE id = ${ctx.subjectId} AND tenant_id = ${ctx.tenantId}::uuid`
    );
    return { type: `${op}_tag`, status: "succeeded" };
  } catch (e: any) {
    return { type: `${op}_tag`, status: "failed", error: e?.message ?? String(e) };
  }
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * Conservative SSRF guard for tenant-authored webhook URLs.
 *
 * Blocks the obvious internal targets — loopback, private RFC-1918 ranges,
 * link-local (incl. the 169.254.169.254 cloud-metadata endpoint) and non-HTTP
 * schemes — so a rule can't be pointed at our own infra. It inspects the
 * literal host only (no DNS resolution), so it is NOT a complete SSRF defense;
 * pair it with network-egress controls in production. Returns a reason string
 * when the URL should be blocked, or null when it's allowed.
 */
function unsafeWebhookUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "invalid URL";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return `unsupported protocol "${u.protocol}"`;
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "::1" || host === "::") {
    return "host is loopback/unspecified";
  }
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      return "host is a private/loopback/link-local IP";
    }
  }
  if (/^f[cd][0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) {
    return "host is a private/link-local IPv6 address";
  }
  return null;
}

async function runWebhook(config: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult> {
  const url = String(config.url ?? "");
  if (!url) return { type: "webhook", status: "skipped", detail: "no url" };
  const unsafe = unsafeWebhookUrl(url);
  if (unsafe) return { type: "webhook", status: "failed", error: `Blocked webhook URL (${unsafe})` };

  const method = String(config.method ?? "POST").toUpperCase();
  const headers = (config.headers as Record<string, string>) ?? {};
  const body = {
    tenantId: ctx.tenantId,
    subjectType: ctx.subjectType,
    subjectId: ctx.subjectId,
    record: ctx.record,
    extra: config.body ?? null,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(body),
      signal: controller.signal,
      // Don't auto-follow redirects — a 3xx to an internal host would bypass
      // the SSRF guard above.
      redirect: "manual",
    });
    return { type: "webhook", status: r.ok ? "succeeded" : "failed", detail: `HTTP ${r.status}` };
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? `timed out after ${WEBHOOK_TIMEOUT_MS}ms` : e?.message ?? String(e);
    return { type: "webhook", status: "failed", error: msg };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Custom function (stub — Phase 2 will be a sandboxed Deluge-like runtime)
// ---------------------------------------------------------------------------

async function runCustomFunction(_config: Record<string, unknown>, _ctx: ActionContext): Promise<ActionResult> {
  return {
    type: "custom_function",
    status: "skipped",
    detail: "Custom functions require an admin to publish a function first. Use Webhook for now.",
  };
}

// ---------------------------------------------------------------------------
// Record creation / lead conversion
// ---------------------------------------------------------------------------

async function runCreateRecord(_config: Record<string, unknown>, _ctx: ActionContext): Promise<ActionResult> {
  return {
    type: "create_record",
    status: "skipped",
    detail: "create_record handler is Phase 2 — use webhook + UI for now.",
  };
}

async function runConvertLead(config: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult> {
  if (ctx.subjectType !== "lead") {
    return { type: "convert_lead", status: "skipped", detail: "subject is not a lead" };
  }

  const tx = ctx.tx;
  const leadId = ctx.subjectId;
  const tenantId = ctx.tenantId;

  try {
    const lead = (await tx.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId))).limit(1))[0];
    if (!lead) {
      return { type: "convert_lead", status: "failed", error: "lead not found" };
    }

    if (lead.convertedInvestorId) {
      return {
        type: "convert_lead",
        status: "skipped",
        detail: "lead already converted",
        externalId: lead.convertedInvestorId,
      };
    }

    // Determine PAN (pan is notNull in investors schema). We must NOT invent a
    // placeholder — a fake PAN on a real investor record corrupts KYC, breaks
    // RTA/BSE submission, and is a compliance violation. If no real PAN can be
    // sourced, skip the conversion and surface why so a human can fix it.
    let pan = (config?.pan as string | undefined) ?? (ctx.record?.pan as string | undefined);
    if (!pan && typeof lead.notes === "string") {
      const match = lead.notes.match(/[A-Z]{5}[0-9]{4}[A-Z]/i);
      if (match) pan = match[0].toUpperCase();
    }
    if (!pan || !/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(pan)) {
      return {
        type: "convert_lead",
        status: "skipped",
        detail:
          "Lead has no valid PAN — cannot auto-convert to a client. Add the PAN on the lead (or in the rule's action config) and retry.",
      };
    }

    const investorId = uuid();

    // 1. Create investor
    const inserted = await tx
      .insert(investors)
      .values({
        id: investorId,
        tenantId,
        branchId: lead.branchId,
        name: lead.name,
        pan: pan.toUpperCase(),
        email: lead.email,
        phone: lead.phone,
        whatsappPhone: lead.phone,
        address: lead.city ? ({ city: lead.city, country: "India" } as any) : null,
        segmentTag: (config?.segmentTag as any) ?? "Retail",
        investorCategory: (config?.investorCategory as any) ?? "individual",
        // Same carryover as the manual /api/leads/[id]/convert route — see
        // that file for why this matters.
        referralClientName: lead.referredByName ?? null,
        rmId: lead.ownerId,
        status: "active",
        onboardedAt: new Date(),
        notes: lead.notes ?? null,
        kycStatus: "pending",
      } as any)
      .returning();

    // 2. Stamp lead
    await tx
      .update(leads)
      .set({
        stage: "converted",
        stageChangedAt: new Date(),
        convertedInvestorId: investorId,
        convertedAt: new Date(),
        updatedAt: new Date(),
      } as any)
      .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)));

    // ─── DATA CARRYOVER ──────────────────────────────────────────────
    // 1. Risk profile responses
    const carriedRpr = await tx.execute(sql`
      UPDATE risk_profile_responses
         SET investor_id = ${investorId}::uuid,
             updated_at = now()
       WHERE tenant_id = ${tenantId}::uuid
         AND investor_id = ${leadId}::uuid
      RETURNING id, final_category, total_score, signed_at
    `);
    const latestRisk = (carriedRpr.rows as any[])[0];
    if (latestRisk) {
      const signedAt = latestRisk.signed_at ? new Date(latestRisk.signed_at) : null;
      await tx
        .update(investors)
        .set({
          riskProfile: latestRisk.final_category as any,
          riskProfileScore: Number(latestRisk.total_score),
          riskProfileSignedAt: signedAt,
          updatedAt: new Date(),
        } as any)
        .where(eq(investors.id, investorId));
    }

    // 2. Proposals
    await tx
      .update(proposals)
      .set({ investorId, recipientType: "investor" as any, updatedAt: new Date() } as any)
      .where(and(eq(proposals.leadId, leadId), eq(proposals.tenantId, tenantId)));

    // 3. Compliance documents
    await tx.execute(sql`
      UPDATE compliance_documents
         SET related_entity_type = 'investor',
             related_entity_id = ${investorId}::uuid,
             updated_at = now()
       WHERE tenant_id = ${tenantId}::uuid
         AND related_entity_type = 'lead'
         AND related_entity_id = ${leadId}::uuid
    `);

    // 4. Communications
    await tx
      .update(communications)
      .set({ investorId, updatedAt: new Date() } as any)
      .where(and(eq(communications.leadId, leadId), eq(communications.tenantId, tenantId)));

    // 5. Meetings
    await tx.execute(sql`
      UPDATE review_meetings
         SET investor_id = ${investorId}::uuid,
             updated_at = now()
       WHERE tenant_id = ${tenantId}::uuid
         AND investor_id = ${leadId}::uuid
    `);

    // 6. Open share tokens
    await tx.execute(sql`
      UPDATE share_tokens
         SET subject_type = 'investor',
             subject_id = ${investorId}::uuid,
             updated_at = now()
       WHERE tenant_id = ${tenantId}::uuid
         AND subject_type = 'lead'
         AND subject_id = ${leadId}::uuid
         AND used_at IS NULL
    `);

    // 3. Emit outbox events
    const investorSnapshot = JSON.parse(JSON.stringify(inserted[0] ?? {}));
    await tx.insert(eventsOutbox).values([
      {
        tenantId,
        kind: "lead.converted",
        entityType: "lead",
        entityId: leadId,
        after: { investorId } as any,
        meta: { source: "workflow_rule" } as any,
      },
      {
        tenantId,
        kind: "investor.created",
        entityType: "investor",
        entityId: investorId,
        after: investorSnapshot as any,
        meta: { source: "workflow_rule", leadId } as any,
      },
    ] as any);

    // 4. Blueprint onboarding auto-advance
    await autoAdvance(tx, tenantId, leadId, "client.converted", {
      remarks: "Lead converted to client by workflow rule automation — entering onboarding phase.",
    });

    return {
      type: "convert_lead",
      status: "succeeded",
      externalId: investorId,
      detail: `Lead converted to Client. Created investor record ${investorId}.`,
    };
  } catch (err: any) {
    return {
      type: "convert_lead",
      status: "failed",
      error: err.message ?? String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// In-app notification
// ---------------------------------------------------------------------------

/**
 * Dashboard route per module — lets a notification deep-link straight to the
 * record that fired the rule. Modules without a detail page are simply absent,
 * and the notification then carries no link.
 */
const MODULE_ROUTES: Record<string, { path: string; detail: boolean }> = {
  investors: { path: "/dashboard/investors", detail: true },
  leads: { path: "/dashboard/leads", detail: true },
  families: { path: "/dashboard/families", detail: true },
  service_requests: { path: "/dashboard/service-requests", detail: true },
  review_meetings: { path: "/dashboard/review-meetings", detail: true },
  proposals: { path: "/dashboard/proposals", detail: true },
  insurance: { path: "/dashboard/insurance", detail: true },
  campaigns: { path: "/dashboard/campaigns", detail: true },
  goals: { path: "/dashboard/goals", detail: true },
  onboarding: { path: "/dashboard/onboarding", detail: true },
  business_entries: { path: "/dashboard/business-entries", detail: true },
  // No detail page — link to the list so the bell still lands somewhere useful.
  tasks: { path: "/dashboard/tasks", detail: false },
  transactions: { path: "/dashboard/transactions", detail: false },
  sips: { path: "/dashboard/sips", detail: false },
  sip_rejections: { path: "/dashboard/sip-rejections", detail: false },
  complaints: { path: "/dashboard/complaints", detail: false },
  risk_profiles: { path: "/dashboard/risk-profiles", detail: false },
};

/**
 * Human label for the record that fired the rule. The client / lead name is the
 * only thing an RM actually recognises in the bell, so we dig for it across the
 * name-ish columns the different module tables use. Returns "" when the module
 * genuinely has no name (then the notification just reads as before).
 */
function subjectDisplayName(record: Record<string, unknown>): string {
  const pick = (k: string) => {
    const v = record[k];
    return typeof v === "string" && v.trim() ? v.trim() : "";
  };
  const direct =
    pick("name") ||
    pick("full_name") ||
    pick("investor_name") ||
    pick("client_name") ||
    pick("lead_name") ||
    pick("title") ||
    pick("subject") ||
    pick("scheme_name");
  if (direct) return direct;
  return [pick("first_name"), pick("last_name")].filter(Boolean).join(" ");
}

async function runCreateNotification(config: Record<string, unknown>, ctx: ActionContext): Promise<ActionResult> {
  // Audience: { users: string[], roles: string[], subjectRm: boolean }
  const aud = (config.audience as { users?: string[]; roles?: string[]; subjectRm?: boolean }) ?? {};
  const ids = new Set<string>();
  for (const u of aud.users ?? []) if (u) ids.add(String(u));

  // subjectRm — the record's own RM / owner / assignee, whichever the module has.
  if (aud.subjectRm) {
    const owner =
      ctx.record.rm_id ?? ctx.record.owner_id ?? ctx.record.assigned_to_user_id ?? ctx.record.assignee_id;
    if (owner) ids.add(String(owner));
  }

  // roles audience — accepted by the config shape but never honoured before.
  const roles = (aud.roles ?? []).filter(Boolean).map(String);
  if (roles.length) {
    const roleRows = await ctx.tx.execute(sql`
      SELECT id FROM users
       WHERE tenant_id = ${ctx.tenantId}::uuid
         AND deleted_at IS NULL
         AND status = 'active'
         AND roles && ARRAY[${sql.join(roles.map((r) => sql`${r}`), sql`, `)}]::text[]
    `);
    for (const row of roleRows.rows as Array<{ id: string }>) ids.add(String(row.id));
  }

  // An alert nobody receives is a silent failure — the commonest cause is
  // "notify subject's RM" on a record with no RM assigned. Fall back to the
  // firm owners so the rule still surfaces somewhere.
  let fellBack = false;
  if (!ids.size) {
    const ownerRows = await ctx.tx.execute(sql`
      SELECT id FROM users
       WHERE tenant_id = ${ctx.tenantId}::uuid
         AND deleted_at IS NULL
         AND status = 'active'
         AND 'owner' = ANY(roles)
       LIMIT 5
    `);
    for (const row of ownerRows.rows as Array<{ id: string }>) ids.add(String(row.id));
    fellBack = ids.size > 0;
  }

  if (!ids.size) {
    return { type: "create_notification", status: "skipped", detail: "no recipients" };
  }

  // Merge fields — the same {{token}} vocabulary the send_* actions use, so a
  // rule author can write "SIP rejected for {{name}}" and get the client name.
  const name = subjectDisplayName(ctx.record);
  const tokens: Record<string, string> = { ...scalarVars(ctx.record), ...(await enrichmentVars(ctx)) };
  if (name) {
    tokens.client_name = name;
    tokens.subject_name = name;
    if (!tokens.name) tokens.name = name;
  }

  let title = renderTemplateText(String(config.title ?? "").trim(), tokens).trim() || "Workflow rule alert";
  const body = renderTemplateText(String(config.body ?? ""), tokens).trim();

  // The bell's whole job is "who is this about". If the rule author didn't put
  // a token anywhere, append the client name rather than leaving it anonymous.
  if (name && !title.includes(name) && !body.includes(name)) title = `${title} — ${name}`;

  const moduleKey = subjectTypeToModule(ctx.subjectType);
  const route = moduleKey ? MODULE_ROUTES[moduleKey] : undefined;
  const fallbackLink = route
    ? route.detail && ctx.subjectId
      ? `${route.path}/${ctx.subjectId}`
      : route.path
    : "";
  const linkUrl = renderTemplateText(String(config.linkUrl ?? ""), tokens).trim() || fallbackLink;

  const rows = [...ids].map((uid) => ({
    tenantId: ctx.tenantId,
    userId: uid,
    kind: String(config.kind ?? "workflow.rule"),
    title,
    body: body || null,
    linkUrl: linkUrl || null,
    severity: (config.severity as any) ?? "info",
    meta: {
      source: "workflow_rule",
      subjectType: ctx.subjectType,
      subjectId: ctx.subjectId,
      subjectName: name || null,
    },
  }));
  await ctx.tx.insert(notifications).values(rows);
  return {
    type: "create_notification",
    status: "succeeded",
    detail: `${rows.length} recipient(s)${fellBack ? " (fell back to firm owners)" : ""}${name ? ` · ${name}` : ""}`,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function offsetDate(amount: number, unit: "minute" | "hour" | "day" | "week"): Date {
  const ms =
    unit === "minute" ? 60_000 : unit === "hour" ? 3_600_000 : unit === "day" ? 86_400_000 : 604_800_000;
  return new Date(Date.now() + amount * ms);
}

function resolveAssignee(spec: unknown, record: Record<string, unknown>): string | undefined {
  if (!spec) return undefined;
  const s = String(spec);
  if (s.startsWith("fixed:")) return s.slice(6);
  if (s === "subject.rm_id" || s === "subject.owner_id") {
    return (record.rm_id as string) ?? (record.owner_id as string) ?? undefined;
  }
  return undefined;
}

function subjectTypeToModule(subjectType: string): string | undefined {
  const map: Record<string, string> = {
    investor: "investors",
    lead: "leads",
    task: "tasks",
    family: "families",
    transaction: "transactions",
    sip: "sips",
    sip_rejection: "sip_rejections",
    service_request: "service_requests",
    complaint: "complaints",
    review_meeting: "review_meetings",
    proposal: "proposals",
    insurance_policy: "insurance",
    content_post: "content_posts",
    campaign: "campaigns",
    goal: "goals",
    onboarding: "onboarding",
    risk_profile: "risk_profiles",
  };
  return map[subjectType];
}
