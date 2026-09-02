import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import {
  ChevronLeft,
  Shield,
  IndianRupee,
  Calendar,
  Users,
  AlertTriangle,
  CalendarClock,
  Pencil,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { insurancePolicies, investors } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatDate, formatINR } from "@/lib/utils";
import { RecordProvenance } from "@/components/common/RecordProvenance";

const TYPE_LABEL: Record<string, string> = {
  term: "Term Life",
  ulip: "ULIP",
  endowment: "Endowment",
  money_back: "Money-back",
  health: "Health",
  critical_illness: "Critical Illness",
  personal_accident: "Personal Accident",
  motor: "Motor",
  travel: "Travel",
  home: "Home",
  life_other: "Life — Other",
  general_other: "General — Other",
};

const STATUS_TONE: Record<string, string> = {
  proposed: "bg-blue-50 text-blue-700",
  in_underwriting: "bg-amber-50 text-amber-700",
  active: "bg-emerald-50 text-emerald-700",
  lapsed: "bg-rose-50 text-rose-700",
  matured: "bg-slate-50 text-slate-700",
  surrendered: "bg-slate-50 text-slate-700",
  cancelled: "bg-gray-50 text-gray-700",
  claim_filed: "bg-amber-50 text-amber-700",
  claim_settled: "bg-cyan-50 text-cyan-700",
};

export const dynamic = "force-dynamic";

