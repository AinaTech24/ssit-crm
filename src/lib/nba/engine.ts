/**
 * Next-Best-Action engine — the "advisor copilot" layer.
 *
 * Where the Command Center groups open work by TYPE (10 buckets), the NBA
 * engine flattens every signal into PER-CLIENT actions, attaches a ₹-impact
 * (AUM at risk / SIP value / cross-sell potential), scores each by
 * priority = typeWeight + impact-bump + urgency, and returns a single ranked
 * list answering: "who is the #1 client to act on right now, why, and what's
 * it worth?" This is the thing a generic CRM (Sanchay) structurally cannot do.
 *
 * Scope: firm-wide (managers) or personal (own book). Pass `forInvestorId` to
 * get just one client's recommendations (powers the Client-360 card).
 *
 * Read-only, RLS-scoped via withTenant at the call site.
 */

import { sql } from "drizzle-orm";

type Tx = { execute: (q: any) => Promise<{ rows: any[] }> };

export type NbaType =
  | "redemption_risk" | "sip_bounce" | "mandate_rejected" | "kyc_broken" | "review_overdue"
  | "dormant" | "rp_stale" | "cross_sell" | "birthday_today" | "anniversary"
  | "lead_followup" | "unanswered_inbound" | "proposal_aging";

export type NbaAction = {
  key: string;
  type: NbaType;
  subjectType: "investor" | "lead";
  subjectId: string;
  subjectName: string;
  avatarUrl: string | null;
  phone: string | null;
  email: string | null;
  rmName: string | null;
  title: string;
  reason: string;
  impactInr: number;
  score: number;
  severity: "now" | "today" | "soon";
  suggestedChannel: "call" | "whatsapp" | "task";
  /** Pre-drafted, compliance-safe outreach for this action (deterministic). */
  message: string;
  /** Stable snooze key ("nba:<type>:<id>") — reuses the command_center snooze store. */
  snoozeKey: string;
  /** Other open signals for the SAME client (the headline keeps the top one). */
  others?: { type: NbaType; label: string; reason: string }[];
  href: string;
  /** The signal's "relevant date" (review-due, follow-up, KYC expiry, bounce,
   *  birthday…) as YYYY-MM-DD — drives the date-range filter. null when undated. */
  date: string | null;
};

export const NBA_META: Record<NbaType, { label: string; weight: number; severity: "now" | "today" | "soon"; tone: string; icon: string }> = {
  redemption_risk:   { label: "Retention call", weight: 100, severity: "now", tone: "rose", icon: "TrendingDown" },
  sip_bounce:        { label: "Rescue SIP",     weight: 90,  severity: "now", tone: "rose", icon: "XOctagon" },
  mandate_rejected:  { label: "Re-register mandate", weight: 86, severity: "now", tone: "rose", icon: "XOctagon" },
  kyc_broken:        { label: "Fix KYC",        weight: 80,  severity: "today", tone: "amber", icon: "ShieldAlert" },
  unanswered_inbound:{ label: "Reply to client", weight: 72, severity: "today", tone: "sky", icon: "MessageCircle" },
  lead_followup:     { label: "Follow up lead", weight: 65,  severity: "today", tone: "violet", icon: "Sparkles" },
  proposal_aging:    { label: "Chase proposal", weight: 62,  severity: "today", tone: "violet", icon: "FileText" },
  review_overdue:    { label: "Run review",     weight: 60,  severity: "today", tone: "amber", icon: "CalendarClock" },
  dormant:           { label: "Re-engage",      weight: 52,  severity: "soon", tone: "sky", icon: "Moon" },
  rp_stale:          { label: "Refresh risk profile", weight: 48, severity: "soon", tone: "sky", icon: "ShieldCheck" },
  cross_sell:        { label: "Cross-sell",     weight: 45,  severity: "soon", tone: "emerald", icon: "TrendingUp" },
  birthday_today:    { label: "Wish birthday",  weight: 40,  severity: "today", tone: "violet", icon: "Cake" },
  anniversary:       { label: "Wish anniversary", weight: 38, severity: "today", tone: "violet", icon: "Cake" },
};

/**
 * ₹-impact contributes up to +120 to the score (₹1L per point, capped) so
 * big-ticket clients out-rank small ones within the same signal type instead of
 * everyone tying at a low ceiling.
 */
