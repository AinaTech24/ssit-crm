import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { ChevronLeft, Phone, Mail, MessageCircle, MapPin, AlertTriangle, User2, ShieldCheck, Sparkles, ArrowRight, Wallet, ClipboardList, LifeBuoy, CalendarClock } from "lucide-react";
import { withTenant } from "@/db/client";
import {
  investors,
  folios,
  sips,
  goals,
  transactions,
  communications,
  tasks,
  serviceRequests,
  consents,
  auditLog,
  users,
  families,
  reviewMeetings,
  riskProfileResponses,
} from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatINR, formatDate, formatRelative, formatPhone, isValidIndianMobile } from "@/lib/utils";
import { CheckInButton, LogActivityButton } from "@/components/activities/ActivityLogger";
import { ChangeLogButton } from "@/components/common/ChangeLog";
import { RecordProvenance } from "@/components/common/RecordProvenance";
import { RowActions } from "@/components/common/RowActions";
import { VerifyContact } from "@/components/investors/VerifyContact";
import { RecommendedActions } from "@/components/investors/RecommendedActions";
import { AiClientBrief } from "@/components/investors/AiClientBrief";
import { BestTimeBadge } from "@/components/investors/BestTimeBadge";
import { OnboardingWizardButton } from "@/components/investors/OnboardingWizard";
import { OverflowMenu } from "@/components/leads/LeadHeaderTools";
import { QuickCommsPanel } from "@/components/investors/QuickCommsPanel";
import { ActivityTimeline } from "@/components/investors/ActivityTimeline";
import { ClientNotes } from "@/components/investors/ClientNotes";
import { NomineeSection } from "@/components/investors/NomineeSection";
import { ReferralSection } from "@/components/investors/ReferralSection";
import { CustomFieldsCard } from "@/components/common/CustomFieldsCard";
import { RiskProfilePdfButtons } from "@/components/risk-profile/RiskProfileName";
import { SendRiskProfileLinkButton } from "@/components/risk-profile/SendRiskProfileLinkButton";
import { loadTenantLicense } from "@/lib/auth/license";
import { isFieldAllowed } from "@/lib/auth/field-gate";
import { InvestorBlueprintStageBar } from "@/components/investors/InvestorBlueprintStageBar";
import { ClientGifts } from "@/components/investors/ClientGifts";
import { ClientHealthCard } from "@/components/investors/ClientHealthCard";
import { PortfolioAllocation } from "@/components/investors/PortfolioAllocation";
import { FamilySnapshot } from "@/components/investors/FamilySnapshot";
import { StatementActions } from "@/components/investors/StatementActions";
import { WealthStoryButton } from "@/components/investors/WealthStoryButton";
import { valueInvestor } from "@/lib/finance/valuation";
import { ChurnRiskCard } from "@/components/investors/ChurnRiskCard";
import { churnForInvestor } from "@/lib/churn/scan";
import { TransactionLedger } from "@/components/investors/TransactionLedger";
import { SipHealthCard, type SipHealth } from "@/components/investors/SipHealthCard";
import { ExpectedInflowsCard } from "@/components/investors/ExpectedInflowsCard";
import { CrossSellCard } from "@/components/investors/CrossSellCard";
import { RelatedModulesRail } from "@/components/investors/RelatedModulesRail";
import { InvestorDocumentsSection } from "@/components/investors/InvestorDocumentsSection";
import { InvestorAvatarEditor } from "@/components/investors/InvestorAvatarEditor";
import { EmailRelatedList } from "@/components/comms/EmailRelatedList";
import { WhatsAppRelatedList } from "@/components/comms/WhatsAppRelatedList";
import { InvestorDetailTabs } from "@/components/investors/InvestorDetailTabs";
import { MasterRecordEditor } from "@/components/investors/MasterRecordEditor";
import { InlineEditField, type InlineEditSpec } from "@/components/investors/InlineEditField";
import { BlueprintStatusKV } from "@/components/investors/BlueprintStatusKV";
import { ReviewCadenceEditor } from "@/components/investors/ReviewCadenceEditor";
import { PortalAccessButton } from "@/components/investors/PortalAccessButton";
import { RecordBusinessImpact } from "@/components/investors/RecordBusinessImpact";
import { ClientReadinessStrip } from "@/components/investors/ClientReadinessStrip";
import { PanReveal } from "@/components/investors/PanReveal";
import { crossSellOpportunities } from "@/lib/investors/cross-sell";
import { HoldingsTable } from "@/components/investors/HoldingsTable";
import { CompletenessCard } from "@/components/investors/CompletenessCard";
import { SuitabilityCard } from "@/components/investors/SuitabilityCard";
import { KycDataViewer } from "@/components/investors/KycDataViewer";
import { clientCompleteness } from "@/lib/investors/completeness";
import { assetClassExposure } from "@/lib/investors/asset-class";
import { assessSuitability } from "@/lib/investors/suitability";
import {
  RelatedListsContainer,
  RelatedListsManager,
  RelatedListSection,
  type RelatedListDef,
} from "@/components/common/RelatedLists";

const INVESTOR_DETAIL_SECTIONS: RelatedListDef[] = [
  { key: "header", label: "Client header & contact", required: true },
  { key: "health", label: "Client health score" },
  { key: "recommended", label: "Recommended actions" },
  { key: "summary", label: "Risk / nominee / KYC / review summary" },
  { key: "nominees", label: "Nominees" },
  { key: "referrals", label: "Referrals" },
  { key: "family", label: "Family snapshot" },
  { key: "valuation", label: "Portfolio valuation" },
  { key: "holdings", label: "Holdings" },
  { key: "churn", label: "Churn-risk scorecard" },
  { key: "allocation", label: "Portfolio allocation" },
  { key: "sip_health", label: "SIP health" },
  { key: "transactions", label: "Transaction history" },
  { key: "cross_sell", label: "Cross-sell / holdings" },
  { key: "expected_inflows", label: "Expected inflows" },
  { key: "notes", label: "Notes" },
  { key: "documents", label: "Documents & attachments" },
  { key: "emails", label: "Emails" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "gifts", label: "Birthday gifts & budget" },
  { key: "blueprint", label: "Onboarding blueprint" },
  { key: "completeness", label: "Profile completeness" },
  { key: "kyc_data", label: "Captured KYC data" },
  { key: "master", label: "Client details" },
  { key: "risk_history", label: "Risk profile history" },
  { key: "task_log", label: "Task history (all)" },
  { key: "sr_log", label: "Service request history (all)" },
  { key: "meeting_log", label: "Meeting history (all)" },
  { key: "related", label: "Folios · SIPs · Goals · Tasks · SRs · Consent" },
];

