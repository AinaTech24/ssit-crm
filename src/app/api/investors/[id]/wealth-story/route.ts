import { handleApiError } from "@/lib/api/error-handler";
/**
 * Wealth Story & Client Review Pack — comprehensive client-facing recap of the
 * client's trailing 12 months of investing, asset allocation, goals, and top holdings.
 *
 *   GET  /api/investors/[id]/wealth-story          → story JSON
 *   GET  /api/investors/[id]/wealth-story?pdf=1    → branded PDF (attachment)
 *   POST /api/investors/[id]/wealth-story          → { action: "email", to? }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql, and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession, type SessionUser } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { investors, folios, tenants } from "@/db/schema";
import { assertInScope } from "@/lib/auth/data-scope";
import { assertCanViewPortfolio } from "@/lib/investors/access";
import { renderCalcPdf, type PdfBlock } from "@/lib/calculators/calc-pdf";
import { fetchBrandLogoBytes } from "@/lib/calculators/share-helpers";
import { pickLogo } from "@/lib/branding/logo";
import { emailAdapter } from "@/lib/comms/adapters/resend";
import { resolveEmailSender } from "@/lib/comms/sender";
import { emailLogoHeaderHtml } from "@/lib/comms/email-logo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ────────────────────────── story shape ────────────────────────── */

type WealthStory = {
  client: { name: string; email: string | null; tenureYears: number; riskProfile: string | null };
  period: { from: string; to: string };
  invested: number;
  withdrawn: number;
  netInvested: number;
  currentValue: number;
  sipInstallments: number;
  sipTotal: number;
  activeMonths: number;
  topHolding: { name: string; value: number } | null;
  topHoldings: { name: string; category?: string; value: number; sharePct: number }[];
  assetAllocation: { category: string; value: number; pct: number }[];
  holdingsCount: number;
  amcCount: number;
  goals: { name: string; targetAmount: number; progressPct: number | null }[];
  funFacts: string[];
  hasData: boolean;
};

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const monLabel = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

/* ────────────────────────── data loader ────────────────────────── */

