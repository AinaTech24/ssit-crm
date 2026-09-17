import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, and, sql } from "drizzle-orm";
import { ChevronLeft, Calendar, Wallet, CalendarClock, LifeBuoy, Repeat, Target } from "lucide-react";
import { withTenant } from "@/db/client";
import { reviewMeetings, investors, leads, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { resolveMeetingScope, isMeetingInScope } from "@/lib/auth/data-scope";
import { formatINR, formatRelative } from "@/lib/utils";
import { ReviewMeetingDetailEditor } from "@/components/review-meetings/ReviewMeetingDetailEditor";
import { MeetingPrepButton } from "@/components/review-meetings/MeetingPrepButton";
import { RecordProvenance } from "@/components/common/RecordProvenance";

export const dynamic = "force-dynamic";

export default async function ReviewMeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const data = await withTenant(session.tenantId, async (tx) => {
    const m = (await tx.select().from(reviewMeetings).where(and(eq(reviewMeetings.id, id), eq(reviewMeetings.tenantId, session.tenantId))).limit(1))[0];
    if (!m) return null;
    // The meeting subject is either an investor (client) or a lead — exactly one.
    const inv = m.investorId
      ? (await tx.select().from(investors).where(and(eq(investors.id, m.investorId), eq(investors.tenantId, session.tenantId))).limit(1))[0]
      : null;
    const ld = m.leadId
      ? (await tx.select().from(leads).where(and(eq(leads.id, m.leadId), eq(leads.tenantId, session.tenantId))).limit(1))[0]
      : null;
    const rm = m.rmId
      ? (await tx.select().from(users).where(and(eq(users.id, m.rmId), eq(users.tenantId, session.tenantId))).limit(1))[0]
      : null;

    // Same wall as the list, applied to one row: a branch-scoped viewer (a
    // branch head, or anyone granted this branch) sees a meeting run by
    // anyone in their branch — derived from the owning RM's own branch, since
    // review_meetings has no branch_id of its own. A guessed/pasted id must
    // not be a way around it.
    const meetingScope = await resolveMeetingScope(tx, session);
    if (!isMeetingInScope(meetingScope, { branchId: rm?.branchId ?? null, ownerId: m.rmId })) {
      return null;
    }

    // Prep brief — only for upcoming/in-progress investor meetings. Pulls the
    // context an RM needs to walk in prepared, in one query.
    let prep: any = null;
    if (m.investorId && ["scheduled", "confirmed", "in_progress"].includes(m.status)) {
      const p = await tx.execute(sql`
        SELECT
          i.aum, i.last_review_at, i.active_sip_amount, i.health_score, i.health_band,
          (SELECT count(*) FROM service_requests sr WHERE sr.investor_id = i.id
             AND sr.status IN ('open','in_progress','waiting_customer','escalated'))::int AS open_srs,
          (SELECT count(*) FROM sips s WHERE s.investor_id = i.id
             AND s.status NOT IN ('stopped','cancelled','completed'))::int AS active_sips,
          (SELECT count(*) FROM transactions t WHERE t.investor_id = i.id AND t.type = 'sip'
             AND t.status IN ('rejected','failed')
             AND t.order_date >= current_date - interval '180 days')::int AS bounces_6mo,
          (SELECT count(*) FROM goals g WHERE g.investor_id = i.id)::int AS goals_count
        FROM investors i WHERE i.id = ${m.investorId}::uuid
      `);
      prep = (p.rows[0] as any) ?? null;
    }
    return { meeting: m, investor: inv, lead: ld, rm, prep };
  });
  if (!data) notFound();
  const subjectName = data.investor?.name ?? data.lead?.name ?? "Subject";
  const subjectKind: "Client" | "Lead" = data.lead ? "Lead" : "Client";

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <Link
        href="/dashboard/review-meetings"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to review meetings
      </Link>

      <div className="card-surface p-6 flex items-start gap-4">
        <div className="size-12 rounded-lg bg-brand-cyan-light grid place-items-center">
          <Calendar className="size-6 text-brand-cyan" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">
            {data.meeting.subject
              ? data.meeting.subject
              : `${subjectName} · ${data.meeting.meetingType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`}
          </h1>
          {data.meeting.subject && (
            <div className="text-sm text-muted-foreground">
              {subjectName} · {data.meeting.meetingType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
            </div>
          )}
          <span className="inline-block mt-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
            {subjectKind}
          </span>
          <div className="text-sm text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
            <span>{new Date(data.meeting.meetingDate).toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" })}</span>
            <span>·</span>
            <span className="capitalize">{data.meeting.meetingMode.replace(/_/g, " ")}</span>
            {data.rm && (
              <>
                <span>·</span>
                <span>RM: {data.rm.name}</span>
              </>
            )}
          </div>
          <RecordProvenance
            entityType="review_meeting"
            entityId={data.meeting.id}
            createdAt={data.meeting.createdAt}
            updatedAt={data.meeting.updatedAt}
            className="mt-1"
          />
        </div>
        <MeetingPrepButton meetingId={data.meeting.id} className="shrink-0" />
      </div>

      {data.prep && (
        <div className="card-surface p-5">
          <div className="flex items-center gap-2 mb-3">
            <Target className="size-4 text-brand-cyan" />
            <h3 className="font-semibold">Prep brief</h3>
            <span className="text-xs text-muted-foreground">— walk in ready</span>
            <Link
              href={`/dashboard/investors/${data.investor!.id}`}
              className="ml-auto text-xs text-brand-cyan hover:underline"
            >
              Open Client 360 →
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Prep icon={Wallet} label="AUM" value={formatINR(Number(data.prep.aum ?? 0))} />
            <Prep icon={Repeat} label="Monthly SIP" value={formatINR(Number(data.prep.active_sip_amount ?? 0))} />
            <Prep
              icon={CalendarClock}
              label="Last review"
              value={data.prep.last_review_at ? formatRelative(data.prep.last_review_at) : "Never"}
              tone={!data.prep.last_review_at ? "rose" : undefined}
            />
            <Prep
              icon={LifeBuoy}
              label="Open requests"
              value={String(data.prep.open_srs ?? 0)}
              tone={Number(data.prep.open_srs) > 0 ? "amber" : undefined}
            />
            <Prep
              icon={Repeat}
              label="SIP bounces · 6mo"
              value={String(data.prep.bounces_6mo ?? 0)}
              tone={Number(data.prep.bounces_6mo) > 0 ? "rose" : undefined}
            />
            <Prep icon={Target} label="Goals" value={String(data.prep.goals_count ?? 0)} />
          </div>
        </div>
      )}

      <ReviewMeetingDetailEditor
        meeting={JSON.parse(JSON.stringify(data.meeting))}
        investorName={subjectName}
      />
    </div>
  );
}

function Prep({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: any;
  label: string;
  value: string;
  tone?: "rose" | "amber";
}) {
  const color = tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </div>
      <div className={`mt-1 text-sm font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
