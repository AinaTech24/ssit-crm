import { requireSession } from "@/lib/auth/session";
import { withTenant } from "@/db/client";
import { serviceRequests, investors } from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { formatRelative, formatDate } from "@/lib/utils";
import { Heart, MessageSquare, ShieldAlert, AlertCircle, Smile, Frown, Meh } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function FeedbackPage() {
  const session = await requireSession();

  const data = await withTenant(session.tenantId, async (tx) => {
    // Fetch all feedback service requests
    const rows = await tx
      .select({
        id: serviceRequests.id,
        ticketNo: serviceRequests.ticketNo,
        csatRating: serviceRequests.csatRating,
        csatComment: serviceRequests.csatComment,
        csatAt: serviceRequests.csatAt,
        investorName: investors.name,
      })
      .from(serviceRequests)
      .leftJoin(investors, eq(investors.id, serviceRequests.investorId))
      .where(and(eq(serviceRequests.tenantId, session.tenantId), eq(serviceRequests.type, "feedback")))
      .orderBy(desc(serviceRequests.csatAt));

    // Calculate NPS
    const total = rows.length;
    let promoters = 0;
    let passives = 0;
    let detractors = 0;

    for (const r of rows) {
      const score = r.csatRating ?? 0;
      if (score >= 9) promoters++;
      else if (score >= 7) passives++;
      else detractors++;
    }

    const nps = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : 0;
    const promoterPct = total > 0 ? Math.round((promoters / total) * 100) : 0;
    const passivePct = total > 0 ? Math.round((passives / total) * 100) : 0;
    const detractorPct = total > 0 ? Math.round((detractors / total) * 100) : 0;

    return {
      rows,
      nps,
      total,
      promoters,
      passives,
      detractors,
      promoterPct,
      passivePct,
      detractorPct,
    };
  });

  const ratingColor = (r: number) => {
    if (r >= 9) return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (r >= 7) return "bg-amber-50 text-amber-700 border-amber-200";
    return "bg-rose-50 text-rose-700 border-rose-200";
  };

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <MessageSquare className="size-6 text-violet-600" />
          Client Satisfaction & NPS
        </h1>
        <p className="text-muted-foreground text-sm">
          Track Net Promoter Score (NPS) and customer feedback collected via secure public tokens.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="border rounded-lg p-5 bg-card relative overflow-hidden">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Net Promoter Score
          </div>
          <div className="text-4xl font-extrabold mt-2 tracking-tight">
            {data.total > 0 ? `${data.nps > 0 ? "+" : ""}${data.nps}` : "—"}
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            NPS ranges from -100 to +100
          </div>
          <Heart className="absolute -right-4 -bottom-4 size-16 text-violet-500/10" />
        </div>

        <div className="border rounded-lg p-5 bg-card">
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <span>Promoters (9-10)</span>
            <Smile className="size-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold mt-2">{data.promoters}</div>
          <div className="text-xs text-muted-foreground mt-2">
            {data.promoterPct}% of total ({data.total} responses)
          </div>
        </div>

        <div className="border rounded-lg p-5 bg-card">
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <span>Passives (7-8)</span>
            <Meh className="size-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold mt-2">{data.passives}</div>
          <div className="text-xs text-muted-foreground mt-2">
            {data.passivePct}% of total ({data.total} responses)
          </div>
        </div>

        <div className="border rounded-lg p-5 bg-card">
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <span>Detractors (1-6)</span>
            <Frown className="size-4 text-rose-600" />
          </div>
          <div className="text-2xl font-bold mt-2">{data.detractors}</div>
          <div className="text-xs text-muted-foreground mt-2">
            {data.detractorPct}% of total ({data.total} responses)
          </div>
        </div>
      </div>

      <div className="border rounded-lg bg-card">
        <div className="border-b px-4 py-3 font-medium flex items-center justify-between">
          <span>Client Feedback Submissions</span>
          <span className="text-xs bg-muted px-2 py-0.5 rounded-full font-mono">
            {data.total} total
          </span>
        </div>
        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No feedback submissions collected yet. Use client feedback share tokens to collect NPS ratings.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b bg-muted/20">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Client</th>
                <th className="text-center py-2.5 font-medium w-24">Rating</th>
                <th className="text-left py-2.5 font-medium pl-4">Comment</th>
                <th className="text-right px-4 py-2.5 font-medium w-48">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-accent/40">
                  <td className="px-4 py-3 font-medium">
                    {r.investorName ?? "Anonymous"}
                  </td>
                  <td className="py-3 text-center">
                    <span className={`inline-flex items-center justify-center font-bold font-mono size-8 rounded-full border text-sm ${ratingColor(r.csatRating ?? 0)}`}>
                      {r.csatRating}
                    </span>
                  </td>
                  <td className="py-3 pl-4 text-slate-600 max-w-lg truncate">
                    {r.csatComment ?? <span className="text-muted-foreground italic">No comment provided</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground text-xs font-mono">
                    {r.csatAt ? formatDate(r.csatAt) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