/** Tab groups for the client-detail page — the header stays pinned above. */
const INVESTOR_DETAIL_TABS = [
  { key: "overview", label: "Overview", sections: ["health", "recommended", "summary"] },
  { key: "portfolio", label: "Portfolio", sections: ["valuation", "holdings", "churn", "allocation", "sip_health", "transactions", "expected_inflows", "cross_sell"] },
  { key: "profile", label: "KYC & Profile", sections: ["nominees", "referrals", "custom_fields", "master"] },
  { key: "engagement", label: "Engagement", sections: ["family", "notes", "documents", "emails", "whatsapp", "gifts", "blueprint", "related"] },
  // Rarely-opened detail — tucked behind "More" so the core tabs stay uncluttered.
  { key: "more", label: "More", sections: ["completeness", "kyc_data", "risk_history", "task_log", "sr_log", "meeting_log"] },
];

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InvestorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Guard against malformed links (e.g. /dashboard/investors/undefined produced
  // by an empty-state dashboard widget): bounce to the clients list instead of a
  // dead-end 404 (and avoid the "invalid uuid" DB error a non-uuid id would throw).
  if (!id || !UUID_RE.test(id)) {
    redirect("/dashboard/investors");
  }
  const session = await requireSession();
  const license = await loadTenantLicense(session.tenantId, session.roles);

  const showPan = isFieldAllowed(license, "investor", "pan");
  const showDob = isFieldAllowed(license, "investor", "dob");
  const showPhone = isFieldAllowed(license, "investor", "phone");
  const showEmail = isFieldAllowed(license, "investor", "email");
  const showCity = isFieldAllowed(license, "investor", "city");
  const showState = isFieldAllowed(license, "investor", "state");
  const showPincode = isFieldAllowed(license, "investor", "pincode");
  const showAddress = isFieldAllowed(license, "investor", "address") || showCity || showState || showPincode;
  const showCategory = isFieldAllowed(license, "investor", "investor_category");
  const showSegment = isFieldAllowed(license, "investor", "segment_tag") || isFieldAllowed(license, "investor", "segment");
  const showStatus = isFieldAllowed(license, "investor", "status");
  const showAum = isFieldAllowed(license, "investor", "aum");
  const showSip = isFieldAllowed(license, "investor", "active_sip_amount") || isFieldAllowed(license, "investor", "sip");
  const showInflow = isFieldAllowed(license, "investor", "lifetime_inflow");
  const showKyc = isFieldAllowed(license, "investor", "kyc_status") || isFieldAllowed(license, "investor", "kyc");
  const showCkycExpiry = isFieldAllowed(license, "investor", "ckyc_expiry_at") || isFieldAllowed(license, "investor", "ckyc");
  const showRisk = isFieldAllowed(license, "investor", "risk_profile") || isFieldAllowed(license, "investor", "risk");
  const showNominee = isFieldAllowed(license, "investor", "nominee_name") || isFieldAllowed(license, "investor", "nominee");
  const showBank = isFieldAllowed(license, "investor", "bank_account_number_masked") || isFieldAllowed(license, "investor", "bank");
  const showRm = isFieldAllowed(license, "investor", "rm_id") || isFieldAllowed(license, "investor", "rm");

  // A malformed link (e.g. /dashboard/investors/undefined) must 404 cleanly,
  // not crash with a uuid cast error. Guard before any DB lookup by id.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    notFound();
  }

  const data = await withTenant(session.tenantId, async (tx) => {
    const inv = (await tx.select().from(investors).where(eq(investors.id, id)).limit(1))[0];
    if (!inv) return null;
    // Soft-deleted clients live in the Trash bin, not on the detail page.
    if ((inv as any).deletedAt) return null;

    const [foliosRows, sipsRows, goalsRows, commsRows, tasksRows, srRows, consentsRows, taskLogRows, srLogRows, serviceRmRow, rmRow, familyRow, lumpsumSum, valuation, reviewMeetingsRows, meetingLogRows, riskHistoryRows, recentTxRows, txCountRow, sipBouncesRow] = await Promise.all([
      tx.select().from(folios).where(eq(folios.investorId, id)),
      tx.select().from(sips).where(eq(sips.investorId, id)),
      tx.select().from(goals).where(eq(goals.investorId, id)),
      tx
        .select()
        .from(communications)
        .where(eq(communications.investorId, id))
        .orderBy(desc(communications.createdAt))
        .limit(20),
      tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.subjectId, id), eq(tasks.subjectType, "investor"), isNull(tasks.deletedAt)))
        .limit(20),
      tx.select().from(serviceRequests).where(eq(serviceRequests.investorId, id)).limit(20),
      tx.select().from(consents).where(eq(consents.investorId, id)),
      tx
        .select({
          id: tasks.id,
          title: tasks.title,
          type: tasks.type,
          status: tasks.status,
          priority: tasks.priority,
          dueAt: tasks.dueAt,
          completedAt: tasks.completedAt,
          createdAt: tasks.createdAt,
          assigneeName: sql<string | null>`(SELECT u.name FROM users u WHERE u.id = ${tasks.assigneeId})`,
        })
        .from(tasks)
        .where(and(eq(tasks.subjectId, id), eq(tasks.subjectType, "investor"), isNull(tasks.deletedAt)))
        .orderBy(desc(tasks.createdAt))
        .limit(100),
      tx
        .select({
          id: serviceRequests.id,
          ticketNo: serviceRequests.ticketNo,
          subject: serviceRequests.subject,
          type: serviceRequests.type,
          status: serviceRequests.status,
          priority: serviceRequests.priority,
          createdAt: serviceRequests.createdAt,
          resolvedAt: serviceRequests.resolvedAt,
          assigneeName: sql<string | null>`(SELECT u.name FROM users u WHERE u.id = ${serviceRequests.assignedToUserId})`,
        })
        .from(serviceRequests)
        .where(eq(serviceRequests.investorId, id))
        .orderBy(desc(serviceRequests.createdAt))
        .limit(100),
      inv.serviceRmId
        ? tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, inv.serviceRmId)).limit(1).then((r) => r[0] ?? null)
        : Promise.resolve(null),
      inv.rmId
        ? tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, inv.rmId)).limit(1).then((r) => r[0] ?? null)
        : Promise.resolve(null),
      inv.familyId
        ? tx.select().from(families).where(eq(families.id, inv.familyId)).limit(1).then((r) => r[0] ?? null)
        : Promise.resolve(null),
      tx.execute(sql`
        SELECT COALESCE(SUM(amount::numeric), 0)::numeric AS total
        FROM transactions
        WHERE investor_id = ${id} AND type = 'lumpsum' AND status IN ('processed', 'successful')
      `).then((r) => Number((r.rows[0] as any)?.total ?? 0)),
      // Live portfolio valuation (units × latest AMFI NAV + XIRR).
      valueInvestor(tx, id),
      tx.select().from(reviewMeetings).where(eq(reviewMeetings.investorId, id)),
      tx
        .select({
          id: reviewMeetings.id,
          subject: reviewMeetings.subject,
          meetingType: reviewMeetings.meetingType,
          meetingMode: reviewMeetings.meetingMode,
          locationOrLink: reviewMeetings.locationOrLink,
          meetingDate: reviewMeetings.meetingDate,
          status: reviewMeetings.status,
          outcome: reviewMeetings.outcome,
          nextReviewDate: reviewMeetings.nextReviewDate,
          // createdById superseded rmId; fall back so historical rows still
          // show who ran the meeting rather than an em dash.
          heldBy: sql<string | null>`(SELECT u.name FROM users u
             WHERE u.id = COALESCE(${reviewMeetings.createdById}, ${reviewMeetings.rmId}))`,
        })
        .from(reviewMeetings)
        .where(eq(reviewMeetings.investorId, id))
        .orderBy(desc(reviewMeetings.meetingDate))
        .limit(100),
      tx
        .select()
        .from(riskProfileResponses)
        .where(eq(riskProfileResponses.investorId, id))
        .orderBy(desc(riskProfileResponses.signedAt)),
      // Recent transaction ledger — most-recent first (order_date, then booked).
      tx
        .select()
        .from(transactions)
        .where(eq(transactions.investorId, id))
        .orderBy(sql`${transactions.orderDate} desc nulls last`, desc(transactions.createdAt))
        .limit(30),
      // Total transaction count (for the "latest N of M" label).
      tx
        .execute(sql`SELECT count(*)::int AS c FROM transactions WHERE investor_id = ${id}`)
        .then((r) => Number((r.rows[0] as any)?.c ?? 0)),
      // SIP bounces in the last 6 months (rejected/failed SIP installments).
      tx
        .execute(sql`
          SELECT count(*)::int AS c FROM transactions
          WHERE investor_id = ${id} AND type = 'sip'
            AND status IN ('rejected','failed')
            AND created_at >= now() - interval '180 days'
        `)
        .then((r) => Number((r.rows[0] as any)?.c ?? 0)),
    ]);

    // SIP health — combine recent bounces with the worst consecutive-failure
    // streak across the client's live SIPs (consecutiveFailures is text "0".."n").
    const activeSips = sipsRows.filter((s) => s.status === "active").length;
    const maxConsecutiveFailures = sipsRows.reduce(
      (m, s) => Math.max(m, parseInt((s.consecutiveFailures as any) ?? "0", 10) || 0),
      0
    );
    const monthlyCommitted = sipsRows
      .filter((s) => s.status === "active")
      .reduce((sum, s) => sum + Number(s.amount ?? 0), 0);
    const sipHealth: SipHealth = {
      activeSips,
      bounces6mo: sipBouncesRow,
      maxConsecutiveFailures,
      monthlyCommitted,
    };

    // Related-modules counts (rail): insurance policies held + referrals this
    // client has made (leads referred_by this investor).
    const insuranceCount = Number(
      ((await tx.execute(sql`SELECT count(*)::int AS c FROM insurance_policies WHERE investor_id = ${id}`)).rows[0] as any)?.c ?? 0
    );
    const referralCount = Number(
      ((await tx.execute(sql`SELECT count(*)::int AS c FROM leads WHERE referred_by_investor_id = ${id}`)).rows[0] as any)?.c ?? 0
    );

    // PII access log (DPDP)
    await tx.insert(auditLog).values({
      tenantId: session.tenantId,
      actorUserId: session.userId,
      actorType: "user",
      action: "investor.view",
      entityType: "investor",
      entityId: id,
      piiAccessed: { pan: true, dob: !!inv.dob, address: !!inv.address } as any,
      reason: "Investor 360 view",
    } as any);

    return {
      investor: inv,
      folios: foliosRows,
      sips: sipsRows,
      goals: goalsRows,
      communications: commsRows,
      tasks: tasksRows,
      serviceRequests: srRows,
      consents: consentsRows,
      rm: rmRow,
      serviceRm: serviceRmRow,
      taskLog: taskLogRows,
      srLog: srLogRows,
      family: familyRow,
      totalLumpsum: lumpsumSum,
      valuation,
      // Churn risk reuses the valuation's XIRR for the performance signal.
      churn: await churnForInvestor(tx, id, valuation.xirr),
      reviewMeetings: reviewMeetingsRows,
      meetingLog: meetingLogRows,
      riskHistory: riskHistoryRows,
      insuranceCount,
      referralCount,
      recentTransactions: recentTxRows,
      txCount: txCountRow,
      sipHealth,
    };
  }, { userId: session.userId, branchId: session.branchId, roles: session.roles });

  if (!data) notFound();

  const inv = data.investor;
  // Derived client-360 insights (all from already-loaded data).
  const completeness = clientCompleteness(inv as any);
  const exposure = assetClassExposure(data.folios as any);
  const suitability = assessSuitability((inv as any).riskProfile ?? null, exposure.equityPct, exposure.classifiedPct);
  const isRiskProfileMissing = !inv.riskProfile;

  // Next best action — one prioritised nudge surfaced as a banner in the header
  // (parity with the lead page) so the RM sees "what to do now" without hunting
  // through tabs. All inputs are already loaded above; no extra query.
  const reviewOverdue = !!inv.nextReviewAt && new Date(inv.nextReviewAt as any).getTime() < Date.now();
  // Setup gaps (KYC, profile completeness) are the readiness strip's job — this
  // banner only surfaces BUSINESS nudges, so the header never stacks two setup
  // messages on top of each other.
  const clientNext: { label: string; hint: string; href?: string; cta?: string } | null =
    reviewOverdue
      ? { label: "Portfolio review is overdue", hint: `Was due ${formatDate(inv.nextReviewAt as any)}`, href: "/dashboard/review-meetings/new", cta: "Schedule" }
      : showSip && Number(inv.activeSipAmount ?? 0) === 0
      ? { label: "No active SIP", hint: "Propose a SIP to deepen the relationship", href: "/dashboard/proposals/new", cta: "Propose" }
      : null;
  const isRiskProfileExpired = inv.riskProfileSignedAt
    ? new Date(inv.riskProfileSignedAt).getTime() < Date.now() - 365 * 24 * 60 * 60 * 1000
    : false;

  // Related Modules rail — collections with live counts + jump-to-section.
  const relatedItems = [
    { label: "Holdings", selector: "#rel-folios", count: data.valuation.holdings.length },
    { label: "Active SIPs", selector: "#rel-sips", count: data.sips.filter((s: any) => s.status === "active").length },
    { label: "Goals", selector: "#rel-goals", count: data.goals.length },
    { label: "Transactions", selector: '[data-rl-section="transactions"]', count: data.txCount },
    { label: "Cross-sell opportunities", selector: '[data-rl-section="cross_sell"]', count: crossSellOpportunities((inv as any).crossSell).length },
    { label: "Open tasks", selector: "#rel-tasks", count: data.tasks.filter((t: any) => t.status === "open").length, createHref: "/dashboard/tasks/new" },
    { label: "Service requests", selector: "#rel-srs", count: data.serviceRequests.filter((s: any) => s.status !== "closed" && s.status !== "resolved").length },
    { label: "Risk-profile history", selector: '[data-rl-section="risk_history"]', count: (data as any).riskHistory?.length ?? 0 },
    { label: "Family", selector: '[data-rl-section="family"]' },
    { label: "Portfolio allocation", selector: '[data-rl-section="allocation"]' },
    { label: "Client details", selector: '[data-rl-section="master"]' },
    // Off-page modules — navigate to the relevant module (scoped where possible).
    { label: "Insurance Tracker", href: `/dashboard/insurance?q=${encodeURIComponent(inv.name)}`, count: (data as any).insuranceCount ?? 0 },
    { label: "Referrals (by client)", href: "/dashboard/leads", count: (data as any).referralCount ?? 0 },
    { label: "Documents", href: "/dashboard/documents" },
  ];

  // Lifecycle-aware layout: a brand-new / onboarding client (no holdings, no
  // transactions, no booked AUM) gets the portfolio-centric sections hidden so
  // the page leads with onboarding/KYC/risk instead of five empty ₹0 cards.
  // Any client with real holdings or history sees everything as before.
  const hasPortfolio =
    (data.valuation?.holdings?.length ?? 0) > 0 ||
    data.txCount > 0 ||
    data.folios.length > 0 ||
    Number(inv.aum ?? 0) > 0;

  return (
    <div className="max-w-7xl space-y-4">
      <RelatedModulesRail items={relatedItems} />
      <div className="flex items-center justify-between">
        <Link
          href="/dashboard/investors"
          className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
        >
          <ChevronLeft className="size-4" /> Back to investors
        </Link>
        <div className="flex items-center gap-2">
          <RelatedListsManager
            moduleKey="investors-detail"
            sections={INVESTOR_DETAIL_SECTIONS}
          />
          <QuickCommsPanel
            investorId={inv.id}
            investorName={inv.name}
          />
          <Link
            href={`/dashboard/investors/${inv.id}/review-report`}
            className="text-xs rounded-md border px-2.5 py-1 hover:bg-accent"
          >
            📄 Quarterly Review Report
          </Link>
        </div>
      </div>

      {/* Consolidated onboarding & compliance readiness — replaces the lone risk
          banner + scattered KYC/nominee/bank signals with one gap list. */}
      <ClientReadinessStrip
        investorId={inv.id}
        kyc={showKyc ? inv.kycStatus === "verified" : null}
        risk={showRisk ? (isRiskProfileMissing ? "missing" : isRiskProfileExpired ? "expired" : "ok") : null}
        nominee={showNominee ? !!inv.nomineeName : null}
        bank={showBank ? !!(inv.bankAccountNumberMasked || inv.bankName) : null}
        emailVerified={inv.email ? !!inv.emailVerifiedAt : null}
        phoneVerified={inv.phone ? !!inv.phoneVerifiedAt : null}
      />

      <RelatedListsContainer>
      {/* Header */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="header">
      <div className="border rounded-lg bg-card p-6">
        <div className="flex items-start gap-4">
          <InvestorAvatarEditor investorId={inv.id} name={inv.name} hasAvatar={!!inv.avatarUrl} size={64} />
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{inv.name}</h1>
            <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
              {showPan && inv.pan && <PanReveal pan={inv.pan} />}
              {showSegment && inv.segmentTag && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">
                  {inv.segmentTag}
                </span>
              )}
              {/* Book tags — which distributor this client came through. Beside
                  the segment chip because it is the same kind of fact. */}
              {(((inv as any).tags as string[] | null) ?? []).map((t) => (
                <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-brand-cyan-light text-brand-cyan-deep font-medium">
                  {t}
                </span>
              ))}
              {/* KYC status intentionally omitted here — it lives in the
                  "Onboarding & compliance readiness" strip below (no duplication). */}
              <span className="text-xs">Onboarded {inv.onboardedAt ? formatDate(inv.onboardedAt) : "—"}</span>
              <BestTimeBadge session={{ tenantId: session.tenantId, userId: session.userId, branchId: session.branchId, roles: session.roles }} investorId={inv.id} />
            </div>
            <div className="flex gap-3 mt-3 text-sm">
              {showPhone && inv.phone && (
                <a href={`tel:${inv.phone}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                  <Phone className="size-4" /> {formatPhone(inv.phone)}
                  {!isValidIndianMobile(inv.phone) && (
                    <span
                      title="This doesn't look like a valid 10-digit Indian mobile number"
                      className="inline-flex items-center text-amber-600"
                    >
                      <AlertTriangle className="size-3.5" />
                    </span>
                  )}
                </a>
              )}
              {showEmail && inv.email && (
                <a href={`mailto:${inv.email}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                  <Mail className="size-4" /> {inv.email}
                </a>
              )}
              {showPhone && inv.whatsappPhone && (
                <a
                  href={`https://wa.me/${inv.whatsappPhone.replace(/[^\d]/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  <MessageCircle className="size-4" /> WhatsApp
                </a>
              )}
              {showAddress && inv.address && (inv.address as any).city && (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <MapPin className="size-4" /> {(inv.address as any).city}, {(inv.address as any).state}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {/* Primary action — the thing an RM does most from this page */}
              <LogActivityButton subject={{ type: "investor", id: inv.id, name: inv.name, phone: inv.phone }} label="Log call / visit" variant="primary" />
              <OnboardingWizardButton
                investorId={inv.id}
                investor={{
                  email: inv.email, phone: inv.phone, whatsappPhone: inv.whatsappPhone,
                  kycStatus: inv.kycStatus, panAadhaarLinkStatus: inv.panAadhaarLinkStatus, nameAsPerPan: inv.nameAsPerPan,
                  riskProfile: inv.riskProfile, nomineeName: inv.nomineeName, nomineeRelation: inv.nomineeRelation,
                  bankName: inv.bankName, bankAccountNumberMasked: inv.bankAccountNumberMasked, bankIfsc: inv.bankIfsc,
                }}
              />
              {/* Everything else lives under one "More" menu — ONE primary action
                  (Log call / visit) keeps the header calm and obvious. */}
              <OverflowMenu>
                <AiClientBrief investorId={inv.id} name={inv.name} phone={inv.phone} />
                <PortalAccessButton investorId={inv.id} />
                <RecordBusinessImpact investorId={inv.id} />
                <CheckInButton subject={{ type: "investor", id: inv.id, name: inv.name, phone: inv.phone }} />
                <ChangeLogButton entityType="investor" entityId={inv.id} />
                <VerifyContact
                  investorId={inv.id}
                  hasEmail={!!inv.email}
                  hasPhone={!!inv.phone}
                  emailVerified={!!inv.emailVerifiedAt}
                  phoneVerified={!!inv.phoneVerifiedAt}
                />
                <RowActions
                  inline
                  deleteUrl={`/api/investors/${inv.id}`}
                  itemLabel="client"
                  itemName={inv.name}
                  verb="Delete"
                  redirectTo="/dashboard/investors"
                />
              </OverflowMenu>
              <RecordProvenance
                entityType="investor"
                entityId={inv.id}
                createdAt={inv.createdAt}
                updatedAt={inv.updatedAt}
                className="basis-full mt-1"
              />
            </div>
          </div>
          {/* AUM / Active SIP / Lifetime inflow moved out of the header into the
              Portfolio tab (see the "valuation" section) for a simpler profile. */}
        </div>
      </div>
      </RelatedListSection>

      {/* Next best action — one prioritised nudge, up top, so the RM knows what
          to do now without scrolling (parity with the lead page). */}
      {clientNext && (
        <div className="flex items-center gap-3 rounded-lg border border-brand-cyan/25 bg-brand-cyan-light/40 px-4 py-2.5">
          <Sparkles className="size-4 text-brand-cyan-deep shrink-0" />
          <div className="min-w-0 flex-1 text-sm">
            <span className="font-semibold text-foreground">Next: {clientNext.label}</span>
            {clientNext.hint && <span className="text-muted-foreground"> — {clientNext.hint}</span>}
          </div>
          {clientNext.href && (
            <Link href={clientNext.href} className="btn-primary text-xs inline-flex items-center gap-1 shrink-0 whitespace-nowrap">
              {clientNext.cta} <ArrowRight className="size-3.5" />
            </Link>
          )}
        </div>
      )}

      {/* Category tabs — group the sections so the page shows one clean group at
          a time. Renders right under the header (which stays pinned). */}
      <InvestorDetailTabs moduleKey="investors-detail" tabs={INVESTOR_DETAIL_TABS} />

      {/* Composite health score — derived from existing fields, no extra query */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="health">
        <ClientHealthCard
          investor={inv as any}
          hasOpenSrBreach={data.serviceRequests.some(
            (sr) =>
              (sr.status === "open" || sr.status === "in_progress") &&
              sr.slaResolutionAt != null &&
              new Date(sr.slaResolutionAt as any).getTime() < Date.now()
          )}
        />
      </RelatedListSection>

      {/* Next-Best-Action recommendations for this client */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="recommended">
      <RecommendedActions
        session={{ tenantId: session.tenantId, userId: session.userId, branchId: session.branchId, roles: session.roles }}
        investorId={inv.id}
        name={inv.name}
        phone={inv.phone}
        email={inv.email}
      />
      </RelatedListSection>

      {/* Risk + meta — at-a-glance status */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="summary">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {showRisk && <InfoCard label="Risk profile" value={inv.riskProfile ?? "Not assessed"} sub={inv.riskProfileSignedAt ? `Signed ${formatDate(inv.riskProfileSignedAt)}` : "Pending"} tone={!inv.riskProfile ? "warn" : undefined} />}
          {showNominee && <InfoCard label="Nominee" value={inv.nomineeName ?? "Not set"} sub={inv.nomineeRelation ?? undefined} tone={!inv.nomineeName ? "warn" : undefined} />}
          {showCkycExpiry && <InfoCard label="CKYC expiry" value={inv.ckycExpiryAt ? formatDate(inv.ckycExpiryAt) : "—"} sub={inv.ckycNumber ?? undefined} />}
          <InfoCard label="Last review" value={inv.lastReviewAt ? formatRelative(inv.lastReviewAt) : "Never"} sub={inv.nextReviewAt ? `Next: ${formatDate(inv.nextReviewAt)}` : undefined} tone={!inv.lastReviewAt ? "warn" : undefined} />
        </div>
        {/* Set review cadence (preset or custom days) → drives the review-due reminder */}
        <div className="mt-4">
          <ReviewCadenceEditor
            investorId={inv.id}
            reviewFrequency={(inv.reviewFrequency as any) ?? null}
            reviewFrequencyDays={(inv as any).reviewFrequencyDays ?? null}
            lastReviewAt={inv.lastReviewAt ? new Date(inv.lastReviewAt).toISOString() : null}
            nextReviewAt={inv.nextReviewAt ? new Date(inv.nextReviewAt).toISOString() : null}
          />
        </div>
      </RelatedListSection>

      {/* Nominees — dedicated, editable section (multi-nominee) */}
      {showNominee && (
        <RelatedListSection moduleKey="investors-detail" sectionKey="nominees">
          <NomineeSection
            investorId={inv.id}
            nominees={((inv.nominees as any[]) ?? []) as any}
            legacy={{
              name: inv.nomineeName,
              relation: inv.nomineeRelation,
              dob: inv.nomineeDob ? String(inv.nomineeDob) : null,
            }}
          />
        </RelatedListSection>
      )}

      {/* Referrals — dedicated, editable section (multi-referral) */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="referrals">
        <ReferralSection investorId={inv.id} referrals={((inv.referrals as any[]) ?? []) as any} />
      </RelatedListSection>

      {/* MFD-defined custom fields — KYC & Profile tab only (renders only if the
          firm has defined any). */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="custom_fields">
        <CustomFieldsCard entity="investor" recordId={inv.id} initialValues={(inv as any).customFields ?? null} />
      </RelatedListSection>

      {/* Family snapshot — only renders when familyId is set */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="family">
        <FamilySnapshot
          session={session}
          familyId={inv.familyId ?? null}
          familyName={data.family?.familyName ?? null}
          currentInvestorId={inv.id}
        />
      </RelatedListSection>

      {/* Empty Portfolio tab — instead of a blank tab, point the RM at how to
          load holdings (RTA statement import). Lives in the Portfolio tab. */}
      {!hasPortfolio && (
        <RelatedListSection moduleKey="investors-detail" sectionKey="valuation">
          <div className="rounded-lg border border-dashed bg-muted/20 px-6 py-10 text-center">
            <Wallet className="size-8 mx-auto text-muted-foreground/60" />
            <div className="mt-3 text-sm font-medium">No portfolio yet</div>
            <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
              This client has no holdings or transactions loaded. Import their folios from a
              CAMS / KFintech statement to see live valuation, XIRR and SIP health here.
            </p>
            <Link href="/dashboard/rta-imports" className="btn-primary text-xs mt-4 inline-flex items-center gap-1">
              Import their portfolio <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </RelatedListSection>
      )}

      {/* Portfolio-centric sections — hidden for onboarding-phase clients with
          no holdings/transactions so the page isn't a wall of empty ₹0 cards.
          Cross-sell stays visible below (useful even pre-investment). */}
      {hasPortfolio && (
        <>
          {/* Live portfolio valuation — units × latest AMFI NAV + XIRR */}
          {showAum && data.valuation && (
            <RelatedListSection moduleKey="investors-detail" sectionKey="valuation">
            <div className="space-y-2">
              {/* AUM / Active SIP / Lifetime inflow — relocated here from the
                  header so the profile stays clean and the money lives on the
                  Portfolio tab next to the live valuation. */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
                <HeaderKpi
                  label="AUM"
                  value={showAum ? formatINR(Math.max(Number(inv.aum ?? 0), data.valuation?.currentValue ?? 0)) : "—"}
                  primary
                  sub={showAum && !hasPortfolio ? "No investments yet" : undefined}
                />
                <HeaderKpi
                  label="Active SIP"
                  value={showSip ? formatINR(Number(inv.activeSipAmount ?? 0)) + (showSip && Number(inv.activeSipAmount ?? 0) > 0 ? "/mo" : "") : "—"}
                  sub={showSip && Number(inv.activeSipAmount ?? 0) === 0 ? "No active SIP" : undefined}
                />
                <HeaderKpi
                  label="Lifetime inflow"
                  value={showInflow ? formatINR(Number(inv.lifetimeInflow ?? 0)) : "—"}
                  sub={showInflow && Number(inv.lifetimeInflow ?? 0) === 0 ? "Awaiting first inflow" : undefined}
                />
              </div>
              <StatementActions investorId={inv.id} statementCadence={(inv as any).statementCadence ?? "off"} />
              <WealthStoryButton investorId={inv.id} clientName={inv.name} />
            </div>
            </RelatedListSection>
          )}

          {/* Per-scheme holdings — full tabular breakdown, on the Portfolio tab
              (moved here from the Engagement "related" group). */}
          <RelatedListSection moduleKey="investors-detail" sectionKey="holdings">
            <div id="rel-folios" className="scroll-mt-24">
              <HoldingsTable
                holdings={data.valuation.holdings as any}
                asOf={data.valuation.asOf}
                unpricedSchemes={data.valuation.unpricedSchemes}
              />
            </div>
          </RelatedListSection>

          {/* Churn-risk scorecard + AI retention play */}
          {showAum && data.churn && (
            <RelatedListSection moduleKey="investors-detail" sectionKey="churn">
            <ChurnRiskCard
              investorId={inv.id}
              result={data.churn}
              name={inv.name}
              serviceTier={inv.serviceTier}
              currentValueInr={data.valuation?.currentValue ?? Number(inv.aum ?? 0)}
            />
            </RelatedListSection>
          )}

          {/* Portfolio allocation — derives from already-loaded folios */}
          <RelatedListSection moduleKey="investors-detail" sectionKey="allocation">
            <div className="space-y-2">
              <PortfolioAllocation folios={data.folios as any} />
              {showRisk && <SuitabilityCard suitability={suitability} />}
            </div>
          </RelatedListSection>

          {/* SIP-bounce health — early churn signal from rejected SIP installments */}
          <RelatedListSection moduleKey="investors-detail" sectionKey="sip_health">
            <SipHealthCard health={data.sipHealth} />
          </RelatedListSection>

          {/* Transaction ledger — recent purchases / redemptions / SIPs / switches */}
          <RelatedListSection moduleKey="investors-detail" sectionKey="transactions">
            <TransactionLedger transactions={data.recentTransactions as any} total={data.txCount} />
          </RelatedListSection>
        </>
      )}

      {/* Cross-sell / product-holdings matrix — wallet-share opportunities.
          Shown for every client (recording what they hold elsewhere is useful
          before they've invested a rupee with us). */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="expected_inflows">
        <ExpectedInflowsCard investorId={inv.id} />
      </RelatedListSection>

      <RelatedListSection moduleKey="investors-detail" sectionKey="cross_sell">
        <CrossSellCard investorId={inv.id} initial={(inv as any).crossSell ?? null} />
      </RelatedListSection>

      {/* Documents & attachments — RM-uploaded files + auto-ingested client
          uploads from the required-documents form (same compliance_documents
          rows, linked to this investor). Self-fetching island. */}
      {/* Running note log — one row per note, attributed and timestamped.
          Self-fetching island, so it never blocks the page render. */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="notes">
        <ClientNotes investorId={inv.id} />
      </RelatedListSection>

      <RelatedListSection moduleKey="investors-detail" sectionKey="documents">
        <InvestorDocumentsSection investorId={inv.id} investorName={inv.name} investorPhone={inv.phone} investorEmail={inv.email} />
      </RelatedListSection>

      <RelatedListSection moduleKey="investors-detail" sectionKey="emails">
        <EmailRelatedList entityType="investor" entityId={inv.id} entityName={inv.name} entityEmail={inv.email} />
      </RelatedListSection>

      <RelatedListSection moduleKey="investors-detail" sectionKey="whatsapp">
        <WhatsAppRelatedList entityType="investor" entityId={inv.id} entityName={inv.name} entityPhone={inv.whatsappPhone ?? inv.phone} />
      </RelatedListSection>

      <RelatedListSection moduleKey="investors-detail" sectionKey="gifts">
        <ClientGifts investorId={inv.id} clientName={inv.name} />
      </RelatedListSection>

      {/* Client-phase onboarding bar — stages 13-15: Operations → Portal
          Welcome → Active Client. Auto-hides for investors that weren't
          created from a lead (no source blueprint). */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="blueprint">
        <InvestorBlueprintStageBar investorId={inv.id} />
      </RelatedListSection>

      {/* Profile completeness + any extra KYC captured from the onboarding link */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="completeness">
      <CompletenessCard completeness={completeness} />
      </RelatedListSection>
      <RelatedListSection moduleKey="investors-detail" sectionKey="kyc_data">
      <KycDataViewer kycData={(inv as any).kycData ?? null} />
      </RelatedListSection>

      {/* Full task ledger -- every task ever raised on this client, not just the
          open ones in the side panel. Who it went to, when, and how it ended. */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="task_log">
        <div className="border rounded-lg bg-card">
          <div className="border-b px-4 py-2.5 font-medium flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <ClipboardList className="size-4" /> Tasks
              <span className="text-xs text-muted-foreground font-normal">({data.taskLog.length})</span>
            </span>
            <Link href="/dashboard/tasks/new" className="text-xs text-brand-cyan-deep hover:underline font-medium">
              New task →
            </Link>
          </div>
          {data.taskLog.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">No tasks raised for this client.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground bg-muted/40">
                  <tr>
                    <th className="text-left font-medium px-4 py-2">Task</th>
                    <th className="text-left font-medium px-3 py-2">Assigned to</th>
                    <th className="text-left font-medium px-3 py-2">Created</th>
                    <th className="text-left font-medium px-3 py-2">Due</th>
                    <th className="text-left font-medium px-3 py-2">Completed</th>
                    <th className="text-left font-medium px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.taskLog.map((t: any) => (
                    <tr key={t.id} className="hover:bg-accent/30">
                      <td className="px-4 py-2">
                        <Link href={`/dashboard/tasks?focus=${t.id}`} className="font-medium hover:underline">
                          {t.title}
                        </Link>
                        <div className="text-[11px] text-muted-foreground">
                          {[t.type, t.priority].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td className="px-3 py-2">{t.assigneeName ?? "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{t.createdAt ? formatDate(t.createdAt) : "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{t.dueAt ? formatDate(t.dueAt) : "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{t.completedAt ? formatDate(t.completedAt) : "—"}</td>
                      <td className="px-3 py-2 capitalize whitespace-nowrap">{String(t.status ?? "").replace(/_/g, " ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </RelatedListSection>

      {/* Every meeting held with this client. The activity timeline shows
          meetings mixed in with calls, emails and tickets; this is the meeting
          record on its own, with the outcome and what it set up next. */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="meeting_log">
        <div className="border rounded-lg bg-card">
          <div className="border-b px-4 py-2.5 font-medium flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <CalendarClock className="size-4" /> Meetings
              <span className="text-xs text-muted-foreground font-normal">({data.meetingLog.length})</span>
            </span>
            <Link
              href={`/dashboard/review-meetings/new?investorId=${inv.id}`}
              className="text-xs text-brand-cyan-deep hover:underline font-medium"
            >
              Schedule →
            </Link>
          </div>
          {data.meetingLog.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">
              No meetings recorded with this client yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground bg-muted/40">
                  <tr>
                    <th className="text-left font-medium px-4 py-2">Meeting</th>
                    <th className="text-left font-medium px-3 py-2">Held by</th>
                    <th className="text-left font-medium px-3 py-2">Date</th>
                    <th className="text-left font-medium px-3 py-2">Outcome</th>
                    <th className="text-left font-medium px-3 py-2">Next review</th>
                    <th className="text-left font-medium px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.meetingLog.map((m: any) => (
                    <tr key={m.id} className="hover:bg-accent/30">
                      <td className="px-4 py-2">
                        <Link href={`/dashboard/review-meetings/${m.id}`} className="font-medium hover:underline">
                          {m.subject || "Meeting"}
                        </Link>
                        <div className="text-[11px] text-muted-foreground">
                          {[m.meetingType, m.meetingMode, m.locationOrLink]
                            .filter(Boolean)
                            .map((v: string) => String(v).replace(/_/g, " "))
                            .join(" · ") || "—"}
                        </div>
                      </td>
                      <td className="px-3 py-2">{m.heldBy ?? "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{m.meetingDate ? formatDate(m.meetingDate) : "—"}</td>
                      <td className="px-3 py-2 capitalize">
                        {m.outcome ? String(m.outcome).replace(/_/g, " ") : "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {m.nextReviewDate ? formatDate(m.nextReviewDate) : "—"}
                      </td>
                      <td className="px-3 py-2 capitalize whitespace-nowrap">
                        {String(m.status ?? "").replace(/_/g, " ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </RelatedListSection>

      {/* Same idea for tickets: the side panel shows what is still open, this
          shows the whole service history including everything already closed. */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="sr_log">
        <div className="border rounded-lg bg-card">
          <div className="border-b px-4 py-2.5 font-medium flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <LifeBuoy className="size-4" /> Service requests
              <span className="text-xs text-muted-foreground font-normal">({data.srLog.length})</span>
            </span>
            <Link href="/dashboard/service-requests" className="text-xs text-brand-cyan-deep hover:underline font-medium">
              Open module →
            </Link>
          </div>
          {data.srLog.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">No service requests for this client.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground bg-muted/40">
                  <tr>
                    <th className="text-left font-medium px-4 py-2">Ticket</th>
                    <th className="text-left font-medium px-3 py-2">Assigned to</th>
                    <th className="text-left font-medium px-3 py-2">Raised</th>
                    <th className="text-left font-medium px-3 py-2">Resolved</th>
                    <th className="text-left font-medium px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.srLog.map((r: any) => (
                    <tr key={r.id} className="hover:bg-accent/30">
                      <td className="px-4 py-2">
                        <span className="font-medium">{r.subject}</span>
                        <div className="text-[11px] text-muted-foreground">
                          #{r.ticketNo}
                          {r.type ? ` · ${String(r.type).replace(/_/g, " ")}` : ""}
                          {r.priority ? ` · ${r.priority}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2">{r.assigneeName ?? "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.createdAt ? formatDate(r.createdAt) : "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.resolvedAt ? formatDate(r.resolvedAt) : "—"}</td>
                      <td className="px-3 py-2 capitalize whitespace-nowrap">{String(r.status ?? "").replace(/_/g, " ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </RelatedListSection>

      {/* ----------------------------- Master record -----------------------------
        Every field the spec calls out under § 6 Module 4 Client Master, grouped
        logically so RM/back-office can scan it in one read.
      */}
      <RelatedListSection moduleKey="investors-detail" sectionKey="master">
      <div className="border rounded-lg bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2">
            <User2 className="size-4" /> Client details
          </h2>
          <div className="flex items-center gap-3">
            <MasterRecordEditor
              investor={JSON.parse(JSON.stringify(inv))}
              flags={{
                showDob,
                showPhone,
                showEmail,
                showAddress,
                showSegment,
                showKyc,
                showRisk,
                showNominee,
                showBank,
                showStatus,
                showRm,
                showAum,
                showSip,
                showInflow,
              }}
            />
          </div>
        </div>

        <Group title="Identity">
          <KV label="Client ID" value={inv.id} mono />
          {showPan && <KV label="PAN" value={inv.pan ?? "—"} mono />}
          <KV label="Name" value={inv.name} edit={{ id: inv.id, field: "name", value: inv.name ?? "" }} />
          <KV label="Name as per PAN" value={inv.nameAsPerPan ?? "—"} edit={{ id: inv.id, field: "nameAsPerPan", value: inv.nameAsPerPan ?? "", nullable: true }} />
          {showDob && <KV label="DOB" value={inv.dob ? formatDate(inv.dob) : "—"} edit={{ id: inv.id, field: "dob", type: "date", value: inv.dob ? String(inv.dob).slice(0, 10) : "", nullable: true }} />}
          <KV label="Gender" value={inv.gender === "M" ? "Male" : inv.gender === "F" ? "Female" : inv.gender === "O" ? "Other" : "—"} edit={{ id: inv.id, field: "gender", type: "select", options: GENDER_OPTS, value: inv.gender ?? "", nullable: true }} />
          <KV label="Marital status" value={inv.maritalStatus ?? "—"} cap />
          <KV label="Mother's name" value={inv.motherName ?? "—"} />
          <KV label="Place of birth" value={inv.birthPlace ?? "—"} />
          <KV label="Aadhaar (last 4)" value={inv.aadhaarLast4 ? `••••${inv.aadhaarLast4}` : "—"} mono edit={{ id: inv.id, field: "aadhaarLast4", value: inv.aadhaarLast4 ?? "", nullable: true, maxLength: 4, placeholder: "1234" }} />
          <KV label="Client since" value={inv.onboardedAt ? formatDate(inv.onboardedAt) : "—"} edit={{ id: inv.id, field: "onboardedAt", type: "date", value: inv.onboardedAt ? String(inv.onboardedAt).slice(0, 10) : "", nullable: true }} />
          <KV label="Anniversary" value={inv.anniversaryDate ? formatDate(inv.anniversaryDate) : "—"} edit={{ id: inv.id, field: "anniversaryDate", type: "date", value: inv.anniversaryDate ? String(inv.anniversaryDate).slice(0, 10) : "", nullable: true }} />
        </Group>

        <Group title="Contact">
          {showPhone && <KV label="Mobile" value={inv.phone ?? "—"} edit={{ id: inv.id, field: "phone", type: "tel", value: inv.phone ?? "" }} />}
          <KV label="Mobile belongs to" value={inv.mobileRelation ?? "—"} cap />
          {showPhone && <KV label="Alternate mobile" value={inv.alternatePhone ?? "—"} edit={{ id: inv.id, field: "alternatePhone", type: "tel", value: inv.alternatePhone ?? "", nullable: true }} />}
          {showEmail && <KV label="Email" value={inv.email ?? "—"} edit={{ id: inv.id, field: "email", type: "email", value: inv.email ?? "" }} />}
          <KV label="Email belongs to" value={inv.emailRelation ?? "—"} cap />
          {showPhone && <KV label="WhatsApp" value={inv.whatsappPhone ?? "—"} edit={{ id: inv.id, field: "whatsappPhone", type: "tel", value: inv.whatsappPhone ?? "" }} />}
          {showAddress && (
            <KV
              label="Address"
              value={
                inv.address
                  ? [
                      (inv.address as any).line1,
                      (inv.address as any).city,
                      (inv.address as any).state,
                      (inv.address as any).pincode,
                    ]
                      .filter(Boolean)
                      .join(", ") || "—"
                  : "—"
              }
              colSpan={2}
            />
          )}
          {showCity && <KV label="City" value={(inv.address as any)?.city ?? "—"} edit={{ id: inv.id, field: "address", addressKey: "city", address: (inv.address as any) ?? {}, value: (inv.address as any)?.city ?? "" }} />}
          {showState && <KV label="State" value={(inv.address as any)?.state ?? "—"} edit={{ id: inv.id, field: "address", addressKey: "state", address: (inv.address as any) ?? {}, value: (inv.address as any)?.state ?? "" }} />}
          {showAddress && <KV label="Pincode" value={(inv.address as any)?.pincode ?? "—"} edit={{ id: inv.id, field: "address", addressKey: "pincode", address: (inv.address as any) ?? {}, value: (inv.address as any)?.pincode ?? "" }} />}
          {showAddress && <KV label="Country" value={(inv.address as any)?.country ?? "—"} edit={{ id: inv.id, field: "address", addressKey: "country", address: (inv.address as any) ?? {}, value: (inv.address as any)?.country ?? "" }} />}
        </Group>

        <Group title="Profile">
          <KV label="Occupation" value={inv.occupation ?? "—"} edit={{ id: inv.id, field: "occupation", value: inv.occupation ?? "", nullable: true }} />
          <KV label="Employer" value={inv.employerName ?? "—"} edit={{ id: inv.id, field: "employerName", value: inv.employerName ?? "", nullable: true }} />
          <KV label="Income range" value={inv.incomeRange ?? "—"} edit={{ id: inv.id, field: "incomeRange", value: inv.incomeRange ?? "", nullable: true, placeholder: "e.g. 10–25L" }} />
          <KV label="Entity type" value={(inv.investorCategory ?? "—").replace("corporate", "Company")} cap edit={{ id: inv.id, field: "investorCategory", type: "select", options: ENTITY_OPTS, value: inv.investorCategory ?? "" }} />
          {showSegment && <KV label="Client type" value={inv.segmentTag ?? "—"} edit={{ id: inv.id, field: "segmentTag", type: "select", options: SEGMENT_OPTS, value: inv.segmentTag ?? "" }} />}
          <KV label="Client category" value={inv.clientCategory ?? "—"} edit={{ id: inv.id, field: "clientCategory", type: "select", options: CATEGORY_OPTS, value: inv.clientCategory ?? "", nullable: true }} />
          <KV label="Mode of holding" value={inv.modeOfHolding ?? "—"} cap />
          <KV label="Household type" value={inv.householdType ?? "—"} />
          <KV label="Family head name" value={inv.familyOwnerName ?? "—"} />
          <KV label="Referral client" value={inv.referralClientName ?? "—"} />
          {showRm && <KV label="Assigned RM" value={data.rm?.name ?? "—"} sub={data.rm?.email} />}
          {/* Servicing is often a different person from the relationship owner. */}
          {showRm && data.serviceRm && (
            <KV label="Service RM" value={data.serviceRm.name ?? "—"} sub={data.serviceRm.email} />
          )}
          <KV label="Family group" value={data.family?.familyName ?? "—"} sub={inv.familyRole ?? undefined} />
        </Group>

        <Group title="Compliance status">
          {showKyc && <Status label="KYC status" value={inv.kycStatus} good={inv.kycStatus === "verified"} />}
          <KV label="Residential status" value={inv.residencyStatus ?? "—"} cap edit={{ id: inv.id, field: "residencyStatus", type: "select", options: RESIDENCY_OPTS, value: inv.residencyStatus ?? "", nullable: true }} />
          <KV label="Tax status" value={inv.taxStatus ?? "—"} />
          <KV label="PAN–Aadhaar link" value={inv.panAadhaarLinkStatus ?? "—"} cap edit={{ id: inv.id, field: "panAadhaarLinkStatus", type: "select", options: PAN_AADHAAR_OPTS, value: inv.panAadhaarLinkStatus ?? "", nullable: true }} />
          <KV label="CKYC number" value={inv.ckycNumber ?? "—"} mono edit={{ id: inv.id, field: "ckycNumber", value: inv.ckycNumber ?? "", nullable: true }} />
          <KV label="CKYC expiry" value={inv.ckycExpiryAt ? formatDate(inv.ckycExpiryAt) : "—"} edit={{ id: inv.id, field: "ckycExpiryAt", type: "date", value: inv.ckycExpiryAt ? String(inv.ckycExpiryAt).slice(0, 10) : "", nullable: true }} />
          <KV label="KYC validated" value={inv.kycValidatedAt ? formatDate(inv.kycValidatedAt) : "—"} edit={{ id: inv.id, field: "kycValidatedAt", type: "date", value: inv.kycValidatedAt ? String(inv.kycValidatedAt).slice(0, 10) : "", nullable: true }} />
          <KV label="KRA" value={inv.kraName ?? "—"} />
          <KV label="FATCA status" value={inv.fatcaStatus ?? "—"} cap />
          <KV label="FATCA expiry" value={inv.fatcaExpiryAt ? formatDate(inv.fatcaExpiryAt) : "—"} />
          {showRisk && <Status label="Risk profile" value={inv.riskProfile ?? "not_assessed"} good={!!inv.riskProfile && !!inv.riskProfileSignedAt} />}
          {showPan && <KV label="UCC (BSE)" value={inv.bseUccCode ?? "—"} mono edit={{ id: inv.id, field: "bseUccCode", value: inv.bseUccCode ?? "", nullable: true }} />}
          {showPan && <KV label="CAN (NSE)" value={inv.nseCanCode ?? "—"} mono edit={{ id: inv.id, field: "nseCanCode", value: inv.nseCanCode ?? "", nullable: true }} />}
          {showPan && ((inv as any).uccCodes as string[] | undefined)?.length ? <KV label="Other UCCs" value={((inv as any).uccCodes as string[]).join(", ")} mono /> : null}
          {/* Book codes. Inline-editable like the UCCs beside them. */}
          <KV label="MF Code" value={(inv as any).mfCode ?? "—"} mono edit={{ id: inv.id, field: "mfCode", value: (inv as any).mfCode ?? "", nullable: true }} />
          <KV label="MO Code" value={(inv as any).moCode ?? "—"} mono edit={{ id: inv.id, field: "moCode", value: (inv as any).moCode ?? "", nullable: true }} />
          <KV label="Bajaj Code" value={(inv as any).bajajCode ?? "—"} mono edit={{ id: inv.id, field: "bajajCode", value: (inv as any).bajajCode ?? "", nullable: true }} />
          <KV label="LAS" value={(inv as any).lasCode ?? "—"} mono edit={{ id: inv.id, field: "lasCode", value: (inv as any).lasCode ?? "", nullable: true }} />
          <Status label="Mandate" value={inv.mandateStatus ?? "none"} good={inv.mandateStatus === "active"} />
          <KV label="Mandate ref" value={inv.mandateRefNo ?? "—"} mono edit={{ id: inv.id, field: "mandateRefNo", value: inv.mandateRefNo ?? "", nullable: true }} />
          {inv.mandateAmount != null && <KV label="Mandate amount" value={formatINR(Number(inv.mandateAmount))} />}
        </Group>

        {showNominee && (
          <Group title="Nominee">
            {(() => {
              const noms = (inv.nominees as any[] | null) ?? [];
              if (noms.length > 0) {
                return noms.map((n, i) => (
                  <KV
                    key={i}
                    label={noms.length > 1 ? `Nominee ${i + 1}` : "Nominee"}
                    value={n?.name ?? "—"}
                    sub={[n?.relation, n?.dob ? `DOB ${formatDate(n.dob)}` : null, n?.sharePct != null ? `${n.sharePct}%` : null].filter(Boolean).join(" · ") || undefined}
                  />
                ));
              }
              return (
                <>
                  <KV label="Nominee name" value={inv.nomineeName ?? "—"} />
                  <KV label="Relationship" value={inv.nomineeRelation ?? "—"} cap />
                  <KV label="Nominee DOB" value={inv.nomineeDob ? formatDate(inv.nomineeDob) : "—"} />
                </>
              );
            })()}
          </Group>
        )}

        {showBank && (
          <Group title="Bank account">
            <KV label="Bank name" value={inv.bankName ?? "—"} />
            <KV label="Account no." value={inv.bankAccountNumberMasked ?? "—"} mono />
            <KV label="IFSC" value={inv.bankIfsc ?? "—"} mono />
            {Array.isArray(inv.bankAccounts) && (inv.bankAccounts as any[]).length > 1 &&
              (inv.bankAccounts as any[]).slice(1).map((b, i) => (
                <KV key={i} label={`Bank ${i + 2}`} value={b?.bankName ?? "—"} sub={[b?.accountMasked, b?.ifsc, b?.accountType].filter(Boolean).join(" · ") || undefined} />
              ))}
          </Group>
        )}

        {(inv.secondHolderFirstName || inv.secondHolderLastName || inv.secondHolderOccupation || inv.secondHolderCompanyName || inv.secondHolderBirthPlace || inv.secondHolderMotherName || inv.secondHolderMaritalStatus) && (
          <Group title="Second / joint holder">
            <KV label="Name" value={[inv.secondHolderFirstName, inv.secondHolderLastName].filter(Boolean).join(" ") || "—"} />
            <KV label="Occupation" value={inv.secondHolderOccupation ?? "—"} />
            <KV label="Company" value={inv.secondHolderCompanyName ?? "—"} />
            <KV label="Birth place" value={inv.secondHolderBirthPlace ?? "—"} />
            <KV label="Mother's name" value={inv.secondHolderMotherName ?? "—"} />
            <KV label="Marital status" value={inv.secondHolderMaritalStatus ?? "—"} cap />
          </Group>
        )}

        <Group title="Financials">
          {showAum && <KV label="Current AUM" value={formatINR(Number(inv.aum ?? 0))} highlight />}
          {showSip && <KV label="Monthly SIP" value={formatINR(Number(inv.activeSipAmount ?? 0))} highlight />}
          <KV label="Total lumpsum" value={formatINR(data.totalLumpsum)} sub="Successful purchases" />
          {showInflow && <KV label="Lifetime inflow" value={formatINR(Number(inv.lifetimeInflow ?? 0))} />}
          {showInflow && <KV label="Lifetime outflow" value={formatINR(Number(inv.lifetimeOutflow ?? 0))} />}
          <KV label="Service tier" value={inv.serviceTier ?? "—"} />
        </Group>

        <Group title="Review & lifecycle">
          <KV label="Last review" value={inv.lastReviewAt ? formatDate(inv.lastReviewAt) : "Never"} sub={inv.lastReviewAt ? formatRelative(inv.lastReviewAt) : undefined} />
          <KV label="Next review" value={inv.nextReviewAt ? formatDate(inv.nextReviewAt) : "—"} sub={inv.nextReviewAt ? formatRelative(inv.nextReviewAt) : undefined} />
          <KV label="Last transaction" value={inv.lastTransactionAt ? formatRelative(inv.lastTransactionAt) : "Never"} />
          {showStatus && (
            <Status
              label="Client status"
              value={inv.status}
              good={inv.status === "active"}
              warn={inv.status === "dormant" || inv.status === "inactive"}
              bad={inv.status === "redemption_risk" || inv.status === "closed" || inv.status === "exited"}
            />
          )}
          <BlueprintStatusKV investorId={inv.id} />
          {showStatus && inv.status === "redemption_risk" && inv.redemptionRiskReason && (
            <KV label="Redemption-risk reason" value={inv.redemptionRiskReason} colSpan={2} />
          )}
        </Group>

        {inv.kycData && Object.keys(inv.kycData as any).length > 0 && (
          <Group title="Additional details (from onboarding)">
            {Object.entries(inv.kycData as Record<string, string>)
              .filter(([, v]) => v != null && String(v).trim() !== "")
              .map(([k, v]) => (
                <KV key={k} label={k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} value={String(v)} />
              ))}
          </Group>
        )}

        {inv.notes && (
          <div className="mt-4 pt-4 border-t">
            <div className="text-xs text-muted-foreground mb-1">Notes</div>
            <p className="text-sm whitespace-pre-wrap">{inv.notes}</p>
          </div>
        )}
      </div>
      </RelatedListSection>

      <RelatedListSection moduleKey="investors-detail" sectionKey="risk_history">
        <div className="border rounded-lg bg-card p-5">
          <div className="flex items-center justify-between mb-4 border-b pb-3">
            <h2 className="font-semibold flex items-center gap-2 text-base">
              <ShieldCheck className="size-4 text-brand-cyan" /> Risk profile history
            </h2>
            <div className="flex items-center gap-3">
              <SendRiskProfileLinkButton investorId={inv.id} />
              <Link
                href={`/dashboard/risk-profiles/new?investorId=${inv.id}`}
                className="text-xs font-semibold text-brand-cyan hover:underline"
              >
                + New Assessment
              </Link>
            </div>
          </div>
          {!data.riskHistory || data.riskHistory.length === 0 ? (
            <EmptyRow text="No risk profile history found." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b bg-slate-50/50">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold">Profile Date</th>
                    <th className="text-left px-4 py-2 font-semibold">Category</th>
                    <th className="text-center px-4 py-2 font-semibold">Score</th>
                    <th className="text-left px-4 py-2 font-semibold">Signed By</th>
                    <th className="text-left px-4 py-2 font-semibold">RM Remarks</th>
                    <th className="text-right px-4 py-2 font-semibold">Document</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.riskHistory.map((h) => {
                    const CATEGORY_TONE: Record<string, string> = {
                      conservative: "bg-blue-50 text-blue-700 border-blue-200",
                      moderate: "bg-emerald-50 text-emerald-700 border-emerald-200",
                      aggressive: "bg-amber-50 text-amber-700 border-amber-200",
                      very_aggressive: "bg-rose-50 text-rose-700 border-rose-200",
                    };
                    return (
                      <tr key={h.id} className="hover:bg-slate-50/40">
                        <td className="px-4 py-3 text-xs font-medium tabular-nums">
                          {h.signedAt ? formatDate(h.signedAt) : formatDate(h.profileDate)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`chip border text-xs px-2 py-0.5 rounded capitalize ${CATEGORY_TONE[h.finalCategory] ?? ""}`}>
                            {h.finalCategory.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center font-medium tabular-nums">
                          {h.totalScore}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {h.signedByName ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-xs truncate" title={h.rmRemarks ?? undefined}>
                          {h.rmRemarks ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1.5 justify-end">
                            <RiskProfilePdfButtons profileId={h.id} name={inv.name} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </RelatedListSection>

      <RelatedListSection moduleKey="investors-detail" sectionKey="related">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* SIPs (Holdings moved to the Portfolio tab) */}
        <div className="col-span-2 space-y-6">
          <Section id="rel-sips" title="Active SIPs" count={data.sips.filter((s) => s.status === "active").length}>
            {data.sips.length === 0 ? (
              <EmptyRow text="No SIPs yet." />
            ) : (
              <ul className="divide-y">
                {data.sips.map((s) => (
                  <li key={s.id} className="py-2.5 flex items-center justify-between">
                    <div>
                      <div className="font-medium text-sm">{s.schemeName ?? s.schemeCode}</div>
                      <div className="text-xs text-muted-foreground">{s.frequency} · day {s.sipDate}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium tabular-nums">{formatINR(Number(s.amount))}</div>
                      <div
                        className={`text-xs ${
                          s.status === "active" ? "text-emerald-600" : "text-muted-foreground"
                        }`}
                      >
                        {s.status}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section id="rel-goals" title="Goals" count={data.goals.length}>
            {data.goals.length === 0 ? (
              <EmptyRow text="No goals set." />
            ) : (
              <ul className="space-y-4">
                {data.goals.map((g) => {
                  const pct = Number(g.progressPct ?? 0);
                  
                  // Trajectory calculations
                  const targetDate = new Date(g.targetDate);
                  const now = new Date();
                  const diffYears = targetDate.getFullYear() - now.getFullYear();
                  const diffMonths = targetDate.getMonth() - now.getMonth();
                  const N = diffYears * 12 + diffMonths;

                  const currentVal = Number(g.currentValue ?? 0);
                  const sip = Number(g.monthlyContribution ?? 0);
                  const targetAmount = Number(g.targetAmount);

                  let projectedValue = currentVal;
                  let shortfall = 0;
                  let neededIncrease = 0;

                  if (N > 0) {
                    // Use the goal's OWN expected-return assumption (matches the
                    // goal detail page) instead of a hardcoded 10%, so the
                    // shortfall shown here reconciles with the goal calculator.
                    const annualReturn = Number((g as any).expectedReturn ?? 12) / 100;
                    const r = (annualReturn > 0 ? annualReturn : 0.12) / 12;
                    projectedValue = currentVal * Math.pow(1 + r, N) + sip * ((Math.pow(1 + r, N) - 1) / r);
                    if (projectedValue < targetAmount) {
                      shortfall = targetAmount - projectedValue;
                      neededIncrease = (shortfall * r) / (Math.pow(1 + r, N) - 1);
                    }
                  }

                  return (
                    <li key={g.id} className="border-b last:border-0 pb-3 last:pb-0">
                      <div className="flex items-center justify-between text-sm">
                        <div className="font-medium">{g.name}</div>
                        <div className="text-muted-foreground tabular-nums">
                          {formatINR(Number(g.currentValue ?? 0))} / {formatINR(Number(g.targetAmount))}
                        </div>
                      </div>
                      <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500"
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex justify-between">
                        <span>{pct.toFixed(0)}% · target {formatDate(g.targetDate)} · {g.category.replace(/_/g, " ")}</span>
                        {sip > 0 && <span className="tabular-nums font-mono text-[10px]">SIP: {formatINR(sip)}/mo</span>}
                      </div>
                      {shortfall > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-50 text-rose-700 border border-rose-200">
                            ⚠️ Shortfall Projected: {formatINR(shortfall)}
                          </span>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                            Suggested step-up: +{formatINR(neededIncrease)}/mo
                          </span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {/* Unified activity timeline — sits under Goals at the left-column
              width (was full-width below the whole grid, leaving a gap here). */}
          <ActivityTimeline
            communications={data.communications}
            tasks={data.tasks}
            serviceRequests={data.serviceRequests}
            reviewMeetings={data.reviewMeetings}
          />
        </div>

        {/* Side panel */}
        <aside className="space-y-6">
          <Section id="rel-tasks" title="Open tasks" count={data.tasks.filter((t) => t.status === "open").length}>
            {data.tasks.filter((t) => t.status === "open").length === 0 ? (
              <EmptyRow text="No open tasks." />
            ) : (
              <ul className="space-y-1">
                {data.tasks
                  .filter((t) => t.status === "open")
                  .slice(0, 5)
                  .map((t) => (
                    <li key={t.id}>
                      <Link
                        href={`/dashboard/tasks?focus=${t.id}`}
                        className="block rounded-md -mx-2 px-2 py-1.5 text-sm hover:bg-accent/40 transition-colors"
                      >
                        <div className="font-medium">{t.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {t.priority} · {t.dueAt ? formatRelative(t.dueAt) : "no due"}
                        </div>
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </Section>

          <Section id="rel-srs" title="Service requests" count={data.serviceRequests.filter((s) => s.status !== "closed" && s.status !== "resolved").length}>
            {data.serviceRequests.length === 0 ? (
              <EmptyRow text="No tickets." />
            ) : (
              <ul className="space-y-2">
                {data.serviceRequests.slice(0, 5).map((s) => (
                  <li key={s.id} className="text-sm">
                    <div className="font-medium">{s.subject}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      #{s.ticketNo} · {s.status}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Consent matrix">
            <ul className="space-y-1 text-sm">
              {["whatsapp", "email", "sms"].map((channel) => {
                const tx = data.consents.find((c) => c.channel === channel && c.scope === "transactional");
                const mk = data.consents.find((c) => c.channel === channel && c.scope === "marketing");
                return (
                  <li key={channel} className="flex items-center justify-between py-1 border-b last:border-0">
                    <span className="capitalize">{channel}</span>
                    <div className="flex gap-2 text-xs">
                      <ConsentChip label="Tx" granted={tx?.status === "granted"} />
                      <ConsentChip label="Mkt" granted={mk?.status === "granted"} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>
        </aside>
      </div>

      </RelatedListSection>
      </RelatedListsContainer>
    </div>
  );
}

function Section({ id, title, count, children }: { id?: string; title: string; count?: number; children: React.ReactNode }) {
  return (
    <div id={id} className="border rounded-lg bg-card p-5 scroll-mt-24">
      <div className="font-semibold mb-3 flex items-center justify-between">
        <span>{title}</span>
        {count !== undefined && <span className="text-xs text-muted-foreground">{count}</span>}
      </div>
      {children}
    </div>
  );
}

/** Stacked KPI card for the client-header rail. */
function HeaderKpi({ label, value, primary, tone, sub }: { label: string; value: string; primary?: boolean; tone?: "good" | "bad"; sub?: string }) {
  const valueColor = tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-rose-600" : "text-foreground";
  return (
    <div className={`flex-1 rounded-lg border px-4 py-3 ${primary ? "border-brand-cyan/30 bg-brand-cyan-light/20" : "border-border bg-secondary/30"}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold tabular-nums mt-0.5 ${valueColor}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function InfoCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "warn";
}) {
  return (
    <div className={`border rounded-lg bg-card p-4 ${tone === "warn" ? "border-amber-300" : ""}`}>
      <div className="text-xs text-muted-foreground flex items-center gap-1">
        {tone === "warn" && <AlertTriangle className="size-3 text-amber-600" />}
        {label}
      </div>
      <div className="font-medium mt-1 capitalize">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <div className="text-sm text-muted-foreground text-center py-6">{text}</div>;
}

function ConsentChip({ label, granted }: { label: string; granted: boolean }) {
  return (
    <span
      className={`px-1.5 py-0.5 rounded ${
        granted ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"
      }`}
    >
      {label} {granted ? "✓" : "—"}
    </span>
  );
}

/** Master-record group header + 3-col grid for KV rows. */
// Option sets for the inline-editable selects — mirror the PATCH zod enums.
const GENDER_OPTS = [{ value: "M", label: "Male" }, { value: "F", label: "Female" }, { value: "O", label: "Other" }];
const ENTITY_OPTS = ([["individual", "Individual"], ["huf", "HUF"], ["nri", "NRI"], ["company", "Company"], ["corporate", "Corporate (legacy)"], ["trust", "Trust"], ["minor", "Minor"], ["other", "Other"]] as const).map(([value, label]) => ({ value, label }));
const SEGMENT_OPTS = ["HNI", "Affluent", "Retail", "NRI", "Corporate"].map((v) => ({ value: v, label: v }));
const CATEGORY_OPTS = ["A", "B", "C", "D"].map((v) => ({ value: v, label: `Category ${v}` }));
const RESIDENCY_OPTS = ([["indian_resident", "Indian resident"], ["nri", "NRI"], ["oci", "OCI"], ["pio", "PIO"], ["foreign_national", "Foreign national"]] as const).map(([value, label]) => ({ value, label }));
const PAN_AADHAAR_OPTS = ([["linked", "Linked"], ["not_linked", "Not linked"], ["pending", "Pending"], ["not_applicable", "Not applicable"]] as const).map(([value, label]) => ({ value, label }));

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t first:border-t-0 first:pt-0 pt-4 mt-4 first:mt-0">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        {title}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-2">{children}</div>
    </div>
  );
}

function KV({
  label,
  value,
  sub,
  mono,
  cap,
  highlight,
  colSpan,
  edit,
}: {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
  cap?: boolean;
  highlight?: boolean;
  colSpan?: number;
  edit?: InlineEditSpec;
}) {
  return (
    <div className={colSpan === 2 ? "col-span-2" : ""}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-sm mt-0.5 ${mono ? "font-mono" : ""} ${cap ? "capitalize" : ""} ${
          highlight ? "font-semibold tabular-nums" : ""
        }`}
      >
        {edit ? (
          <InlineEditField spec={edit} display={value} />
        ) : value && value.trim() && value.trim() !== "—" ? (
          value
        ) : (
          " "
        )}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function Status({
  label,
  value,
  good,
  warn,
  bad,
}: {
  label: string;
  value: string;
  good?: boolean;
  warn?: boolean;
  bad?: boolean;
}) {
  const cls = good
    ? "bg-emerald-50 text-emerald-700"
    : bad
    ? "bg-rose-50 text-rose-700"
    : warn
    ? "bg-amber-50 text-amber-700"
    : "bg-muted text-muted-foreground";
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <span className={`text-xs px-2 py-0.5 rounded-full mt-1 inline-block capitalize ${cls}`}>
        {value.replace(/_/g, " ")}
      </span>
    </div>
  );
}
