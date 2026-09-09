import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  ChevronLeft,
  Phone,
  Mail,
  MessageCircle,
  CalendarCheck,
  CalendarClock,
  ListChecks,
  ClipboardList,
  CheckCircle2,
  Flame,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { users, tasks, communications, riskProfileResponses, proposals, reviewMeetings } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { loadViewableLead } from "@/lib/leads/access";
import { formatDate, formatRelative } from "@/lib/utils";
import { LeadActions } from "@/components/leads/LeadActions";
import { EmailRelatedList } from "@/components/comms/EmailRelatedList";
import { WhatsAppRelatedList } from "@/components/comms/WhatsAppRelatedList";
import { InvestorDetailTabs } from "@/components/investors/InvestorDetailTabs";
import { CheckInButton, LogActivityButton } from "@/components/activities/ActivityLogger";
import { ChangeLogButton } from "@/components/common/ChangeLog";
import { RecordProvenance } from "@/components/common/RecordProvenance";
import { RowActions } from "@/components/common/RowActions";
import { RecordAutomations } from "@/components/sales-ops/RecordAutomations";
import { SignalScoreCard } from "@/components/leads/SignalScoreCard";
import { LeadEditPanel } from "@/components/leads/LeadEditPanel";
import { CustomFieldsCard } from "@/components/common/CustomFieldsCard";
import { LeadScoreButton } from "@/components/leads/LeadScoreButton";
import { stageBadgeClass, stageLabel } from "@/lib/leads/stages";
import { bandBadgeClass, bandLabel } from "@/lib/leads/score";
import { OnboardingActions } from "@/components/leads/OnboardingActions";
import { BlueprintStageBar } from "@/components/leads/BlueprintStageBar";
import { STAGE_ACTIONS } from "@/lib/blueprints/stage-actions";
import { OverflowMenu, NextStepBanner } from "@/components/leads/LeadHeaderTools";
import {
  RelatedListsContainer,
  RelatedListsManager,
  RelatedListSection,
  type RelatedListDef,
} from "@/components/common/RelatedLists";

/**
 * Related-list sections on the Lead detail page. Order = default page
 * order; users can hide / reorder via the "Customize page" button.
 */
const LEAD_DETAIL_SECTIONS: RelatedListDef[] = [
  { key: "header", label: "Lead header & actions", required: true },
  { key: "signals", label: "Engagement signals" },
  { key: "blueprint", label: "Blueprint stage tracker" },
  { key: "onboarding", label: "Onboarding actions (risk profile / docs / approval)" },
  { key: "converted_banner", label: "Converted-to-client banner" },
  { key: "edit_panel", label: "Editable details" },
  { key: "emails", label: "Emails" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "meetings", label: "Meetings" },
  { key: "activity", label: "Activity timeline" },
];

/** Tab groups for the lead-detail page — the header stays pinned above. */
const LEAD_DETAIL_TABS = [
  { key: "overview", label: "Overview", sections: ["signals", "blueprint", "onboarding", "converted_banner"] },
  { key: "details", label: "Details", sections: ["edit_panel"] },
  { key: "activity", label: "Activity", sections: ["whatsapp", "emails", "meetings", "activity"] },
];

export const dynamic = "force-dynamic";

/** Format an Indian mobile as "+91 XXXXX XXXXX" (falls back to raw if not 10 digits). */
function formatPhoneIN(raw?: string | null): string {
  if (!raw) return "";
  const d = raw.replace(/\D/g, "");
  const ten = d.length > 10 ? d.slice(-10) : d;
  return ten.length === 10 ? `+91 ${ten.slice(0, 5)} ${ten.slice(5)}` : raw;
}