async function loadStory(tx: any, session: SessionUser, investorId: string): Promise<WealthStory | null> {
  const [inv] = await tx
    .select({
      id: investors.id,
      name: investors.name,
      email: investors.email,
      riskProfile: investors.riskProfile,
      createdAt: investors.createdAt,
      onboardedAt: investors.onboardedAt,
      branchId: investors.branchId,
      rmId: investors.rmId,
      serviceRmId: investors.serviceRmId,
    })
    .from(investors)
    .where(and(eq(investors.id, investorId), eq(investors.tenantId, session.tenantId), isNull(investors.deletedAt)))
    .limit(1);
  if (!inv) return null;
  // Same wall as the client's other pages — the wealth story is a PDF of the
  // client's full portfolio, transactions and goals.
  await assertInScope(tx, session, { branchId: inv.branchId, ownerId: [inv.rmId, inv.serviceRmId] }, "client");
      await assertCanViewPortfolio(tx, session, inv);

  const to = new Date();
  const from = new Date(to);
  from.setFullYear(from.getFullYear() - 1);
  const fromIso = isoDate(from);
  const toIso = isoDate(to);

  // One-pass transaction aggregates over the trailing-12-month window.
  const agg = (
    await tx.execute(sql`
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE direction = 'inflow'  AND type IN ('purchase','sip','lumpsum')), 0) AS invested,
        COALESCE(SUM(amount) FILTER (WHERE type IN ('redemption','swp')), 0)                                    AS withdrawn,
        COUNT(*)             FILTER (WHERE type = 'sip')                                                        AS sip_installments,
        COALESCE(SUM(amount) FILTER (WHERE type = 'sip'), 0)                                                    AS sip_total,
        COUNT(DISTINCT date_trunc('month', order_date))
                             FILTER (WHERE direction = 'inflow' AND type IN ('purchase','sip','lumpsum'))       AS active_months,
        COUNT(*)                                                                                                AS tx_count
      FROM transactions
      WHERE investor_id = ${investorId}
        AND order_date >= ${fromIso} AND order_date <= ${toIso}
        AND status NOT IN ('rejected','cancelled','failed')
    `)
  ).rows[0] as any;

  const folioRows = await tx
    .select({ aum: folios.aum, amcName: folios.amcName, schemes: folios.schemes })
    .from(folios)
    .where(and(eq(folios.investorId, investorId), eq(folios.tenantId, session.tenantId)));

  const currentValue = folioRows.reduce((s: number, f: any) => s + num(f.aum), 0);
  const byScheme = new Map<string, { value: number; category?: string }>();
  const amcs = new Set<string>();
  const allocMap = new Map<string, number>();

  for (const f of folioRows) {
    if (f.amcName) amcs.add(String(f.amcName).trim().toLowerCase());
    for (const s of (f.schemes ?? []) as any[]) {
      if (!s?.schemeName) continue;
      const v = num(s.value ?? s.aum);
      const cat = String(s.category ?? s.schemeCategory ?? "Equity").trim();
      
      const existing = byScheme.get(s.schemeName);
      byScheme.set(s.schemeName, { value: (existing?.value ?? 0) + v, category: cat });
      
      const normalizedCat = /debt|liquid|money market|bond|gilt/i.test(cat)
        ? "Debt & Fixed Income"
        : /hybrid|balanced|arbitrage|multi asset/i.test(cat)
        ? "Hybrid & Asset Allocator"
        : /liquid|overnight|ultra short/i.test(cat)
        ? "Liquid & Cash"
        : "Equity";
        
      allocMap.set(normalizedCat, (allocMap.get(normalizedCat) ?? 0) + v);
    }
  }

  // If no scheme-level breakdown was present, categorize by overall folio AUM
  if (allocMap.size === 0 && currentValue > 0) {
    allocMap.set("Equity", currentValue);
  }

  const assetAllocation = Array.from(allocMap.entries()).map(([category, val]) => ({
    category,
    value: val,
    pct: currentValue > 0 ? Math.round((val / currentValue) * 100) : 0,
  }));

  const allHoldingsSorted = Array.from(byScheme.entries())
    .map(([name, data]) => ({
      name,
      category: data.category,
      value: data.value,
      sharePct: currentValue > 0 ? Math.round((data.value / currentValue) * 100) : 0,
    }))
    .sort((a, b) => b.value - a.value);

  const topHoldings = allHoldingsSorted.slice(0, 5);
  const topHolding = topHoldings[0] ? { name: topHoldings[0].name, value: topHoldings[0].value } : null;

  const goalRows = (
    await tx.execute(sql`
      SELECT name, target_amount, progress_pct
      FROM goals
      WHERE investor_id = ${investorId} AND status NOT IN ('abandoned')
      ORDER BY target_date ASC
      LIMIT 6
    `)
  ).rows as any[];

  const invested = num(agg?.invested);
  const withdrawn = num(agg?.withdrawn);
  const sipInstallments = num(agg?.sip_installments);
  const sipTotal = num(agg?.sip_total);
  const activeMonths = num(agg?.active_months);
  const txCount = num(agg?.tx_count);

  const anchor = inv.onboardedAt ?? inv.createdAt;
  const tenureYears = anchor ? Math.max(0, Math.round(((Date.now() - new Date(anchor).getTime()) / 31557600000) * 10) / 10) : 0;

  // Deterministic, honest fun-facts
  const funFacts: string[] = [];
  if (sipInstallments >= 10) funFacts.push(`${sipInstallments} SIP installments this year — investing on autopilot. That's real discipline.`);
  if (activeMonths >= 2) funFacts.push(`You added money in ${activeMonths} of the last 12 months.`);
  if (byScheme.size >= 2 && amcs.size >= 1)
    funFacts.push(`Your portfolio spans ${byScheme.size} scheme${byScheme.size === 1 ? "" : "s"} across ${amcs.size} fund house${amcs.size === 1 ? "" : "s"}.`);
  if (funFacts.length < 2 && tenureYears >= 1) funFacts.push(`${tenureYears} year${tenureYears >= 2 ? "s" : ""} of investing together — thank you for the trust.`);

  return {
    client: { name: inv.name, email: inv.email ?? null, tenureYears, riskProfile: inv.riskProfile ?? null },
    period: { from: fromIso, to: toIso },
    invested,
    withdrawn,
    netInvested: invested - withdrawn,
    currentValue,
    sipInstallments,
    sipTotal,
    activeMonths,
    topHolding,
    topHoldings,
    assetAllocation,
    holdingsCount: byScheme.size,
    amcCount: amcs.size,
    goals: goalRows.map((g) => ({ name: g.name, targetAmount: num(g.target_amount), progressPct: g.progress_pct == null ? null : num(g.progress_pct) })),
    funFacts: funFacts.slice(0, 3),
    hasData: folioRows.length > 0 || txCount > 0 || currentValue > 0,
  };
}

