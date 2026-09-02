import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import {
  ChevronLeft,
  Download,
  Send,
  CheckCircle2,
  XCircle,
  FileSignature,
  Calendar,
  IndianRupee,
  TrendingUp,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { proposals, users, investors } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatDate, formatINR } from "@/lib/utils";
import { ProposalStatusActions } from "@/components/proposals/ProposalStatusActions";
import { ProposalSendActions } from "@/components/proposals/ProposalSendActions";
import { ProposalSuitabilityPanel } from "@/components/proposals/ProposalSuitabilityPanel";
import { RecordProvenance } from "@/components/common/RecordProvenance";
import { DownloadButton } from "@/components/common/SecureLinkButtons";

const TYPE_LABEL: Record<string, string> = {
  comprehensive: "Comprehensive",
  mutual_fund: "Mutual Fund",
  insurance: "Insurance",
  pms: "PMS",
  aif: "AIF",
  mixed: "Mixed",
};

const STATUS_TONE: Record<string, string> = {
  draft: "bg-gray-50 text-gray-700",
  ready: "bg-blue-50 text-blue-700",
  sent: "bg-amber-50 text-amber-700",
  viewed: "bg-cyan-50 text-cyan-700",
  accepted: "bg-emerald-50 text-emerald-700",
  rejected: "bg-rose-50 text-rose-700",
  expired: "bg-slate-50 text-slate-700",
};

const KIND_LABEL: Record<string, string> = {
  mf: "Mutual Fund",
  insurance: "Insurance",
  pms: "PMS",
  aif: "AIF",
  other: "Other Product",
};

export const dynamic = "force-dynamic";

