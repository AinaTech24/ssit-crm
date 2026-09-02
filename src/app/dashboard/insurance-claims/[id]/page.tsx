import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import {
  ChevronLeft,
  FileText,
  IndianRupee,
  Tag,
  Timer,
  Pencil,
  CheckCircle2,
  Send,
  ShieldCheck,
  Bell,
  User,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { insuranceClaims, insurancePolicies, investors, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { formatDate, formatINR } from "@/lib/utils";
import { claimTatDays, claimAgeDays, OPEN_CLAIM_STATUSES } from "@/lib/insurance/claim-status";
import { ClaimDocuments } from "@/components/insurance/ClaimDocuments";

export const dynamic = "force-dynamic";

const STATUS_META: Record<string, { label: string; tone: string }> = {
  empty: { label: "Empty", tone: "bg-slate-100 text-slate-600" },
  claim_intimated: { label: "Claim Intimated", tone: "bg-amber-50 text-amber-700" },
  file_awaited: { label: "File Awaited", tone: "bg-brand-cyan-light/50 text-brand-cyan-deep" },
  file_received: { label: "File Received", tone: "bg-cyan-50 text-cyan-700" },
  add_info_awaited: { label: "Add Info Awaited", tone: "bg-brand-cyan-light/50 text-brand-cyan-deep" },
  query: { label: "Query", tone: "bg-violet-50 text-violet-700" },
  query_replied: { label: "Query Replied", tone: "bg-indigo-50 text-indigo-700" },
  under_process: { label: "Under Process", tone: "bg-blue-50 text-blue-700" },
  settled_fully: { label: "Settled Fully", tone: "bg-emerald-50 text-emerald-700" },
  settled_partially: { label: "Settled Partially", tone: "bg-emerald-50 text-emerald-700" },
  rejected: { label: "Rejected", tone: "bg-rose-50 text-rose-700" },
  withdrawn: { label: "Withdrawn", tone: "bg-slate-100 text-slate-600" },
};
const TYPE_LABEL: Record<string, string> = {
  main_claim: "Main Claim",
  supplementary: "Supplementary",
  pre_authorization: "Pre-Auth",
  rider: "Rider",
  other: "Other",
};

const OPEN = OPEN_CLAIM_STATUSES as readonly string[];

export default async function ClaimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  requireCap(session.roles, "insurance.view", session.permissions);

  const data = await withTenant(session.tenantId, async (tx) => {
    const c = (
      await tx
        .select()
        .from(insuranceClaims)
        .where(and(eq(insuranceClaims.id, id), eq(insuranceClaims.tenantId, session.tenantId)))
        .limit(1)
    )[0];
    if (!c) return null;
    const inv = c.investorId
      ? (await tx.select({ id: investors.id, name: investors.name }).from(investors).where(eq(investors.id, c.investorId)).limit(1))[0]
      : null;
    const policy = c.policyId
      ? (await tx.select().from(insurancePolicies).where(eq(insurancePolicies.id, c.policyId)).limit(1))[0]
      : null;
    const rm = c.rmId
      ? (await tx.select({ name: users.name }).from(users).where(eq(users.id, c.rmId)).limit(1))[0]
      : null;
    return { c, inv, policy, rmName: rm?.name ?? null };
  });

  if (!data) notFound();
  const { c, inv, policy, rmName } = data;
  const meta = STATUS_META[c.claimStatus] ?? STATUS_META.empty;

  const isOpen = OPEN.includes(c.claimStatus);
  const tat = claimTatDays(c.intimationDate, c.settlementDate);
  const age = claimAgeDays(c.intimationDate);
  const tatValue = isOpen
    ? age != null
      ? `Pending ${age} days`
      : "—"
    : tat != null
      ? `${tat} days`
      : "—";

  // Timeline — only steps whose date exists.
  const steps: { key: string; label: string; date: string | null; sub?: string; icon: any }[] = [
    {
      key: "intimated",
      label: "Intimated",
      date: c.intimationDate,
      sub: c.intimationMode ? `Mode: ${c.intimationMode}` : undefined,
      icon: Bell,
    },
    {
      key: "submitted",
      label: "Submitted",
      date: c.submissionDate,
      sub: c.submittedMode ? `Mode: ${c.submittedMode}` : undefined,
      icon: Send,
    },
    {
      key: "admitted",
      label: "Admitted",
      date: c.admissionDate,
      icon: ShieldCheck,
    },
    {
      key: "settled",
      label: "Settled",
      date: c.settlementDate,
      sub:
        c.settledAmount && Number(c.settledAmount) > 0
          ? formatINR(Number(c.settledAmount))
          : undefined,
      icon: CheckCircle2,
    },
  ].filter((s) => !!s.date);

  const isSettledStatus = c.claimStatus === "settled_fully" || c.claimStatus === "settled_partially";

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Link
          href="/dashboard/insurance-claims"
          className="text-sm text-muted-foreground hover:underline hover:text-foreground flex items-center gap-1 transition-colors"
        >
          <ChevronLeft className="size-4" /> Back to claims
        </Link>
        <Link
          href={`/dashboard/insurance-claims/new?edit=${c.id}`}
          className="btn-secondary text-xs flex items-center gap-1.5 px-3 py-1.5"
        >
          <Pencil className="size-3.5" /> Edit claim
        </Link>
      </div>

      {/* Hero */}
      <div className="card-elevated overflow-hidden">
        <div className="brand-mesh px-6 py-5 text-white">
          <div className="flex items-end justify-between flex-wrap gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/70 font-semibold">
                Insurance Claim
              </div>
              <h1 className="text-2xl font-bold tracking-tight mt-1">{c.proposerName}</h1>
              <div className="text-white/80 text-sm mt-1 flex items-center gap-3 flex-wrap">
                <span>{c.insurer ?? policy?.insurer ?? "—"}</span>
                {(c.policyNumber || policy?.policyNumber) && (
                  <>
                    <span className="text-white/40">·</span>
                    <span className="font-mono">{c.policyNumber ?? policy?.policyNumber}</span>
                  </>
                )}
                {inv?.id && (
                  <>
                    <span className="text-white/40">·</span>
                    <Link href={`/dashboard/investors/${inv.id}`} className="hover:underline">
                      {inv.name}
                    </Link>
                  </>
                )}
              </div>
            </div>
            <span className={`chip ${meta.tone} font-semibold`}>{meta.label}</span>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          icon={IndianRupee}
          label="Claimed"
          value={c.claimedAmount ? formatINR(Number(c.claimedAmount)) : "—"}
          accent="cyan"
        />
        <Tile
          icon={IndianRupee}
          label="Settled"
          value={c.settledAmount && Number(c.settledAmount) > 0 ? formatINR(Number(c.settledAmount)) : "—"}
          accent="emerald"
        />
        <Tile
          icon={Tag}
          label="Claim type"
          value={c.claimType ? TYPE_LABEL[c.claimType] ?? c.claimType : "—"}
        />
        <Tile icon={Timer} label="TAT" value={tatValue} accent={isOpen ? "amber" : "muted"} />
      </div>

      {/* Status timeline */}
      {steps.length > 0 && (
        <div className="card-surface p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="size-7 rounded-lg bg-brand-cyan-light grid place-items-center">
              <Timer className="size-3.5 text-brand-cyan-deep" />
            </div>
            <h2 className="section-title">Status timeline</h2>
          </div>
          <ol className="relative ml-2 border-l border-border/70 space-y-5">
            {steps.map((s, i) => {
              const Icon = s.icon;
              const isLast = i === steps.length - 1;
              const isCurrent = isLast && !isSettledStatus ? true : s.key === "settled" && isSettledStatus;
              return (
                <li key={s.key} className="ml-5">
                  <span
                    className={`absolute -left-[11px] grid size-[22px] place-items-center rounded-full ring-4 ring-background ${
                      isCurrent ? "bg-brand-cyan text-white" : "bg-emerald-100 text-emerald-700"
                    }`}
                  >
                    <Icon className="size-3" />
                  </span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold">{s.label}</span>
                    {isCurrent && (
                      <span className="chip bg-brand-cyan-light/60 text-brand-cyan-deep text-[10px]">
                        Current
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {s.date ? formatDate(s.date) : "—"}
                    {s.sub ? <span> · {s.sub}</span> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* Details */}
      <div className="card-surface p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="size-7 rounded-lg bg-secondary grid place-items-center">
            <FileText className="size-3.5 text-foreground" />
          </div>
          <h2 className="section-title">Details</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <KV label="Claim mode" value={c.claimMode ?? "—"} />
          <KV label="Intimation mode" value={c.intimationMode ?? "—"} />
          <KV label="Submitted mode" value={c.submittedMode ?? "—"} />
          <KV label="Relationship manager" value={rmName ?? "—"} />
          <KV label="Contact person" value={c.contactPerson ?? "—"} />
          <KV label="Email" value={c.email ?? "—"} />
          <KV label="Phone" value={c.phone ?? "—"} />
          <KV label="Claimant" value={inv?.name ?? "—"} />
        </div>

        {policy && (
          <div className="mt-4 rounded-lg border border-border/70 bg-background p-3 text-xs flex items-start gap-3">
            <User className="size-4 text-brand-cyan-deep shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-semibold">
                <Link href={`/dashboard/insurance/${policy.id}`} className="hover:underline">
                  {policy.planName}
                </Link>
              </div>
              <div className="text-muted-foreground mt-0.5">
                {policy.insurer}
                {policy.policyNumber ? <> · <span className="font-mono">{policy.policyNumber}</span></> : null}
              </div>
            </div>
          </div>
        )}

        {c.policyDetails && (
          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Policy details</div>
            <p className="text-sm whitespace-pre-line leading-relaxed">{c.policyDetails}</p>
          </div>
        )}
        {c.comments && (
          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Comments</div>
            <p className="text-sm whitespace-pre-line leading-relaxed">{c.comments}</p>
          </div>
        )}
      </div>

      {/* Documents */}
      <ClaimDocuments
        claimId={c.id}
        initialDocuments={(c.documents ?? []).map((d) => ({
          name: d.name,
          docType: d.docType,
          url: d.url,
          uploadedAt: d.uploadedAt,
        }))}
        claimType={c.claimType ?? undefined}
      />
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
  accent?: "cyan" | "emerald" | "amber" | "muted";
}) {
  const bg: Record<string, string> = {
    cyan: "bg-brand-cyan-light text-brand-cyan-deep",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
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
      <div className="text-lg font-bold mt-2 tabular-nums tracking-tight">{value}</div>
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
