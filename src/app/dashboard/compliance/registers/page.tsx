/**
 * AMFI DDQ Compliance Registers.
 *
 * The records the Due Diligence Questionnaire asks for that had no home in the
 * CRM. Each block cites its DDQ question so an auditor's request maps straight
 * to a screen:
 *   4.26        Declaration of Self-Certification (self + sub-distributors)
 *   4.17/4.18   mis-selling · 4.20b third-party payments
 *   6.1/6.2/6.3 regulatory action · litigation · ARN-EUIN suspension / warnings
 *   2.4b        unsuitability communicated, acknowledged, execution-only confirmed
 * Plus the firm-level declarations (2.1c/2.4c/5.8/5.9).
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { ShieldCheck, FileCheck, AlertTriangle, ScrollText, ArrowLeft } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { RegisterQuickAdd } from "@/components/compliance/RegisterQuickAdd";
import { thirdPartySuspectsSql, SUSPECT_REASON_LABEL, type ThirdPartySuspect } from "@/lib/compliance/third-party-payments";

export const dynamic = "force-dynamic";

const INCIDENT_LABEL: Record<string, string> = {
  misselling: "Mis-selling",
  third_party_payment: "Third-party payment",
  regulatory_action: "Regulatory action",
  litigation: "Litigation",
  arn_euin_suspension: "ARN/EUIN suspension",
  warning_letter: "Warning letter",
};

const REL_LABEL: Record<string, string> = {
  execution_only: "Execution only",
  incidental_advice: "Incidental advice",
  advisory: "Advisory",
  both: "Advisory & execution",
};

/** India FY for "today" — DSC is an annual, per-FY declaration. */
function currentFY(): string {
  const d = new Date();
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

export default async function ComplianceRegistersPage() {
  const session = await requireSession();
  requireAny(session.roles, ["compliance.view", "compliance.edit", "settings.masters"], session.permissions);
  const canEdit = can(session.roles, "compliance.edit", session.permissions) || can(session.roles, "settings.masters", session.permissions);

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const dsc = await tx.execute(sql`
        SELECT id, financial_year, subject_type, subject_name, arn, status, submitted_on, notes
        FROM dsc_declarations WHERE tenant_id = ${session.tenantId}::uuid
        ORDER BY financial_year DESC, subject_type, subject_name NULLS FIRST LIMIT 100`);
      const incidents = await tx.execute(sql`
        SELECT id, kind, occurred_on, title, amc_name, reported_to_amc, status, remedial_action
        FROM compliance_incidents WHERE tenant_id = ${session.tenantId}::uuid
        ORDER BY occurred_on DESC LIMIT 100`);
      const unsuit = await tx.execute(sql`
        SELECT u.id, u.scheme_name, u.reason, u.communicated_on, u.client_acknowledged,
               u.execution_only_confirmed, i.name AS investor_name
        FROM unsuitability_acks u LEFT JOIN investors i ON i.id = u.investor_id
        WHERE u.tenant_id = ${session.tenantId}::uuid
        ORDER BY u.communicated_on DESC LIMIT 100`);
      const suspects = await tx.execute(thirdPartySuspectsSql(session.tenantId));
      const firm = await tx.execute(sql`
        SELECT relationship_model, charges_execution_fees, amfi_tagline_compliant,
               social_media_disclosure_compliant, arn
        FROM tenants WHERE id = ${session.tenantId}::uuid LIMIT 1`);
      const subs = await tx.execute(sql`
        SELECT COUNT(*)::int AS c FROM sub_distributors WHERE tenant_id = ${session.tenantId}::uuid`);
      return {
        dsc: dsc.rows as any[],
        incidents: incidents.rows as any[],
        unsuit: unsuit.rows as any[],
        suspects: suspects.rows as unknown as ThirdPartySuspect[],
        firm: (firm.rows[0] as any) ?? {},
        subCount: Number((subs.rows[0] as any)?.c ?? 0),
      };
    },
    { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles }
  );

  const fy = currentFY();
  const dscThisFy = data.dsc.filter((d) => d.financial_year === fy);
  const selfDone = dscThisFy.some((d) => d.subject_type === "self" && d.status !== "pending");
  const subsDone = dscThisFy.filter((d) => d.subject_type === "sub_distributor" && d.status !== "pending").length;
  const openIncidents = data.incidents.filter((i) => i.status === "open" || i.status === "under_review").length;
  const unsuitIncomplete = data.unsuit.filter((u) => !u.client_acknowledged || !u.execution_only_confirmed).length;

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <Link href="/dashboard/compliance" className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1 mb-2">
          <ArrowLeft className="size-3.5" /> Back to DDQ Readiness
        </Link>
        <h1 className="page-title"><ShieldCheck className="size-6 text-brand-cyan" /> DDQ Compliance Registers</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The evidence AMFI's Due Diligence Questionnaire asks for. Each block cites its DDQ question.
        </p>
      </div>

      {/* Firm declarations — 2.1c / 2.4c / 5.8 / 5.9 */}
      <section className="card-surface p-4">
        <h2 className="font-semibold text-sm flex items-center gap-1.5 mb-3">
          <FileCheck className="size-4 text-brand-cyan" /> Firm declarations
          <span className="text-[10px] text-muted-foreground font-normal">DDQ 2.1c · 2.4c · 5.8 · 5.9</span>
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <Declaration
            label="Relationship model"
            value={REL_LABEL[data.firm.relationship_model] ?? "Not set"}
            ok={!!data.firm.relationship_model}
            hint="DDQ 2.1c"
          />
          <Declaration
            label="Execution fees charged"
            value={data.firm.charges_execution_fees ? "Yes" : "No"}
            ok={!data.firm.charges_execution_fees}
            hint="DDQ 2.4c — must be No on the incidental-advice model"
          />
          <Declaration
            label="AMFI tagline on all comms"
            value={data.firm.amfi_tagline_compliant ? "Compliant" : "Not confirmed"}
            ok={!!data.firm.amfi_tagline_compliant}
            hint="DDQ 5.8 — font ≥ 12, all printed + electronic"
          />
          <Declaration
            label="Social-media disclosure"
            value={data.firm.social_media_disclosure_compliant ? "Compliant" : "Not confirmed"}
            ok={!!data.firm.social_media_disclosure_compliant}
            hint="DDQ 5.9 — SEBI circular Feb 2026"
          />
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Set these in <Link href="/dashboard/settings/firm-profile" className="text-brand-cyan-deep hover:underline">Firm profile</Link>.
        </p>
      </section>

      {/* DSC — 4.26 */}
      <section className="card-surface p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <h2 className="font-semibold text-sm flex items-center gap-1.5">
              <ScrollText className="size-4 text-brand-cyan" /> Declaration of Self-Certification
              <span className="text-[10px] text-muted-foreground font-normal">DDQ 4.26</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Annual, in AMFI's prescribed format — for your ARN <span className="font-medium">and every sub-distributor</span>.
              FY {fy}: self {selfDone ? "✓ filed" : "— pending"} · sub-distributors {subsDone}/{data.subCount} filed.
            </p>
          </div>
          {canEdit && <RegisterQuickAdd register="dsc" defaultFy={fy} />}
        </div>
        <RegisterTable
          empty="No declarations recorded yet."
          head={["FY", "Subject", "ARN", "Status", "Submitted"]}
          rows={data.dsc.map((d) => [
            d.financial_year,
            d.subject_type === "self" ? "Self (firm ARN)" : d.subject_name ?? "Sub-distributor",
            d.arn ?? "—",
            <StatusPill key="s" value={d.status} good={["submitted", "acknowledged"]} />,
            d.submitted_on ?? "—",
          ])}
        />
      </section>

      {/* Incidents — 4.17/4.18/4.20b/6.1/6.2/6.3 */}
      <section className="card-surface p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <h2 className="font-semibold text-sm flex items-center gap-1.5">
              <AlertTriangle className="size-4 text-amber-600" /> Incident register
              <span className="text-[10px] text-muted-foreground font-normal">DDQ 4.17 · 4.18 · 4.20b · 6.1 · 6.2 · 6.3</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Mis-selling complaints, third-party payments, regulatory action, litigation, ARN/EUIN suspension and warning
              letters. {openIncidents > 0 ? `${openIncidents} open.` : "Nothing open."}
            </p>
          </div>
          {canEdit && <RegisterQuickAdd register="incident" />}
        </div>
        <RegisterTable
          empty="No incidents recorded. The DDQ answer is a clean 'No' — keep it that way."
          head={["Date", "Type", "What happened", "Reported to AMC", "Status"]}
          rows={data.incidents.map((i) => [
            i.occurred_on,
            INCIDENT_LABEL[i.kind] ?? i.kind,
            i.title,
            i.reported_to_amc ? "Yes" : "No",
            <StatusPill key="s" value={i.status} good={["resolved", "closed"]} />,
          ])}
        />
      </section>

      {/* Third-party payment detection — 4.20b (auto-scan) */}
      <section className="card-surface p-4">
        <h2 className="font-semibold text-sm flex items-center gap-1.5 mb-1">
          <AlertTriangle className="size-4 text-amber-600" /> Third-party payment scan
          <span className="text-[10px] text-muted-foreground font-normal">DDQ 4.20b — automatic</span>
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Active mandates whose debit account doesn&apos;t match a bank registered against the client. The DDQ requires you
          to monitor that subscription funds come from the investor&apos;s <span className="font-medium">own</span> account.
          Review each one — genuine third-party payments must be logged above and reported to the AMC.
        </p>
        {data.suspects.length === 0 ? (
          <div className="text-sm text-emerald-700 py-4 text-center">
            No mismatches found — every active mandate debits a bank registered to that client.
          </div>
        ) : (
          <RegisterTable
            empty=""
            head={["Client", "Mandate", "Debit account", "Registered account(s)", "Why flagged"]}
            rows={data.suspects.map((s) => [
              s.investor_name ?? "—",
              s.mandate_ref_no ?? "—",
              s.mandate_bank ?? "— none —",
              s.registered_banks ?? "— none on file —",
              <span key="r" className="chip bg-amber-50 text-amber-700 text-[11px]">{SUSPECT_REASON_LABEL[s.reason] ?? s.reason}</span>,
            ])}
          />
        )}
      </section>

      {/* Unsuitability — 2.4b */}
      <section className="card-surface p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <h2 className="font-semibold text-sm flex items-center gap-1.5">
              <FileCheck className="size-4 text-brand-cyan" /> Unsuitability acknowledgements
              <span className="text-[10px] text-muted-foreground font-normal">DDQ 2.4b</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              When a product looks unsuitable: written communication → client acknowledgement → the client's
              &ldquo;execution only&rdquo; confirmation. Your mis-selling defence.
              {unsuitIncomplete > 0 && ` ${unsuitIncomplete} incomplete.`}
            </p>
          </div>
          {canEdit && <RegisterQuickAdd register="unsuitability" />}
        </div>
        <RegisterTable
          empty="No unsuitability records yet."
          head={["Client", "Scheme", "Communicated", "Acknowledged", "Execution-only confirmed"]}
          rows={data.unsuit.map((u) => [
            u.investor_name ?? "—",
            u.scheme_name ?? "—",
            u.communicated_on,
            <YesNo key="a" v={u.client_acknowledged} />,
            <YesNo key="c" v={u.execution_only_confirmed} />,
          ])}
        />
      </section>
    </div>
  );
}

function Declaration({ label, value, ok, hint }: { label: string; value: string; ok: boolean; hint: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold mt-0.5 ${ok ? "text-emerald-700" : "text-amber-700"}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground mt-1">{hint}</div>
    </div>
  );
}

function StatusPill({ value, good }: { value: string; good: string[] }) {
  const isGood = good.includes(value);
  return (
    <span className={`chip text-[11px] ${isGood ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
      {String(value).replace(/_/g, " ")}
    </span>
  );
}

function YesNo({ v }: { v: boolean }) {
  return <span className={v ? "text-emerald-700" : "text-amber-700"}>{v ? "Yes" : "Pending"}</span>;
}

function RegisterTable({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <div className="text-sm text-muted-foreground py-6 text-center">{empty}</div>;
  return (
    <div className="table-scroll">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground border-b">
          <tr>{head.map((h) => <th key={h} className="text-left py-2 pr-4 font-medium whitespace-nowrap">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/50 last:border-0">
              {r.map((c, j) => <td key={j} className="py-2 pr-4 align-top">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