function scoreFor(type: NbaType, impactInr: number): number {
  return NBA_META[type].weight + Math.min(120, (Number(impactInr) || 0) / 100_000);
}

/** Deterministic, compliance-safe suggested outreach per action type. */
function messageFor(type: NbaType, name: string | null, r: any): string {
  const first = (name ?? "").split(" ")[0] || "there";
  switch (type) {
    case "redemption_risk": return `Hi ${first}, I wanted to check in on your portfolio and share a couple of thoughts — do you have a few minutes this week?`;
    case "sip_bounce": return `Hi ${first}, your SIP for ${r.scheme_name ?? "your scheme"} didn't go through this time. Shall I help you re-activate it so your plan stays on track?`;
    case "mandate_rejected": return `Hi ${first}, your bank mandate needs to be re-registered so your SIPs can debit smoothly — I'll help you set it up.`;
    case "kyc_broken": return `Hi ${first}, your KYC needs a quick update to keep your investments active — I can guide you through it in 5 minutes.`;
    case "unanswered_inbound": return `Hi ${first}, thanks for reaching out — getting back to you now. How can I help?`;
    case "lead_followup": return `Hi ${first}, following up on our conversation about your investment goals — happy to take the next step whenever you are.`;
    case "proposal_aging": return `Hi ${first}, just following up on the proposal I shared. Happy to answer any questions before you decide.`;
    case "review_overdue": return `Hi ${first}, it's time for your portfolio review. When works for a quick call this week?`;
    case "dormant": return `Hi ${first}, it's been a while! I'd love to reconnect and review how your investments are doing.`;
    case "rp_stale": return `Hi ${first}, as part of our annual process, let's refresh your risk profile to keep your plan aligned — it takes 5 minutes.`;
    case "cross_sell": return `Hi ${first}, I'd like to share a couple of ideas that could strengthen your overall financial plan — open to a quick chat?`;
    case "anniversary": return `Dear ${first}, wishing you and your family a very happy anniversary! 💐`;
    case "birthday_today": return `Dear ${first}, wishing you a very Happy Birthday! 🎂`;
    default: return `Hi ${first}, `;
  }
}