export default async function ProposalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const data = await withTenant(session.tenantId, async (tx) => {
    const p = (await tx.select().from(proposals).where(eq(proposals.id, id)).limit(1))[0];
    if (!p) return null;
    const u = p.preparedByUserId
      ? (await tx.select().from(users).where(eq(users.id, p.preparedByUserId)).limit(1))[0]
      : null;
    const inv = p.investorId
      ? (await tx.select().from(investors).where(eq(investors.id, p.investorId)).limit(1))[0]
      : null;
    return { p, u, inv };
  });
  if (!data) notFound();
  const { p, u, inv } = data;
  const products = (p.products ?? []) as any[];

  return (
    <div className="space-y-6 max-w-5xl">
      <Link
        href="/dashboard/proposals"
        className="text-sm text-muted-foreground hover:underline hover:text-foreground flex items-center gap-1 transition-colors"
      >
        <ChevronLeft className="size-4" /> Back to proposals
      </Link>

      <RecordProvenance
        entityType="proposal"
        entityId={p.id}
        createdAt={p.createdAt}
        updatedAt={p.updatedAt}
        className="mt-1"
      />

      {/* Hero card */}
      <div className="card-elevated overflow-hidden">
        <div className="brand-mesh px-6 py-5 text-white">
          <div className="flex items-end justify-between flex-wrap gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/70 font-semibold font-mono">
                {p.proposalNumber}
              </div>
              <h1 className="text-2xl font-bold tracking-tight mt-1">{p.title}</h1>
              <div className="text-white/85 text-sm mt-1 flex items-center gap-3 flex-wrap">
                <span>{TYPE_LABEL[p.type]}</span>
                <span className="text-white/40">·</span>
                <span>For {p.recipientName}</span>
                {p.validUntil && (
                  <>
                    <span className="text-white/40">·</span>
                    <span className="flex items-center gap-1">
                      <Calendar className="size-3.5" /> Valid till{" "}
                      {formatDate(p.validUntil)}
                    </span>
                  </>
                )}
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
        <div className="kpi-card">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
              Total investment
            </span>
            <div className="size-7 rounded-lg bg-brand-cyan-light text-brand-cyan-deep grid place-items-center">
              <IndianRupee className="size-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold mt-2 tabular-nums">
            {p.totalInvestment ? formatINR(Number(p.totalInvestment)) : "—"}
          </div>
        </div>
        <div className="kpi-card">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
              Projected corpus
            </span>
            <div className="size-7 rounded-lg bg-emerald-50 text-emerald-600 grid place-items-center">
              <TrendingUp className="size-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold mt-2 tabular-nums text-emerald-700">
            {p.expectedCorpus ? formatINR(Number(p.expectedCorpus)) : "—"}
          </div>
        </div>
        <div className="kpi-card">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
            Risk rating
          </div>
          <div className="text-xl font-bold mt-2 capitalize">
            {p.riskRating ?? "—"}
          </div>
        </div>
        <div className="kpi-card">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
            Line items
          </div>
          <div className="text-xl font-bold mt-2 tabular-nums">{products.length}</div>
        </div>
      </div>

      {/* Actions strip */}
      <div className="card-surface p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-xs text-muted-foreground">
            Prepared by <span className="font-medium text-foreground">{u?.name ?? "—"}</span>{" "}
            on <span className="font-medium text-foreground">{formatDate(p.preparedAt)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/dashboard/proposals/${p.id}/recommendation`}
              className="btn-ghost text-xs"
              title="Build the 4-section SIP/Lumpsum/SWP/STP worksheet"
            >
              Recommendation →
            </Link>
            {/* Real PDF (Content-Disposition: attachment) — saves directly, no new tab. */}
            <DownloadButton
              url={`/api/proposals/${p.id}/pdf?download=1`}
              filename={`Proposal_${String(p.proposalNumber ?? p.id).replace(/[^a-z0-9]+/gi, "_")}.pdf`}
              className="btn-secondary text-xs"
            >
              <Download className="size-3.5" /> Download PDF
            </DownloadButton>
            <ProposalStatusActions id={p.id} status={p.status} />
          </div>
        </div>
        {/* Send to client — email + WhatsApp */}
        <div className="border-t border-border pt-3 flex items-start justify-between gap-3 flex-wrap">
          <div className="text-xs text-muted-foreground">
            Share with{" "}
            <span className="font-medium text-foreground">{p.recipientName}</span>
            {p.recipientEmail && (
              <>
                {" "}
                · <span className="font-mono">{p.recipientEmail}</span>
              </>
            )}
            {p.recipientPhone && (
              <>
                {" "}
                · <span className="font-mono">{p.recipientPhone}</span>
              </>
            )}
          </div>
          <ProposalSendActions
            id={p.id}
            hasEmail={!!p.recipientEmail}
            hasPhone={!!p.recipientPhone}
            status={p.status}
          />
        </div>
      </div>

      {/* Cover letter */}
      {p.coverLetter && (
        <div className="card-surface p-5">
          <h2 className="section-title mb-2">Cover letter</h2>
          <p className="text-sm whitespace-pre-line leading-relaxed">{p.coverLetter}</p>
        </div>
      )}

      {/* Suitability & Compliance Panel */}
      <ProposalSuitabilityPanel
        proposalId={p.id}
        initialSuitabilityNote={(p as any).suitabilityNote}
        initialOverrideReason={(p as any).suitabilityOverrideReason}
        clientRiskProfile={inv?.riskProfile as any}
        schemes={products
          .filter((it: any) => it.kind === "mf")
          .map((it: any) => ({
            name: it.schemeName,
            riskRating: it.riskRating,
          }))}
      />

      {/* Products */}
      <div className="card-surface p-5">
        <h2 className="section-title mb-3">Products ({products.length})</h2>
        {products.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No line items.</p>
        ) : (
          <ul className="space-y-3">
            {products.map((it: any, i: number) => (
              <li
                key={i}
                className="rounded-xl border border-border/70 bg-background p-4"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className={`chip text-[10px] ${
                      it.kind === "mf"
                        ? "bg-emerald-50 text-emerald-700"
                        : it.kind === "insurance"
                        ? "bg-blue-50 text-blue-700"
                        : it.kind === "pms"
                        ? "bg-amber-50 text-amber-700"
                        : it.kind === "other"
                        ? "bg-slate-100 text-slate-700"
                        : "bg-rose-50 text-rose-700"
                    }`}
                  >
                    {KIND_LABEL[it.kind] ?? it.kind}
                  </span>
                  <span className="font-semibold text-sm">
                    {it.schemeName ?? it.policyName ?? it.strategyName ?? it.fundName ?? it.productName}
                  </span>
                </div>
                <ProductDetails it={it} />
                {it.notes && (
                  <p className="mt-2 text-xs text-muted-foreground italic">{it.notes}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {p.disclaimer && (
        <div className="card-surface p-5">
          <h2 className="section-title mb-2">Disclaimer</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">{p.disclaimer}</p>
        </div>
      )}
    </div>
  );
}

function ProductDetails({ it }: { it: any }) {
  const kv: [string, string][] = [];
  if (it.kind === "mf") {
    if (it.amcName) kv.push(["AMC", it.amcName]);
    if (it.category) kv.push(["Category", it.category]);
    if (it.lumpsum) kv.push(["Lumpsum", formatINR(Number(it.lumpsum))]);
    if (it.monthlyAmount) kv.push(["SIP", `${formatINR(Number(it.monthlyAmount))}/mo`]);
    if (it.sipTermYears) kv.push(["Term", `${it.sipTermYears} yrs`]);
    if (it.expectedReturn) kv.push(["Expected return", `${it.expectedReturn}% p.a.`]);
    if (it.riskRating) kv.push(["Risk", String(it.riskRating).replace(/_/g, " ")]);
    if (it.projectedCorpus) kv.push(["Projected", formatINR(Number(it.projectedCorpus))]);
  } else if (it.kind === "insurance") {
    if (it.insurer) kv.push(["Insurer", it.insurer]);
    if (it.policyType) kv.push(["Type", it.policyType]);
    if (it.sumAssured) kv.push(["Sum assured", formatINR(Number(it.sumAssured))]);
    if (it.annualPremium) kv.push(["Annual premium", formatINR(Number(it.annualPremium))]);
    if (it.termYears) kv.push(["Term", `${it.termYears} yrs`]);
  } else if (it.kind === "pms") {
    if (it.manager) kv.push(["Manager", it.manager]);
    if (it.minInvestment) kv.push(["Min", formatINR(Number(it.minInvestment))]);
    if (it.proposedAmount) kv.push(["Proposed", formatINR(Number(it.proposedAmount))]);
    if (it.expectedReturn) kv.push(["Expected return", `${it.expectedReturn}% p.a.`]);
    if (it.termYears) kv.push(["Horizon", `${it.termYears} yrs`]);
    const pmsProj = Number(it.proposedAmount ?? 0) * Math.pow(1 + Number(it.expectedReturn ?? 0) / 100, Number(it.termYears ?? 0));
    if (pmsProj) kv.push(["Projected", formatINR(Math.round(pmsProj))]);
  } else if (it.kind === "aif") {
    if (it.manager) kv.push(["Manager", it.manager]);
    if (it.category) kv.push(["Category", String(it.category).toUpperCase()]);
    if (it.minInvestment) kv.push(["Min", formatINR(Number(it.minInvestment))]);
    if (it.proposedAmount) kv.push(["Proposed", formatINR(Number(it.proposedAmount))]);
    if (it.lockInYears) kv.push(["Lock-in", `${it.lockInYears} yrs`]);
    if (it.targetIrr) kv.push(["Target IRR", `${it.targetIrr}% p.a.`]);
    const aifProj = Number(it.proposedAmount ?? 0) * Math.pow(1 + Number(it.targetIrr ?? 0) / 100, Number(it.lockInYears ?? 0));
    if (aifProj) kv.push(["Projected", formatINR(Math.round(aifProj))]);
  } else if (it.kind === "other") {
    if (it.company) kv.push(["Company", it.company]);
    if (it.amount) kv.push(["Amount", formatINR(Number(it.amount))]);
    if (it.expectedReturn) kv.push(["Expected return", `${it.expectedReturn}% p.a.`]);
    if (it.termYears) kv.push(["Term", `${it.termYears} yrs`]);
    const otherProj =
      Number(it.amount ?? 0) > 0 && Number(it.expectedReturn ?? 0) > 0 && Number(it.termYears ?? 0) > 0
        ? Number(it.amount) * Math.pow(1 + Number(it.expectedReturn) / 100, Number(it.termYears))
        : 0;
    if (otherProj) kv.push(["Expected FV", formatINR(Math.round(otherProj))]);
    if (it.remarks) kv.push(["Remarks", it.remarks]);
  }
  if (kv.length === 0) return null;
  return (
    <div className="grid grid-cols-4 gap-2 text-xs">
      {kv.map(([k, v]) => (
        <div key={k} className="bg-secondary/40 rounded px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {k}
          </div>
          <div className="font-semibold mt-0.5">{v}</div>
        </div>
      ))}
    </div>
  );
}
