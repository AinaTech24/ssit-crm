/**
 * Per-client Minutes of Meeting (MOM) tracker — Network FP "2.5 MOM
 * Tracker" parity.
 *
 * Shows every review-meeting row for a single investor in chronological
 * order with the structured fields the template asks for:
 *   Meeting Date · Place · Attendees · Meeting Type · Key Discussion
 *   Points · Next Steps for Action.
 *
 * Designed for print — owners send this to clients before review
 * meetings or to compliance for audit.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { and, desc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { investors, reviewMeetings, users } from "@/db/schema";
import { PrintButton } from "@/components/settings/PrintButton";

export const dynamic = "force-dynamic";

const MODE_LABELS: Record<string, string> = {
  office: "Office",
  client_place: "Client place",
  online: "Online",
  phone: "Phone",
};

const TYPE_LABELS: Record<string, string> = {
  portfolio_review: "Portfolio Review",
  goal_review: "Goal Review",
  service_discussion: "Service Discussion",
  family_review: "Family Review",
  complaint_discussion: "Complaint Discussion",
  discovery_call: "Discovery Call",
  new_client_kickoff: "New Client Kickoff",
  new_investment_discussion: "New Investment Discussion",
  product_demo: "Product Demo",
  sales_pitch: "Sales Pitch",
  follow_up_call: "Follow-up Call",
  follow_up_visit: "Follow-up Visit",
  other: "Other",
};

const ATTENDEE_ROLE_LABELS: Record<string, string> = {
  rm: "RM (firm)",
  investor: "Investor",
  spouse: "Spouse",
  family: "Family",
  ca: "CA",
  amc_rm: "AMC RM",
  sub_distributor: "Sub-Distributor",
  back_office: "Back Office",
  compliance: "Compliance",
  other: "Other",
};

const STATUS_TONE: Record<string, string> = {
  completed: "bg-emerald-50 text-emerald-700",
  scheduled: "bg-blue-50 text-blue-700",
  confirmed: "bg-cyan-50 text-cyan-700",
  in_progress: "bg-amber-50 text-amber-700",
  rescheduled: "bg-slate-50 text-slate-700",
  cancelled: "bg-gray-50 text-gray-700",
  no_show: "bg-rose-50 text-rose-700",
};

export default async function InvestorMomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;

  const data = await withTenant(session.tenantId, async (tx) => {
    const [investor] = await tx
      .select()
      .from(investors)
      .where(eq(investors.id, id))
      .limit(1);
    if (!investor) return null;

    const meetings = await tx
      .select()
      .from(reviewMeetings)
      .where(
        and(
          eq(reviewMeetings.tenantId, session.tenantId),
          eq(reviewMeetings.investorId, id)
        )
      )
      .orderBy(desc(reviewMeetings.meetingDate));

    // Resolve RM names for all meetings
    const rmIds = [...new Set(meetings.map((m) => m.rmId).filter(Boolean))] as string[];
    const rmMap = new Map<string, string>();
    if (rmIds.length > 0) {
      const userRows = await tx
        .select({ id: users.id, name: users.name })
        .from(users);
      for (const u of userRows) rmMap.set(u.id, u.name);
    }
    return { investor, meetings, rmMap };
  });
  if (!data) notFound();

  const completedMeetings = data.meetings.filter(
    (m) => m.status === "completed"
  );

  return (
    <div className="space-y-5 max-w-6xl print:max-w-none">
      <div className="flex items-center justify-between print:hidden">
        <Link
          href={`/dashboard/investors/${id}`}
          className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
        >
          <ChevronLeft className="size-3" /> {data.investor.name}
        </Link>
        <PrintButton />
      </div>

      <div className="hidden print:block text-center mb-3">
        <h1 className="text-xl font-bold">Minutes of Meeting Tracker</h1>
        <p className="text-xs text-slate-500">
          Generated {new Date().toLocaleDateString("en-GB")}
        </p>
      </div>

      <div className="card-surface p-5 space-y-1">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
          Client
        </div>
        <h2 className="text-xl font-semibold">{data.investor.name}</h2>
        <div className="text-xs text-muted-foreground">
          PAN: <span className="font-mono">{data.investor.pan}</span>
          {data.investor.email && ` · ${data.investor.email}`}
          {data.investor.phone && ` · ${data.investor.phone}`}
        </div>
        <div className="text-xs text-muted-foreground mt-2">
          {data.meetings.length} total meetings · {completedMeetings.length}{" "}
          completed
        </div>
      </div>

      {data.meetings.length === 0 ? (
        <div className="card-surface p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No meetings on record for this client yet.
          </p>
          <Link
            href="/dashboard/review-meetings/new"
            className="btn-primary text-sm mt-4"
          >
            Schedule a meeting
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {data.meetings.map((m, idx) => {
            const attendees = (m.attendees ?? []) as Array<{
              name: string;
              role: string;
              isExternal: boolean;
              notes?: string;
            }>;
            const actionItems = (m.actionItems ?? []) as Array<{
              title: string;
              dueAt?: string;
              taskId?: string;
            }>;
            return (
              <div
                key={m.id}
                className="card-surface p-5 space-y-3 print:break-inside-avoid"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                      Meeting #{data.meetings.length - idx}
                    </div>
                    <h3 className="text-base font-semibold mt-0.5">
                      {new Date(m.meetingDate).toLocaleDateString("en-GB", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                      <span className="text-xs text-muted-foreground font-normal ml-2">
                        {new Date(m.meetingDate).toLocaleTimeString("en-GB", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 print:hidden">
                    <span
                      className={`chip text-[10px] ${
                        STATUS_TONE[m.status] ?? "bg-slate-100"
                      }`}
                    >
                      {m.status.replace("_", " ")}
                    </span>
                    <Link
                      href={`/dashboard/review-meetings/${m.id}`}
                      className="text-[11px] text-violet-600 hover:underline"
                    >
                      Open →
                    </Link>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                  <Cell label="Place">
                    {MODE_LABELS[m.meetingMode] ?? m.meetingMode}
                    {m.locationOrLink && (
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {m.locationOrLink}
                      </div>
                    )}
                  </Cell>
                  <Cell label="Type">
                    {TYPE_LABELS[m.meetingType] ?? m.meetingType}
                  </Cell>
                  <Cell label="Duration">
                    {m.durationMinutes ? `${m.durationMinutes} min` : "—"}
                  </Cell>
                  <Cell label="RM">
                    {m.rmId ? data.rmMap.get(m.rmId) ?? "—" : "—"}
                  </Cell>
                </div>

                {/* Attendees */}
                {attendees.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
                      Attendees
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {attendees.map((a, i) => (
                        <span
                          key={i}
                          className={`chip text-[11px] ${
                            a.isExternal
                              ? "bg-violet-50 text-violet-800"
                              : "bg-cyan-50 text-cyan-800"
                          }`}
                          title={a.notes ?? ""}
                        >
                          {a.name}
                          <span className="opacity-60 ml-1">
                            ({ATTENDEE_ROLE_LABELS[a.role] ?? a.role})
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Discussion + Notes */}
                {m.discussionPoints && (
                  <Field label="Key discussion points">
                    {m.discussionPoints}
                  </Field>
                )}
                {m.meetingNotes && (
                  <Field label="Meeting notes">{m.meetingNotes}</Field>
                )}

                {/* Action items */}
                {actionItems.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
                      Next steps for action
                    </div>
                    <ol className="list-decimal ml-5 text-xs space-y-1">
                      {actionItems.map((a, i) => (
                        <li key={i}>
                          {a.title}
                          {a.dueAt && (
                            <span className="text-muted-foreground ml-1">
                              · due {a.dueAt}
                            </span>
                          )}
                          {a.taskId && (
                            <span className="text-emerald-600 ml-1">
                              · task created ✓
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {m.outcome && (
                  <div className="text-[11px] text-muted-foreground italic">
                    Outcome: {m.outcome.replace("_", " ")}
                    {m.outcomeNotes && ` — ${m.outcomeNotes}`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Cell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
        {label}
      </div>
      <div className="text-xs mt-0.5">{children}</div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
        {label}
      </div>
      <div className="text-xs whitespace-pre-wrap text-foreground">
        {children}
      </div>
    </div>
  );
}