const num = (v: any) => Number(v ?? 0) || 0;
const inr = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`);

export async function buildNextBestActions(
  tx: Tx,
  opts: { userId: string; firmWide: boolean; forInvestorId?: string; limit?: number }
): Promise<NbaAction[]> {
  const { userId, firmWide, forInvestorId } = opts;
  const out: NbaAction[] = [];
  const todayISO = new Date().toISOString().slice(0, 10);

  // Per-user snooze/dismiss (reuses the command_center snooze store, "nba:" keys).
  const snoozed = new Set<string>();
  if (!forInvestorId) {
    try {
      const sn = await tx.execute(sql`
        SELECT item_key FROM command_center_snoozes
        WHERE user_id = ${userId}::uuid AND item_key LIKE 'nba:%'
          AND (dismissed = true OR (snoozed_until IS NOT NULL AND snoozed_until > now()))
      `);
      for (const row of sn.rows) snoozed.add(String((row as any).item_key));
    } catch {
      /* table missing (pre-migration) — treat as none */
    }
  }

  // Personal scope OR single-investor scope.
  const invScope = forInvestorId
    ? sql` AND i.id = ${forInvestorId}::uuid`
    : firmWide ? sql`` : sql` AND i.rm_id = ${userId}::uuid`;
  const sipScope = forInvestorId
    ? sql` AND s.investor_id = ${forInvestorId}::uuid`
    : firmWide ? sql`` : sql` AND s.rm_id = ${userId}::uuid`;
  const cap = forInvestorId ? sql`` : sql`LIMIT 80`;

  function push(
    type: NbaType,
    r: any,
    impactInr: number,
    title: string,
    reason: string,
    channel: NbaAction["suggestedChannel"],
    extra?: { subjectType?: "investor" | "lead"; subjectId?: string; href?: string; dateRaw?: any }
  ) {
    // The date that makes this action "due" — drives the date-range filter.
    const dateRaw =
      extra?.dateRaw !== undefined ? extra.dateRaw :
      type === "redemption_risk" ? r.redemption_risk_flagged_at :
      type === "sip_bounce" ? r.updated_at :
      type === "kyc_broken" ? r.ckyc_expiry_at :
      type === "lead_followup" ? r.next_follow_up_at :
      type === "review_overdue" ? r.next_review_at :
      type === "dormant" ? r.last_transaction_at :
      type === "rp_stale" ? r.risk_profile_signed_at :
      type === "birthday_today" || type === "anniversary" ? todayISO :
      null; // cross_sell has no natural date
    const subjectType = extra?.subjectType ?? (type === "lead_followup" ? "lead" : "investor");
    const subjectId = extra?.subjectId ?? r.id;
    out.push({
      key: `${type}:${subjectId}`,
      type,
      subjectType,
      subjectId,
      subjectName: r.name,
      avatarUrl: r.avatar_url ?? null,
      phone: r.phone ?? null,
      email: r.email ?? null,
      rmName: r.rm_name ?? null,
      title,
      reason,
      impactInr,
      score: scoreFor(type, impactInr),
      severity: NBA_META[type].severity,
      suggestedChannel: channel,
      message: messageFor(type, r.name, r),
      snoozeKey: `nba:${type}:${subjectId}`,
      href: extra?.href ?? (subjectType === "lead" ? `/dashboard/leads/${subjectId}` : `/dashboard/investors/${subjectId}`),
      date: toISODate(dateRaw),
    });
  }

  // 1. Redemption-risk → AUM at risk.
  {
    const r = await tx.execute(sql`
      SELECT i.id, i.name, i.avatar_url, i.phone, i.email, COALESCE(i.aum,0)::numeric AS aum, i.redemption_risk_reason, i.redemption_risk_flagged_at, u.name AS rm_name
      FROM investors i LEFT JOIN users u ON u.id = i.rm_id
      WHERE i.merged_into_id IS NULL AND i.deleted_at IS NULL AND (i.status = 'redemption_risk' OR i.redemption_risk_flagged_at IS NOT NULL) ${invScope}
      ORDER BY i.aum DESC NULLS LAST ${cap}
    `);
    for (const x of r.rows) push("redemption_risk", x, num(x.aum), `Retention call — ${inr(num(x.aum))} at risk`, x.redemption_risk_reason ?? "Flagged redemption-risk", "call");
  }
  // 2. SIP bounce → annualised SIP value.
  {
    const r = await tx.execute(sql`
      SELECT i.id, i.name, i.avatar_url, i.phone, i.email, u.name AS rm_name,
             s.amount::numeric AS amount, s.scheme_name, COALESCE(NULLIF(s.consecutive_failures,''),'0')::int AS fails, s.updated_at
      FROM sips s JOIN investors i ON i.id = s.investor_id LEFT JOIN users u ON u.id = i.rm_id
      WHERE i.merged_into_id IS NULL AND i.deleted_at IS NULL AND (s.status = 'rejected' OR COALESCE(NULLIF(s.consecutive_failures,''),'0')::int > 0) AND s.status <> 'stopped' ${sipScope}
      ORDER BY fails DESC, s.amount DESC NULLS LAST ${cap}
    `);
    for (const x of r.rows) push("sip_bounce", x, num(x.amount) * 12, `Rescue SIP — ${inr(num(x.amount))}/mo`, `${x.scheme_name ?? "SIP"} · ${x.fails} bounce${num(x.fails) === 1 ? "" : "es"}`, "call");
  }
  // 3. KYC broken/expiring → AUM blocked.
  {
    const r = await tx.execute(sql`
      SELECT i.id, i.name, i.avatar_url, i.phone, i.email, COALESCE(i.aum,0)::numeric AS aum, i.kyc_status, i.ckyc_expiry_at, u.name AS rm_name
      FROM investors i LEFT JOIN users u ON u.id = i.rm_id
      WHERE i.merged_into_id IS NULL AND i.deleted_at IS NULL AND i.status = 'active' AND (
        i.kyc_status IN ('expired','re_kyc_required','rejected')
        OR (i.ckyc_expiry_at IS NOT NULL AND i.ckyc_expiry_at BETWEEN current_date AND current_date + interval '30 days')
      ) ${invScope}
      ORDER BY i.ckyc_expiry_at ASC NULLS FIRST ${cap}
    `);
    for (const x of r.rows) push("kyc_broken", x, num(x.aum), `Fix KYC — transactions blocked`, x.ckyc_expiry_at ? `CKYC expires ${fmt(x.ckyc_expiry_at)}` : `KYC ${x.kyc_status}`, "task");
  }
  // 4. Lead follow-up overdue → intended amount.
  if (!forInvestorId) {
    const leadScope = firmWide ? sql`` : sql` AND l.owner_id = ${userId}::uuid`;
    const r = await tx.execute(sql`
      SELECT l.id, l.name, l.avatar_url, l.phone, l.email, l.stage, l.next_follow_up_at, u.name AS rm_name,
             COALESCE(NULLIF(regexp_replace(COALESCE(l.intended_amount,''),'[^0-9.]','','g'),'')::numeric, 0) AS amt
      FROM leads l LEFT JOIN users u ON u.id = l.owner_id
      WHERE l.converted_investor_id IS NULL AND l.stage NOT IN ('not_qualified','lost','not_interested','converted')
        AND l.next_follow_up_at IS NOT NULL AND l.next_follow_up_at < now() ${leadScope}
      ORDER BY l.next_follow_up_at ASC ${cap}
    `);
    for (const x of r.rows) push("lead_followup", x, num(x.amt), `Follow up — ${num(x.amt) > 0 ? inr(num(x.amt)) : "open"} lead`, `${String(x.stage).replace(/_/g, " ")} · overdue ${fmt(x.next_follow_up_at)}`, "call");
  }
  // 5. Review overdue → AUM.
  {
    const r = await tx.execute(sql`
      SELECT i.id, i.name, i.avatar_url, i.phone, i.email, COALESCE(i.aum,0)::numeric AS aum, i.service_tier, i.next_review_at, u.name AS rm_name
      FROM investors i LEFT JOIN users u ON u.id = i.rm_id
      WHERE i.merged_into_id IS NULL AND i.deleted_at IS NULL AND i.status = 'active' AND i.next_review_at IS NOT NULL AND i.next_review_at < now() ${invScope}
      ORDER BY i.aum DESC NULLS LAST ${cap}
    `);
    for (const x of r.rows) push("review_overdue", x, num(x.aum), `Run review — Tier ${x.service_tier ?? "—"}`, `Review due ${fmt(x.next_review_at)}`, "call");
  }
  // 6. Dormant (no txn 180d+) → AUM.
  {
    const r = await tx.execute(sql`
      SELECT i.id, i.name, i.avatar_url, i.phone, i.email, COALESCE(i.aum,0)::numeric AS aum, i.last_transaction_at, u.name AS rm_name
      FROM investors i LEFT JOIN users u ON u.id = i.rm_id
      WHERE i.merged_into_id IS NULL AND i.deleted_at IS NULL AND i.status = 'active'
        AND (i.last_transaction_at IS NULL OR i.last_transaction_at < now() - make_interval(days => COALESCE((SELECT dormancy_window_days FROM tenants WHERE id = i.tenant_id), 180)))
        AND COALESCE(i.aum,0) > 0 ${invScope}
      ORDER BY i.aum DESC NULLS LAST ${cap}
    `);
    // Dormant ₹-impact = a retention fraction of AUM (it's reactivation value,
    // not the whole book "at risk" like a redemption flag).
    for (const x of r.rows) push("dormant", x, Math.round(num(x.aum) * 0.3), `Re-engage — dormant 6m+`, x.last_transaction_at ? `Last txn ${fmt(x.last_transaction_at)}` : "No transactions", "whatsapp");
  }
  // 7. Cross-sell opportunity → 15% of AUM (wallet-share estimate, min ₹1L).
  {
    const r = await tx.execute(sql`
      SELECT i.id, i.name, i.avatar_url, i.phone, i.email, COALESCE(i.aum,0)::numeric AS aum, u.name AS rm_name,
        (SELECT string_agg(cs.k, ', ') FROM jsonb_each_text(i.cross_sell) AS cs(k,v) WHERE cs.v IN ('held_elsewhere','interested','not_held')) AS gaps
      FROM investors i LEFT JOIN users u ON u.id = i.rm_id
      WHERE i.merged_into_id IS NULL AND i.deleted_at IS NULL AND i.status = 'active' AND i.cross_sell IS NOT NULL
        AND EXISTS (SELECT 1 FROM jsonb_each_text(i.cross_sell) AS cs(k,v) WHERE cs.v IN ('held_elsewhere','interested','not_held')) ${invScope}
      ORDER BY i.aum DESC NULLS LAST ${cap}
    `);
    for (const x of r.rows) { const pot = Math.max(100000, Math.round(num(x.aum) * 0.15)); push("cross_sell", x, pot, `Cross-sell — ~${inr(pot)} potential`, x.gaps ? `Gaps: ${String(x.gaps).replace(/_/g, " ")}` : "Wallet-share opportunity", "call"); }
  }
  // 8. Risk profile stale (SEBI annual) → AUM.
  {
    const r = await tx.execute(sql`
      SELECT i.id, i.name, i.avatar_url, i.phone, i.email, COALESCE(i.aum,0)::numeric AS aum, i.risk_profile_signed_at, u.name AS rm_name
      FROM investors i LEFT JOIN users u ON u.id = i.rm_id
      WHERE i.merged_into_id IS NULL AND i.deleted_at IS NULL AND i.status = 'active'
        AND (i.risk_profile_signed_at IS NULL OR i.risk_profile_signed_at < now() - interval '365 days') ${invScope}
      ORDER BY i.aum DESC NULLS LAST ${cap}
    `);
    for (const x of r.rows) {
      // Never-assessed is an INITIAL assessment, not a "refresh" — labelling it
      // "Refresh … (SEBI annual)" was wrong (and duplicated the detail-page
      // banner verbatim). Distinguish the two cases.
      const neverAssessed = !x.risk_profile_signed_at;
      push(
        "rp_stale",
        x,
        num(x.aum),
        neverAssessed ? `Complete risk assessment (SEBI)` : `Refresh risk profile (SEBI annual)`,
        neverAssessed ? "Never assessed — required before transacting" : `Signed ${fmt(x.risk_profile_signed_at)}`,
        "task"
      );
    }
  }
  // 9. Birthday today → relationship touch.
  {
    const r = await tx.execute(sql`
      SELECT i.id, i.name, i.avatar_url, i.phone, i.email, i.dob, u.name AS rm_name
      FROM investors i LEFT JOIN users u ON u.id = i.rm_id
      WHERE i.merged_into_id IS NULL AND i.deleted_at IS NULL AND i.status = 'active' AND i.dob IS NOT NULL
        AND to_char(i.dob, 'MM-DD') = to_char(current_date, 'MM-DD') ${invScope}
      ORDER BY i.name ASC ${cap}
    `);
    for (const x of r.rows) push("birthday_today", x, 0, `Wish a happy birthday 🎂`, "Birthday today", "whatsapp");
  }

  // 10. Anniversary today → relationship touch.
  {
    const r = await tx.execute(sql`
      SELECT i.id, i.name, i.avatar_url, i.phone, i.email, u.name AS rm_name
      FROM investors i LEFT JOIN users u ON u.id = i.rm_id
      WHERE i.merged_into_id IS NULL AND i.deleted_at IS NULL AND i.status = 'active' AND i.anniversary_date IS NOT NULL
        AND to_char(i.anniversary_date, 'MM-DD') = to_char(current_date, 'MM-DD') ${invScope}
      ORDER BY i.name ASC ${cap}
    `);
    for (const x of r.rows) push("anniversary", x, 0, `Wish a happy anniversary 💐`, "Anniversary today", "whatsapp");
  }

  // 11. Mandate rejected → first SIP blocked.
  {
    const r = await tx.execute(sql`
      SELECT i.id, i.name, i.avatar_url, i.phone, i.email, COALESCE(i.aum,0)::numeric AS aum, u.name AS rm_name
      FROM investors i LEFT JOIN users u ON u.id = i.rm_id
      WHERE i.merged_into_id IS NULL AND i.deleted_at IS NULL AND i.mandate_status = 'rejected' ${invScope}
      ORDER BY i.aum DESC NULLS LAST ${cap}
    `);
    for (const x of r.rows) push("mandate_rejected", x, num(x.aum), `Re-register mandate — SIPs blocked`, "Bank rejected the NACH / e-mandate", "call");
  }

  // 12. Unanswered inbound (client replied, no response in 14d) → relationship.
  if (!forInvestorId) {
    const inScope = firmWide ? sql`` : sql` AND (i.rm_id = ${userId}::uuid OR l.owner_id = ${userId}::uuid)`;
    const r = await tx.execute(sql`
      SELECT c.channel, c.created_at,
             COALESCE(i.id, l.id) AS id,
             COALESCE(i.name, l.name) AS name,
             COALESCE(i.avatar_url, l.avatar_url) AS avatar_url,
             COALESCE(i.phone, l.phone) AS phone,
             COALESCE(i.email, l.email) AS email,
             COALESCE(i.aum, 0)::numeric AS aum,
             (c.investor_id IS NOT NULL) AS is_investor,
             u.name AS rm_name
      FROM communications c
      LEFT JOIN investors i ON i.id = c.investor_id
      LEFT JOIN leads l ON l.id = c.lead_id
      LEFT JOIN users u ON u.id = COALESCE(i.rm_id, l.owner_id)
      WHERE c.direction = 'inbound' AND c.created_at > now() - interval '14 days'
        AND (c.investor_id IS NOT NULL OR c.lead_id IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM communications o
          WHERE o.tenant_id = c.tenant_id AND o.direction = 'outbound' AND o.created_at > c.created_at
            AND (o.investor_id IS NOT DISTINCT FROM c.investor_id AND o.lead_id IS NOT DISTINCT FROM c.lead_id)
        )
        ${inScope}
      ORDER BY c.created_at ASC ${cap}
    `);
    for (const x of r.rows)
      push("unanswered_inbound", x, Math.round(num(x.aum) * 0.02), `Reply to client message`, `Replied on ${x.channel} · ${fmt(x.created_at)}`, x.is_investor ? "whatsapp" : "call", {
        subjectType: x.is_investor ? "investor" : "lead",
        subjectId: x.id,
        href: x.is_investor ? `/dashboard/investors/${x.id}` : `/dashboard/leads/${x.id}`,
        dateRaw: x.created_at,
      });
  }

  // 13. Proposals sent & aging (awaiting approval 7+ days) → pipeline.
  {
    const propScope = forInvestorId
      ? sql` AND p.investor_id = ${forInvestorId}::uuid`
      : firmWide
        ? sql``
        : sql` AND (p.investor_id IN (SELECT id FROM investors WHERE rm_id = ${userId}::uuid AND deleted_at IS NULL)
                    OR p.lead_id IN (SELECT id FROM leads WHERE owner_id = ${userId}::uuid))`;
    const r = await tx.execute(sql`
      SELECT p.recipient_name AS name, p.title, p.sent_at,
             COALESCE(p.investor_id, p.lead_id) AS id,
             (p.investor_id IS NOT NULL) AS is_investor,
             COALESCE(i.phone, l.phone) AS phone,
             COALESCE(i.email, l.email) AS email,
             COALESCE(i.avatar_url, l.avatar_url) AS avatar_url,
             u.name AS rm_name
      FROM proposals p
      LEFT JOIN investors i ON i.id = p.investor_id
      LEFT JOIN leads l ON l.id = p.lead_id
      LEFT JOIN users u ON u.id = COALESCE(i.rm_id, l.owner_id)
      WHERE p.sent_at IS NOT NULL AND p.accepted_at IS NULL AND p.rejected_at IS NULL
        AND p.sent_at < now() - interval '7 days'
        AND COALESCE(p.investor_id, p.lead_id) IS NOT NULL
        ${propScope}
      ORDER BY p.sent_at ASC ${cap}
    `);
    for (const x of r.rows)
      push("proposal_aging", x, 0, `Chase proposal approval`, `${x.title ?? "Proposal"} · sent ${fmt(x.sent_at)}`, "call", {
        subjectType: x.is_investor ? "investor" : "lead",
        subjectId: x.id,
        href: x.is_investor ? `/dashboard/investors/${x.id}` : `/dashboard/leads/${x.id}`,
        dateRaw: x.sent_at,
      });
  }

  // Drop snoozed/dismissed actions (per-user) before ranking.
  const visible = forInvestorId ? out : out.filter((a) => !snoozed.has(a.snoozeKey));
  visible.sort((a, b) => b.score - a.score);
  if (forInvestorId) return visible;

  // One headline action per client; the rest attach as `others` so the RM sees
  // the full picture without one client dominating the top of the list.
  const headlineBy = new Map<string, NbaAction>();
  const ranked: NbaAction[] = [];
  for (const a of visible) {
    const existing = headlineBy.get(a.subjectId);
    if (!existing) {
      a.others = [];
      headlineBy.set(a.subjectId, a);
      ranked.push(a);
    } else {
      (existing.others ??= []).push({ type: a.type, label: NBA_META[a.type].label, reason: a.reason });
    }
  }
  return ranked.slice(0, opts.limit ?? 100);
}

function fmt(v: any): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

/** Normalise any date-ish value to YYYY-MM-DD (or null) for range comparisons. */
function toISODate(v: any): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