/* ────────────────────────── story → PDF ────────────────────────── */

function storyToBlocks(story: WealthStory): PdfBlock[] {
  const blocks: PdfBlock[] = [];
  blocks.push({
    type: "insight",
    text:
      `This Portfolio Review & Wealth Story covers ${monLabel(story.period.from)} to ${monLabel(story.period.to)}. ` +
      `"Current Valuation" is the live portfolio value on record; "You added this year" is the actual capital invested during the period.`,
  });

  blocks.push({ type: "stat", label: "Current Valuation", value: inr(story.currentValue) });
  blocks.push({ type: "stat", label: "You added this year", value: inr(story.invested) });
  blocks.push({ type: "stat", label: "You withdrew", value: inr(story.withdrawn) });
  blocks.push({ type: "stat", label: "Net added this year", value: inr(story.netInvested) });
  blocks.push({ type: "stat", label: "SIP installments", value: String(story.sipInstallments) });
  blocks.push({ type: "stat", label: "Added via SIP", value: inr(story.sipTotal) });
  blocks.push({ type: "stat", label: "Schemes held", value: String(story.holdingsCount) });
  blocks.push({ type: "stat", label: "Fund houses", value: String(story.amcCount) });
  blocks.push({ type: "stat", label: "Investing together for", value: `${story.client.tenureYears} yr${story.client.tenureYears >= 2 ? "s" : ""}` });

  if (story.assetAllocation && story.assetAllocation.length > 0) {
    blocks.push({ type: "section", text: "Asset Allocation Breakdown" });
    blocks.push({
      type: "table",
      head: ["Asset Category", "Valuation", "Portfolio Share"],
      rows: story.assetAllocation.map((a) => [a.category, inr(a.value), `${a.pct}%`]),
    });
  }

  if (story.topHoldings && story.topHoldings.length > 0) {
    blocks.push({ type: "section", text: "Top Mutual Fund Holdings" });
    blocks.push({
      type: "table",
      head: ["Scheme Name", "Valuation", "Weight"],
      rows: story.topHoldings.map((h) => [h.name, inr(h.value), `${h.sharePct}%`]),
    });
  }

  if (story.goals.length) {
    blocks.push({ type: "section", text: "Goals in Motion" });
    blocks.push({
      type: "table",
      head: ["Financial Goal", "Target Amount", "Progress"],
      rows: story.goals.map((g) => [g.name, inr(g.targetAmount), g.progressPct == null ? "-" : `${Math.round(g.progressPct)}%`]),
    });
  }

  if (story.funFacts.length) {
    blocks.push({ type: "section", text: "Annual Milestones" });
    for (const f of story.funFacts) blocks.push({ type: "insight", text: f });
  }

  blocks.push({ type: "section", text: "Statutory Disclaimers" });
  blocks.push({
    type: "insight",
    text:
      "Mutual fund investments are subject to market risks. Read all scheme related documents carefully. " +
      "Past performance is not indicative of future returns. Calculations and valuations are based on data recorded on the platform.",
  });
  return blocks;
}