/** The blueprint's recommended next action for a stage — the "what to do now". */
function nextBestStep(stage: string): { label: string; hint?: string | null } | null {
  const actions = STAGE_ACTIONS[stage];
  if (!actions || !actions.length) return null;
  const primary = actions.find((a) => a.tone === "primary") ?? actions[0];
  return { label: primary.label, hint: primary.hint ?? null };
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const data = await withTenant(session.tenantId, async (tx) => {
    // Scope to the viewer's access: requires a lead-view capability and, for
    // RMs/branch heads, that the lead is theirs. Returns null otherwise (→
    // notFound), so an RM can't open another RM's lead by URL. The API
    // (GET /api/leads/[id]) already does this; the page used to bypass it.
    const lead = await loadViewableLead(tx, session, id);
    if (!lead) return null;
    // Run the 5 secondary queries in parallel — they're all independent of
    // each other and only depend on `lead.id`. This cuts the page's TTFB
    // from ~5x query-latency to ~1x query-latency on slow links.
    const [owner, relatedTasks, relatedComms, latestRiskList, latestProposalList, meetings] = await Promise.all([
      lead.ownerId
        ? tx.select().from(users).where(eq(users.id, lead.ownerId)).limit(1).then((r) => r[0])
        : Promise.resolve(null),
      tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.subjectType, "lead"), eq(tasks.subjectId, id), isNull(tasks.deletedAt)))
        .orderBy(desc(tasks.createdAt))
        .limit(50),
      tx
        .select()
        .from(communications)
        .where(eq(communications.leadId, id))
        .orderBy(desc(communications.createdAt))
        .limit(50),
      tx
        .select()
        .from(riskProfileResponses)
        .where(eq(riskProfileResponses.investorId, id))
        .orderBy(desc(riskProfileResponses.signedAt))
        .limit(1),
      tx
        .select()
        .from(proposals)
        .where(and(eq(proposals.leadId, id)))
        .orderBy(desc(proposals.createdAt))
        .limit(1),
      tx
        .select({
          id: reviewMeetings.id,
          subject: reviewMeetings.subject,
          meetingDate: reviewMeetings.meetingDate,
          meetingType: reviewMeetings.meetingType,
          meetingMode: reviewMeetings.meetingMode,
          locationOrLink: reviewMeetings.locationOrLink,
          status: reviewMeetings.status,
          outcome: reviewMeetings.outcome,
          nextReviewDate: reviewMeetings.nextReviewDate,
        })
        .from(reviewMeetings)
        .where(eq(reviewMeetings.leadId, id))
        .orderBy(desc(reviewMeetings.meetingDate))
        .limit(25),
    ]);
    return {
      lead,
      owner,
      relatedTasks,
      relatedComms,
      latestRisk: latestRiskList[0],
      latestProposal: latestProposalList[0],
      meetings,
    };
  });
  if (!data) notFound();

  const l = data.lead;

  // ── Header intelligence (deterministic — no AI call on page load) ──
  const scoreBand = (l.scoreBand as any) ?? "cold";
  const daysAsLead = l.createdAt ? Math.max(0, Math.floor((Date.now() - new Date(l.createdAt as any).getTime()) / 86_400_000)) : 0;
  const messageCount = data.relatedComms.length;
  const openTasks = data.relatedTasks.filter((t: any) => !["done", "completed", "cancelled"].includes(String(t.status))).length;
  const next = nextBestStep(l.stage);
  const statCells = [
    { label: "Lead score", value: String(l.leadScore ?? 0), sub: bandLabel(scoreBand) },
    { label: "Days as lead", value: String(daysAsLead) },
    { label: "Messages", value: messageCount >= 50 ? "50+" : String(messageCount) },
    { label: "Open tasks", value: String(openTasks) },
  ];
  const snapshot =
    `${l.source ? `${l.source} lead` : "Lead"} · ${bandLabel(scoreBand)} (${l.leadScore ?? 0}) · ${stageLabel(l.stage)} — ` +
    `${messageCount > 0 ? `${messageCount} message${messageCount > 1 ? "s" : ""} logged` : "no engagement logged yet"}` +
    `${l.lastContactAt ? `, last contact ${formatRelative(l.lastContactAt)}` : ""}` +
    `${next ? `. Next: ${next.label}.` : "."}`;

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <Link
          href="/dashboard/leads"
          className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
        >
          <ChevronLeft className="size-4" /> Back to leads
        </Link>
        <RelatedListsManager moduleKey="leads-detail" sections={LEAD_DETAIL_SECTIONS} />
      </div>

      <RelatedListsContainer>
      <RelatedListSection moduleKey="leads-detail" sectionKey="header">
      <div className="border rounded-lg bg-card p-6 space-y-4">
        {/* Identity row */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{l.name}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-1.5 text-sm">
              <span className={`text-xs px-2 py-0.5 rounded-full border ${stageBadgeClass(l.stage)}`}>
                {stageLabel(l.stage)}
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${bandBadgeClass(scoreBand)}`}
                title="Deterministic lead score (0–100)"
              >
                <Flame className="size-3" /> {bandLabel(scoreBand)} · {l.leadScore ?? 0}
              </span>
              <span className="text-muted-foreground">via {l.source}</span>
              {data.owner && <span className="text-muted-foreground">· owned by {data.owner.name}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <RowActions
              deleteUrl={`/api/leads/${l.id}`}
              itemLabel="lead"
              itemName={l.name}
              redirectTo="/dashboard/leads"
            />
            <div className="text-right text-xs text-muted-foreground">
              Last contact {l.lastContactAt ? formatRelative(l.lastContactAt) : "—"}
            </div>
          </div>
        </div>

        {/* Next best step — hoisted directly under the name/badges so "what to do
            now" is the FIRST thing the RM sees, before the stat strip. */}
        {next && <NextStepBanner label={next.label} hint={next.hint} />}

        {/* Smart snapshot — instant, deterministic (no AI call on load) */}
        <p className="text-sm text-muted-foreground">{snapshot}</p>

        {/* Contact chips */}
        <div className="flex flex-wrap gap-2 text-sm">
          {l.phone && (
            <a href={`tel:${l.phone}`} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-muted-foreground hover:text-foreground hover:border-foreground/30">
              <Phone className="size-4" /> {formatPhoneIN(l.phone)}
            </a>
          )}
          {l.email && (
            <a href={`mailto:${l.email}`} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-muted-foreground hover:text-foreground hover:border-foreground/30">
              <Mail className="size-4" /> {l.email}
            </a>
          )}
          {l.phone && (
            <a
              href={`https://wa.me/${l.phone.replace(/[^\d]/g, "")}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-muted-foreground hover:text-foreground hover:border-foreground/30"
            >
              <MessageCircle className="size-4" /> WhatsApp
            </a>
          )}
        </div>

        {/* Lead intelligence strip — score + key triage stats + AI score */}
        <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-muted/30 p-2">
          {statCells.map((s) => (
            <div key={s.label} className="px-3 py-1 min-w-[6rem]">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
              <div className="text-base font-semibold tabular-nums">
                {s.value}
                {s.sub && <span className="text-xs font-normal text-muted-foreground ml-1 capitalize">{s.sub}</span>}
              </div>
            </div>
          ))}
          <div className="ml-auto">
            <LeadScoreButton
              name={l.name}
              source={l.source}
              stage={l.stage}
              ageInStageDays={daysAsLead}
              lastTouchDaysAgo={
                l.lastContactAt
                  ? Math.max(0, Math.floor((Date.now() - new Date(l.lastContactAt as any).getTime()) / 86_400_000))
                  : null
              }
            />
          </div>
        </div>

        {/* Actions — primary bar + a tidy secondary row with a "More" menu */}
        <div className="pt-3 border-t space-y-3" data-lead-actions>
          <LeadActions
            leadId={l.id}
            leadName={l.name}
            leadEmail={l.email}
            leadPhone={l.phone}
            currentStage={l.stage}
            alreadyConvertedInvestorId={l.convertedInvestorId ?? null}
          />
          <div className="flex flex-wrap items-center gap-2">
            <CheckInButton subject={{ type: "lead", id: l.id, name: l.name, phone: l.phone }} />
            <LogActivityButton subject={{ type: "lead", id: l.id, name: l.name, phone: l.phone }} label="Log call / visit" variant="secondary" />
            <OverflowMenu>
              <ChangeLogButton entityType="lead" entityId={l.id} />
              <RecordAutomations subject={{ type: "lead", id: l.id }} />
            </OverflowMenu>
          </div>
          <RecordProvenance
            entityType="lead"
            entityId={l.id}
            createdAt={l.createdAt}
            updatedAt={l.updatedAt}
            className="text-xs"
          />
        </div>
      </div>
      </RelatedListSection>

      {/* Category tabs — group the sections; the header stays pinned above. */}
      <InvestorDetailTabs moduleKey="leads-detail" tabs={LEAD_DETAIL_TABS} />

      {/* Behavioural engagement signals (Zoho scoring parity) */}
      <RelatedListSection moduleKey="leads-detail" sectionKey="signals">
      <SignalScoreCard session={{ tenantId: session.tenantId, userId: session.userId, branchId: session.branchId, roles: session.roles }} leadId={l.id} />
      </RelatedListSection>

      {/* Blueprint stage bar — lead-phase only (stages 1–12, up to Documents
          Received). When the lead reaches docs_received the bar swaps in a
          big "Convert to Client" CTA. The remaining stages (Operations →
          Portal Welcome → Active Client) render on the investor page. */}
      <RelatedListSection moduleKey="leads-detail" sectionKey="blueprint">
        <div data-blueprint-section>
        <BlueprintStageBar
          leadId={l.id}
          phase="lead"
          convertedInvestorId={l.convertedInvestorId ?? null}
        />
        </div>
      </RelatedListSection>

      {/* Onboarding actions — pinned scroll target for the blueprint's
          "Send risk profile / Send doc checklist / Capture approval"
          buttons (they dispatch a custom event that scrolls here). */}
      <RelatedListSection moduleKey="leads-detail" sectionKey="onboarding">
        <div data-onboarding-actions>
          <OnboardingActions
            leadId={l.id}
            leadStage={l.stage}
            leadPhone={l.phone}
            leadEmail={l.email}
            leadName={l.name}
            hasRiskProfile={!!data.latestRisk}
            pendingProposalId={data.latestProposal?.id ?? null}
            alreadyConvertedInvestorId={l.convertedInvestorId ?? null}
          />
        </div>
      </RelatedListSection>

      {/* Converted banner */}
      {l.convertedInvestorId && (
        <RelatedListSection moduleKey="leads-detail" sectionKey="converted_banner">
          <div className="rounded-md border border-emerald-300 bg-emerald-50 text-emerald-900 px-4 py-3 text-sm flex items-center gap-2">
            <CheckCircle2 className="size-4" />
            <span>
              Converted to client {l.convertedAt && <>on {formatDate(l.convertedAt)}</>}.{" "}
              <Link href={`/dashboard/investors/${l.convertedInvestorId}`} className="font-medium underline">
                Open client →
              </Link>
            </span>
          </div>
        </RelatedListSection>
      )}

      {/* Editable record — every spec field, inline edit */}
      <RelatedListSection moduleKey="leads-detail" sectionKey="edit_panel">
        <LeadEditPanel lead={JSON.parse(JSON.stringify(l))} />
      </RelatedListSection>

      {/* MFD-defined custom fields (renders only if the firm has defined any). */}
      <CustomFieldsCard entity="lead" recordId={l.id} initialValues={(l as any).customFields ?? null} />

      <RelatedListSection moduleKey="leads-detail" sectionKey="whatsapp">
        <WhatsAppRelatedList entityType="lead" entityId={l.id} entityName={l.name} entityPhone={l.phone} />
      </RelatedListSection>

      <RelatedListSection moduleKey="leads-detail" sectionKey="emails">
        <EmailRelatedList entityType="lead" entityId={l.id} entityName={l.name} entityEmail={l.email} />
      </RelatedListSection>

      {/* Meetings held with this lead. review_meetings carries lead_id as well
          as investor_id, so a prospect meeting lives in the same place a client
          meeting does — it just had nowhere to show until now. */}
      <RelatedListSection moduleKey="leads-detail" sectionKey="meetings">
        <div className="border rounded-lg bg-card">
          <div className="border-b px-4 py-2.5 font-medium flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <CalendarClock className="size-4" /> Meetings
              <span className="text-xs text-muted-foreground font-normal">({data.meetings.length})</span>
            </span>
            <Link
              href={`/dashboard/review-meetings/new?leadId=${l.id}`}
              className="text-xs text-brand-cyan-deep hover:underline font-medium"
            >
              Schedule →
            </Link>
          </div>
          {data.meetings.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">
              No meetings recorded with this lead yet.
            </div>
          ) : (
            <ul className="divide-y">
              {data.meetings.map((m: any) => (
                <li key={m.id} className="px-4 py-2.5 flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <Link href={`/dashboard/review-meetings/${m.id}`} className="font-medium hover:underline truncate block">
                      {m.subject || "Meeting"}
                    </Link>
                    <div className="text-[11px] text-muted-foreground">
                      {[m.meetingType, m.meetingMode, m.locationOrLink].filter(Boolean).join(" · ") || "—"}
                      {m.outcome ? ` · ${m.outcome}` : ""}
                    </div>
                  </div>
                  <div className="text-xs text-right whitespace-nowrap">
                    <div>{m.meetingDate ? formatDate(m.meetingDate) : "—"}</div>
                    <span className="text-[10px] text-muted-foreground capitalize">{m.status ?? ""}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </RelatedListSection>

      {/* Activity timeline */}
      <RelatedListSection moduleKey="leads-detail" sectionKey="activity">
        <div className="border rounded-lg bg-card">
          <div className="border-b px-4 py-2.5 font-medium flex items-center gap-2">
            <ClipboardList className="size-4" /> Activity timeline
          </div>
          <ActivityTimeline tasks={data.relatedTasks} comms={data.relatedComms} notes={l.followUpNotes ?? ""} />
        </div>
      </RelatedListSection>
      </RelatedListsContainer>

    </div>
  );
}

function ActivityTimeline({
  tasks: relatedTasks,
  comms,
  notes,
}: {
  tasks: any[];
  comms: any[];
  notes: string;
}) {
  // Merge tasks + comms + notes into a single timeline, newest first
  type Item = { at: Date; kind: "task" | "comm" | "note"; title: string; meta: string; sub?: string };
  const items: Item[] = [];

  for (const t of relatedTasks) {
    items.push({
      at: new Date(t.createdAt),
      kind: "task",
      title: t.title,
      meta: `${t.type} · ${t.priority} · ${t.status}`,
      sub: t.dueAt ? `Due ${formatDate(t.dueAt)}` : undefined,
    });
  }
  for (const c of comms) {
    items.push({
      at: new Date(c.createdAt),
      kind: "comm",
      title: `${c.direction === "outbound" ? "Sent" : "Received"} ${c.channel}`,
      meta: c.templateKey ?? c.status,
      sub: String(
        (() => {
          const r = (c.payload as any)?.rendered;
          // `rendered` is now an object { subject, text, tokens } (older rows may
          // have stored a plain string) — extract the text either way.
          return (typeof r === "string" ? r : r?.text) ?? (c.inboundContent as any)?.text ?? "";
        })()
      ).slice(0, 120),
    });
  }
  // Notes are a single text blob with [timestamp · type · author] headers — split it
  if (notes) {
    const blocks = notes.split(/\n\n---\n\n/);
    for (const b of blocks) {
      const m = b.match(/^\[(.+?)\]\n([\s\S]*)$/);
      if (m) {
        const header = m[1]; // "2026-05-24 10:30 · call · Pooja Shah"
        const body = m[2];
        const tsMatch = header.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
        const at = tsMatch ? new Date(tsMatch[1].replace(" ", "T") + ":00Z") : new Date();
        items.push({
          at,
          kind: "note",
          title: header,
          meta: "",
          sub: body,
        });
      }
    }
  }

  items.sort((a, b) => b.at.getTime() - a.at.getTime());

  if (items.length === 0) {
    return (
      <div className="p-12 text-center text-sm text-muted-foreground">
        No activity yet. Use the buttons above to log a call, schedule a meeting, or add a task.
      </div>
    );
  }

  return (
    <ul className="divide-y">
      {items.map((i, idx) => {
        const Icon = i.kind === "task" ? ListChecks : i.kind === "comm" ? MessageCircle : ClipboardList;
        const tone =
          i.kind === "task" ? "text-amber-600" : i.kind === "comm" ? "text-blue-600" : "text-emerald-600";
        return (
          <li key={idx} className="px-4 py-3 flex items-start gap-3">
            <Icon className={`size-4 mt-0.5 ${tone}`} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{i.title}</div>
              {i.meta && <div className="text-xs text-muted-foreground mt-0.5">{i.meta}</div>}
              {i.sub && <div className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{i.sub}</div>}
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">{formatRelative(i.at)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border rounded-lg bg-card p-5">
      <h2 className="font-semibold mb-3">{title}</h2>
      <dl className="text-sm space-y-0">{children}</dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-2 py-1.5 border-b last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
