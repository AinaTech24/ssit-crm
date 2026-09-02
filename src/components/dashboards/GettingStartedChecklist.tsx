import Link from "next/link";
import { sql } from "drizzle-orm";
import { CheckCircle2, Circle, ChevronRight, Rocket } from "lucide-react";
import { withTenant } from "@/db/client";
import { tenants } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * GettingStartedChecklist — first-run task list that appears at the top of
 * the dashboard until a tenant has reached "everyday use". Each row is a
 * single action and links straight to the place where it gets done.
 *
 * The checklist auto-hides once every step is complete, so it doesn't clutter
 * the dashboard for tenants who are already running smoothly.
 *
 * Design rationale: non-technical MFDs benefit from a clear "here's what to
 * do first" path. Without this, the first login feels overwhelming — 35+
 * sidebar entries with no obvious starting point.
 */
export async function GettingStartedChecklist({ tenantId }: { tenantId: string }) {
  const data = await withTenant(tenantId, async (tx) => {
    // Tenant profile — has logo + ARN + brand colour?
    const tenant = (await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0];
    const profileDone = !!(tenant?.arn && tenant?.legalName && tenant?.displayName);

    // Counts for the rest
    const r = await tx.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM users WHERE status = 'active') AS user_count,
        (SELECT COUNT(*)::int FROM leads) AS lead_count,
        (SELECT COUNT(*)::int FROM investors WHERE deleted_at IS NULL) AS client_count,
        (SELECT COUNT(*)::int FROM communications WHERE status IN ('sent','delivered','read')) AS sent_count,
        (SELECT COUNT(*)::int FROM workflow_rules WHERE enabled = true) AS active_rules,
        (SELECT COUNT(*)::int FROM rta_file_imports WHERE status IN ('completed','partial')) AS rta_imports
    `);
    const counts = r.rows[0] as Record<string, number>;

    return {
      profileDone,
      teamDone: (counts.user_count ?? 0) > 1, // owner + at least 1 invited
      leadsDone: (counts.lead_count ?? 0) > 0,
      clientsDone: (counts.client_count ?? 0) > 0,
      commsDone: (counts.sent_count ?? 0) > 0,
      automationDone: (counts.active_rules ?? 0) > 0,
      rtaDone: (counts.rta_imports ?? 0) > 0,
    };
  });

  const steps = [
    {
      done: data.profileDone,
      title: "Set up your firm profile",
      sub: "Add your firm name, ARN, logo and brand colour — they appear on every PDF and message you send.",
      href: "/dashboard/settings",
      cta: "Open settings",
    },
    {
      done: data.teamDone,
      title: "Invite your team",
      sub: "Add Relationship Managers, ops staff, marketing. Each person gets the right access for their role.",
      href: "/dashboard/employees",
      cta: "Invite team",
    },
    {
      done: data.leadsDone,
      title: "Add your first lead",
      sub: "A lead is someone who's interested but hasn't invested yet. Add them and start nurturing.",
      href: "/dashboard/leads/new",
      cta: "Add lead",
    },
    {
      done: data.clientsDone,
      title: "Add your first client",
      sub: "Clients are existing investors. Import from Excel for bulk, or add one-by-one.",
      href: "/dashboard/investors/new",
      cta: "Add client",
    },
    {
      done: data.commsDone,
      title: "Send your first message",
      sub: "WhatsApp, email or SMS — we'll auto-attach your ARN tagline and stay SEBI-compliant.",
      href: "/dashboard/communications",
      cta: "Send message",
    },
    {
      done: data.rtaDone,
      title: "Upload your first RTA file",
      sub: "Drop in the latest CAMS/KFintech daily transaction feed so the platform can populate folios, SIPs and AUM from real data.",
      href: "/dashboard/rta-imports",
      cta: "Upload RTA file",
    },
    {
      done: data.automationDone,
      title: "Turn on an automation recipe",
      sub: "Pre-built recipes like SIP rejection follow-up and birthday wishes. One click to enable.",
      href: "/dashboard/workflows/rules",
      cta: "Browse recipes",
    },
  ];

  const completed = steps.filter((s) => s.done).length;
  if (completed === steps.length) return null; // hide entirely once everything's done

  const pct = Math.round((completed / steps.length) * 100);
  const remaining = steps.filter((s) => !s.done);
  const nextStep = remaining[0];

  return (
    <div className="card-elevated overflow-hidden">
      <div className="px-5 py-4 bg-gradient-to-br from-brand-navy to-brand-cyan-deep text-white flex items-center gap-4">
        <div className="size-10 rounded-xl bg-white/15 backdrop-blur grid place-items-center flex-shrink-0">
          <Rocket className="size-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">Getting started</div>
          <div className="text-[11px] text-white/80">
            {completed} of {steps.length} steps done · {pct}% complete
          </div>
        </div>
        <div className="hidden sm:block w-32 h-2 rounded-full bg-white/20 overflow-hidden">
          <div
            className="h-full bg-white transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* "Do this next" tile — pulls the user toward the very next step */}
      {nextStep && (
        <Link
          href={nextStep.href}
          className="block px-5 py-3.5 border-b border-border/60 bg-amber-50/60 hover:bg-amber-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-lg bg-amber-100 text-amber-700 grid place-items-center flex-shrink-0">
              <ChevronRight className="size-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold uppercase tracking-wider text-amber-700">
                Do this next
              </div>
              <div className="text-sm font-medium text-foreground mt-0.5">
                {nextStep.title}
              </div>
              <div className="text-[12px] text-muted-foreground mt-0.5 leading-snug">
                {nextStep.sub}
              </div>
            </div>
            <span className="btn-primary text-xs whitespace-nowrap">{nextStep.cta}</span>
          </div>
        </Link>
      )}

      <ul className="divide-y divide-border/60">
        {steps.map((s, i) => (
          <li key={i}>
            <Link
              href={s.href}
              className={`flex items-center gap-3 px-5 py-3 hover:bg-secondary/50 transition-colors ${
                s.done ? "opacity-70" : ""
              }`}
            >
              {s.done ? (
                <CheckCircle2 className="size-5 text-emerald-600 flex-shrink-0" />
              ) : (
                <Circle className="size-5 text-muted-foreground/50 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div
                  className={`text-sm ${
                    s.done ? "line-through text-muted-foreground" : "font-medium"
                  }`}
                >
                  {s.title}
                </div>
                {!s.done && (
                  <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                    {s.sub}
                  </div>
                )}
              </div>
              {!s.done && (
                <ChevronRight className="size-4 text-muted-foreground flex-shrink-0" />
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