async function buildStoryPdf(req: NextRequest, session: SessionUser, story: WealthStory, tenant: any) {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const origin = host ? `${proto}://${host}` : null;
  const logoBytes = await fetchBrandLogoBytes(pickLogo(tenant, "full"), origin);
  const generatedAt = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

  const pdf = await renderCalcPdf({
    firmName: tenant?.legalName ?? tenant?.displayName ?? "Your firm",
    arn: tenant?.arn ?? null,
    preparedBy: session.name,
    firmPhone: tenant?.phone ?? null,
    firmEmail: tenant?.email ?? null,
    firmWebsite: tenant?.website ?? null,
    clientName: story.client.name,
    clientEmail: story.client.email,
    calcName: "Portfolio Review & Wealth Story",
    blocks: storyToBlocks(story),
    logoBytes,
    primaryHex: tenant?.primaryColor ?? null,
    generatedAt,
  });
  const fname = `PortfolioReview_${story.client.name}`.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 60) + ".pdf";
  return { pdf, fname };
}

/* ────────────────────────── GET ────────────────────────── */

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const { id } = await params;
    const wantPdf = req.nextUrl.searchParams.get("pdf") === "1";

    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        const story = await loadStory(tx, session, id);
        if (!story) return null;
        if (!wantPdf) return { story, tenant: null as any };
        const tenant = (await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0] ?? null;
        return { story, tenant };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (!wantPdf) return NextResponse.json(data.story);

    const { pdf, fname } = await buildStoryPdf(req, session, data.story, data.tenant);
    return new NextResponse(pdf as any, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${fname}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}

/* ────────────────────────── POST (email to client) ────────────────────────── */

const esc = (s: string) => (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const PostBody = z.object({
  action: z.literal("email"),
  to: z.string().max(160).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const { id } = await params;
    const parsed = PostBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        const story = await loadStory(tx, session, id);
        if (!story) return null;
        const tenant = (await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0] ?? null;
        let sender: any;
        sender = await resolveEmailSender(tx, session.tenantId, session.userId);
        return { story, tenant, sender };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });

    const email = (parsed.data.to ?? data.story.client.email ?? "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json(
        { error: "No valid email for this client — add one to their profile or enter an address." },
        { status: 400 }
      );
    }

    const tenant = data.tenant as any;
    const firmName = tenant?.displayName ?? tenant?.legalName ?? "Your advisor";
    const { pdf, fname } = await buildStoryPdf(req, session, data.story, tenant);

    const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#0f172a;">
      ${emailLogoHeaderHtml(tenant?.logoUrl, firmName)}
      <p>Dear ${esc(data.story.client.name || "Investor")},</p>
      <p>Here's your <strong>annual portfolio review & wealth recap</strong> with ${esc(firmName)} attached as a PDF report. ✨</p>
      <p>It summarizes your asset allocation, SIP discipline, goal progress, and key mutual fund holdings.</p>
      <p style="margin-top:20px;">Warm regards,<br/><strong>${esc(firmName)}</strong></p>
      <p style="font-size:11px;color:#64748b;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:10px;">Mutual fund investments are subject to market risks. Read all scheme related documents carefully.</p>
    </div>`;

    try {
      const res = await emailAdapter.send({
        tenantId: session.tenantId,
        tokens: {},
        rendered: {
          subject: `Portfolio Review & Wealth Report — ${firmName}`,
          text: `Here's your annual portfolio review with ${firmName} — your report PDF is attached.`,
          tokens: {},
        },
        recipient: email,
        category: "transactional",
        inlineHtml: html,
        idempotencyKey: `wealth-story:${session.userId}:${id}:${Date.now()}`,
        smtp: (data.sender as any).smtp,
        fromOverride: (data.sender as any).fromEmail || undefined,
        fromNameOverride: (data.sender as any).fromName || firmName,
        replyTo: (data.sender as any).replyTo || undefined,
        attachments: [{ filename: fname, content: pdf }],
      } as any);
      return NextResponse.json({ ok: true, externalId: (res as any)?.externalId ?? null });
    } catch (e: any) {
      const m = String(e?.message ?? "");
      const friendly = /RESEND_API_KEY|EAUTH|invalid login|535|ECONNREFUSED|getaddrinfo|certificate|authentication/i.test(m)
        ? "Couldn't send — check your firm's email connection under Settings → Email."
        : m || "Could not send email";
      return NextResponse.json({ error: friendly }, { status: 502 });
    }
  } catch (err: any) {
    return handleApiError(err);
  }
}