export default async function InsuranceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const data = await withTenant(session.tenantId, async (tx) => {
    const p = (
      await tx.select().from(insurancePolicies).where(eq(insurancePolicies.id, id)).limit(1)
    )[0];
    if (!p) return null;
    const inv = (
      await tx.select().from(investors).where(eq(investors.id, p.investorId)).limit(1)
    )[0];
    return { p, inv };
  });
  if (!data) notFound();
  const { p, inv } = data;
  const dueSoon =
    p.status === "active" &&
    p.nextPremiumDueDate &&
    new Date(p.nextPremiumDueDate).getTime() < Date.now() + 30 * 24 * 60 * 60 * 1000;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap">
        <Link
          href="/dashboard/insurance"
          className="text-sm text-muted-foreground hover:underline hover:text-foreground flex items-center gap-1 transition-colors"
        >
          <ChevronLeft className="size-4" /> Back to policies
        </Link>
        <Link
          href={`/dashboard/insurance/new?edit=${p.id}`}
          className="btn-secondary text-xs flex items-center gap-1.5 px-3 py-1.5"
        >
          <Pencil className="size-3.5" /> Edit Policy
        </Link>
        <RecordProvenance
          entityType="insurance_policy"
          entityId={p.id}
          createdAt={p.createdAt}
          updatedAt={p.updatedAt}
          className="basis-full mt-1"
        />
      </div>

      {/* Hero */}
      <div className="card-elevated overflow-hidden">
        <div className="brand-mesh px-6 py-5 text-white">
          <div className="flex items-end justify-between flex-wrap gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/70 font-semibold">
                {TYPE_LABEL[p.policyType] ?? p.policyType}
              </div>
              <h1 className="text-2xl font-bold tracking-tight mt-1">{p.planName}</h1>
              <div className="text-white/80 text-sm mt-1 flex items-center gap-3 flex-wrap">
                <span>{p.insurer}</span>
                {p.policyNumber && (
                  <>
                    <span className="text-white/40">·</span>
                    <span className="font-mono">{p.policyNumber}</span>
                  </>
                )}
                <span className="text-white/40">·</span>
                <Link
                  href={`/dashboard/investors/${inv?.id}`}
                  className="hover:underline"
                >
                  {inv?.name}
                </Link>
              </div>
            </div>
            <span
              className={`chip ${STATUS_TONE[p.status] ?? ""} font-semibold capitalize`}
            >
              {p.status.replace(/_/g, " ")}
            </span>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3">
        <Tile
          icon={IndianRupee}
          label="Sum assured"
          value={p.sumAssured ? formatINR(Number(p.sumAssured)) : "—"}
          accent="cyan"
        />
        <Tile
          icon={IndianRupee}
          label="Annual premium"
          value={p.annualPremium ? formatINR(Number(p.annualPremium)) : "—"}
          accent="emerald"
        />
        <Tile
          icon={Users}
          label="Lives covered"
          value={String(p.livesCovered ?? 1)}
        />
        <Tile
          icon={CalendarClock}
          label="Next premium"
          value={p.nextPremiumDueDate ? formatDate(p.nextPremiumDueDate) : "—"}
          accent={dueSoon ? "amber" : "muted"}
        />
      </div>

      {/* Premium due banner */}
      {dueSoon && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-3 text-sm">
          <div className="size-9 rounded-lg bg-amber-100 grid place-items-center">
            <AlertTriangle className="size-4 text-amber-700" />
          </div>
          <div className="flex-1">
            <span className="font-semibold text-amber-900">
              Premium due {formatDate(p.nextPremiumDueDate!)}.
            </span>{" "}
            <span className="text-amber-800/80">
              Notify the client + log the payment once received.
            </span>
          </div>
        </div>
      )}

      {/* Schedule */}
      <div className="card-surface p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="size-7 rounded-lg bg-brand-cyan-light grid place-items-center">
            <Calendar className="size-3.5 text-brand-cyan-deep" />
          </div>
          <h2 className="section-title">Schedule</h2>
        </div>
        <div className="grid grid-cols-4 gap-3 text-xs">
          <KV label="Policy start" value={p.policyStartDate ? formatDate(p.policyStartDate) : "—"} />
          <KV
            label="Policy term"
            value={p.policyTermYears != null ? `${p.policyTermYears} yrs` : "—"}
          />
          <KV
            label="Premium paying term"
            value={
              p.premiumPayingTermYears != null ? `${p.premiumPayingTermYears} yrs` : "—"
            }
          />
          <KV
            label="Premium frequency"
            value={String(p.premiumFrequency).replace(/_/g, " ")}
          />
          <KV label="Maturity" value={p.maturityDate ? formatDate(p.maturityDate) : "—"} />
          <KV
            label="Last premium"
            value={p.lastPremiumDate ? formatDate(p.lastPremiumDate) : "—"}
          />
          <KV
            label="Next premium"
            value={p.nextPremiumDueDate ? formatDate(p.nextPremiumDueDate) : "—"}
          />
          <KV label="Grace period" value={`${p.gracePeriodDays ?? 30} days`} />
        </div>
      </div>

      {/* Nominee */}
      {(p.nomineeName || p.nomineeRelation) && (
        <div className="card-surface p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="size-7 rounded-lg bg-emerald-50 grid place-items-center">
              <Users className="size-3.5 text-emerald-600" />
            </div>
            <h2 className="section-title">Nominee</h2>
          </div>
          <div className="grid grid-cols-4 gap-3 text-xs">
            <KV label="Name" value={p.nomineeName ?? "—"} />
            <KV label="Relation" value={p.nomineeRelation ?? "—"} />
            <KV label="Share" value={`${p.nomineeShare ?? 100}%`} />
            <KV label="DOB" value={p.nomineeDob ? formatDate(p.nomineeDob) : "—"} />
          </div>
        </div>
      )}

      {/* Riders */}
      {Array.isArray(p.riders) && p.riders.length > 0 && (
        <div className="card-surface p-5">
          <h2 className="section-title mb-3">Riders ({p.riders.length})</h2>
          <ul className="space-y-2">
            {(p.riders as any[]).map((r, i) => (
              <li key={i} className="rounded-lg border border-border/70 bg-background p-3 text-xs">
                <div className="font-semibold">{r.name}</div>
                {(r.sumAssured || r.premium) && (
                  <div className="text-muted-foreground mt-1">
                    {r.sumAssured && (
                      <>
                        Sum assured {formatINR(Number(r.sumAssured))}
                      </>
                    )}
                    {r.sumAssured && r.premium && " · "}
                    {r.premium && <>Premium {formatINR(Number(r.premium))}</>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Remarks */}
      {p.remarks && (
        <div className="card-surface p-5">
          <h2 className="section-title mb-2">Remarks</h2>
          <p className="text-sm whitespace-pre-line leading-relaxed">{p.remarks}</p>
        </div>
      )}
    </div>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: any;
  label: string;
  value: string;
  accent?: "cyan" | "emerald" | "amber" | "rose" | "muted";
}) {
  const bg: Record<string, string> = {
    cyan: "bg-brand-cyan-light text-brand-cyan-deep",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    rose: "bg-rose-50 text-rose-600",
    muted: "bg-secondary text-foreground",
  };
  return (
    <div className="kpi-card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
          {label}
        </span>
        <div className={`size-7 rounded-lg grid place-items-center ${bg[accent ?? "muted"]}`}>
          <Icon className="size-3.5" />
        </div>
      </div>
      <div className="text-xl font-bold mt-2 tabular-nums tracking-tight">{value}</div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-secondary/40 rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-semibold mt-0.5 capitalize">{value}</div>
    </div>
  );
}
