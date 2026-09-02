import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2 } from "lucide-react";
import { eq, and, inArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { productOfferings, users, legalRegistrations } from "@/db/schema";
import { ProductOfferingForm } from "@/components/product-offerings/ProductOfferingForm";
import { RecordProvenance } from "@/components/common/RecordProvenance";
import { computeOfferingHealth, buildCredMap, daysUntil } from "@/lib/product-offerings/health";

export const dynamic = "force-dynamic";

export default async function ProductOfferingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  // View open to all team members; edit gated to compliance/owner (API enforces too).
  const canEdit = can(session.roles, "compliance.edit", session.permissions);
  const { id } = await params;

  const { row, team, registrations, regMap, credMap } = await withTenant(
    session.tenantId,
    async (tx) => {
      const [row] = await tx
        .select()
        .from(productOfferings)
        .where(eq(productOfferings.id, id))
        .limit(1);
      const team = await tx
        .select({
          id: users.id,
          name: users.name,
          roles: users.roles,
          nismExpiryAt: users.nismExpiryAt,
          nismCertificateNo: users.nismCertificateNo,
          arnExpiryAt: users.arnExpiryAt,
          personalArn: users.personalArn,
          euinExpiryAt: users.euinExpiryAt,
          euin: users.euin,
        })
        .from(users)
        .where(
          and(
            eq(users.tenantId, session.tenantId),
            inArray(users.status, ["active", "offboarding"])
          )
        )
        .orderBy(users.name);
      // Active regs for the picker; a full map (any status) for health lookups so
      // a linked-but-lapsed licence still resolves.
      const registrations = await tx
        .select({
          id: legalRegistrations.id,
          registrationFor: legalRegistrations.registrationFor,
          authority: legalRegistrations.authority,
        })
        .from(legalRegistrations)
        .where(
          and(
            eq(legalRegistrations.tenantId, session.tenantId),
            inArray(legalRegistrations.status, ["active", "pending_renewal"])
          )
        )
        .orderBy(legalRegistrations.registrationFor);
      const allRegs = await tx
        .select({ id: legalRegistrations.id, registrationFor: legalRegistrations.registrationFor, expiryAt: legalRegistrations.expiryAt })
        .from(legalRegistrations)
        .where(eq(legalRegistrations.tenantId, session.tenantId));
      const regMap = new Map<string, { label: string; expiresAt: string | Date | null }>();
      for (const r of allRegs) regMap.set(r.id, { label: r.registrationFor, expiresAt: r.expiryAt });
      const credMap = buildCredMap(team);
      return { row, team, registrations, regMap, credMap };
    }
  );
  if (!row) notFound();

  const health = computeOfferingHealth({
    status: row.status,
    requiredExams: (row.requiredExams ?? []) as string[],
    linkedRegistrationIds: (row.linkedRegistrationIds ?? []) as string[],
    teamMemberIds: (row.teamMemberIds ?? []) as string[],
    regMap,
    credMap,
  });
  const teamNameById = new Map(team.map((t) => [t.id, t.name] as const));

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <Link
          href="/dashboard/product-offerings"
          className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
        >
          <ChevronLeft className="size-3" /> Products &amp; services
        </Link>
        <h1 className="text-2xl font-semibold mt-1">{row.name}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {row.category} · {row.regulator} · {row.status}
        </p>
        <RecordProvenance
          entityType="product_offering"
          entityId={row.id}
          createdAt={row.createdAt}
          updatedAt={row.updatedAt}
          className="mt-1"
        />
      </div>
      {/* Readiness & compliance — licences current + team qualified */}
      <ReadinessPanel
        health={health}
        active={row.status === "active"}
        teamMemberIds={(row.teamMemberIds ?? []) as string[]}
        credMap={credMap}
        teamNameById={teamNameById}
      />

      {canEdit ? (
        <ProductOfferingForm
          mode="edit"
          teamCatalog={team.map((t) => ({
            id: t.id,
            name: t.name,
            roles: (t.roles ?? []) as string[],
          }))}
          registrationCatalog={registrations}
          initial={{
            id: row.id,
            name: row.name,
            category: row.category,
            providers: (row.providers ?? []) as string[],
            regulator: row.regulator,
            linkedRegistrationIds: (row.linkedRegistrationIds ?? []) as string[],
            requiredExams: (row.requiredExams ?? []) as string[],
            teamMemberIds: (row.teamMemberIds ?? []) as string[],
            status: row.status,
            launchedAt: row.launchedAt ? String(row.launchedAt) : null,
            discontinuedAt: row.discontinuedAt ? String(row.discontinuedAt) : null,
            documents: (row.documents ?? []) as any[],
            remarks: row.remarks,
          }}
        />
      ) : (
        <ReadOnlyOffering row={row} regMap={regMap} teamNameById={teamNameById} />
      )}
    </div>
  );
}

function ReadinessPanel({
  health,
  active,
  teamMemberIds,
  credMap,
  teamNameById,
}: {
  health: ReturnType<typeof computeOfferingHealth>;
  active: boolean;
  teamMemberIds: string[];
  credMap: Map<string, { id: string; name: string; nismOk: boolean; arnOk: boolean; euinOk: boolean }>;
  teamNameById: Map<string, string>;
}) {
  const licTone = health.license === "expired" ? "text-rose-600" : health.license === "expiring" ? "text-amber-600" : "text-emerald-600";
  const reqLabels: string[] = [];
  if (health.requires.nism) reqLabels.push("NISM");
  if (health.requires.arn) reqLabels.push("ARN");
  if (health.requires.euin) reqLabels.push("EUIN");

  return (
    <div className="card-surface p-4 space-y-3">
      <h2 className="font-semibold text-sm flex items-center gap-2">
        {health.license === "expired" || health.readiness === "blocked" ? (
          <ShieldAlert className={`size-4 ${active ? "text-rose-600" : "text-slate-400"}`} />
        ) : health.license === "expiring" || health.readiness === "attention" || health.readiness === "no_team" ? (
          <AlertTriangle className="size-4 text-amber-600" />
        ) : (
          <ShieldCheck className="size-4 text-emerald-600" />
        )}
        Readiness &amp; compliance
      </h2>

      {/* Licences */}
      <div>
        <div className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">Authorising licences</div>
        {health.licenses.length === 0 ? (
          <p className="text-xs text-muted-foreground">No licence linked. {active ? "Link the registration that authorises this offering." : ""}</p>
        ) : (
          <ul className="space-y-1">
            {health.licenses.map((l) => {
              const dl = l.daysLeft;
              const tone = dl == null ? "text-muted-foreground" : dl < 0 ? "text-rose-600 font-medium" : dl < 90 ? "text-amber-600" : "text-foreground";
              return (
                <li key={l.id} className="text-xs flex items-center gap-2">
                  <span className="font-medium">{l.label}</span>
                  <span className={tone}>
                    {dl == null ? "no expiry on file" : dl < 0 ? `expired ${-dl}d ago` : `expires in ${dl}d`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {active && health.license === "expired" && (
          <p className="text-[11px] text-rose-700 mt-1">⚠ This offering is active but its authorising licence has lapsed — a SEBI-inspection risk.</p>
        )}
      </div>

      {/* Team readiness */}
      <div>
        <div className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">
          Team readiness{reqLabels.length ? ` · requires ${reqLabels.join(" + ")}` : ""}
        </div>
        {teamMemberIds.length === 0 ? (
          <p className="text-xs text-amber-700">No team member assigned to this offering.</p>
        ) : reqLabels.length === 0 ? (
          <p className="text-xs text-muted-foreground">{teamMemberIds.length} assigned · no verifiable cert requirement.</p>
        ) : (
          <ul className="space-y-1">
            {teamMemberIds.map((uid) => {
              const c = credMap.get(uid);
              const name = teamNameById.get(uid) ?? "—";
              if (!c) return <li key={uid} className="text-xs text-muted-foreground">{name}</li>;
              const checks = [
                health.requires.nism ? { label: "NISM", ok: c.nismOk } : null,
                health.requires.arn ? { label: "ARN", ok: c.arnOk } : null,
                health.requires.euin ? { label: "EUIN", ok: c.euinOk } : null,
              ].filter(Boolean) as Array<{ label: string; ok: boolean }>;
              const allOk = checks.every((x) => x.ok);
              return (
                <li key={uid} className="text-xs flex items-center gap-2">
                  {allOk ? <CheckCircle2 className="size-3.5 text-emerald-600 shrink-0" /> : <AlertTriangle className="size-3.5 text-amber-600 shrink-0" />}
                  <span className="font-medium">{name}</span>
                  <span className="flex gap-1.5">
                    {checks.map((x) => (
                      <span key={x.label} className={x.ok ? "text-emerald-700" : "text-rose-600"}>{x.label}{x.ok ? "✓" : "✗"}</span>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {health.unverifiable.length > 0 && (
          <p className="text-[11px] text-muted-foreground mt-1">Also requires (not auto-verified): {health.unverifiable.join(", ")}</p>
        )}
      </div>
    </div>
  );
}

function ReadOnlyOffering({
  row,
  regMap,
  teamNameById,
}: {
  row: any;
  regMap: Map<string, { label: string; expiresAt: string | Date | null }>;
  teamNameById: Map<string, string>;
}) {
  const providers = (row.providers ?? []) as string[];
  const team = ((row.teamMemberIds ?? []) as string[]).map((id) => teamNameById.get(id)).filter(Boolean);
  const licences = ((row.linkedRegistrationIds ?? []) as string[]).map((id) => regMap.get(id)?.label).filter(Boolean);
  const exams = (row.requiredExams ?? []) as string[];
  return (
    <div className="card-surface p-4 space-y-3 text-sm">
      <Field label="Providers" value={providers.join(", ") || "—"} />
      <Field label="Authorising licences" value={licences.join(", ") || "—"} />
      <Field label="Required exams" value={exams.join(", ") || "—"} />
      <Field label="Team" value={(team as string[]).join(", ") || "—"} />
      {row.remarks && <Field label="Remarks" value={row.remarks} />}
      <p className="text-[11px] text-muted-foreground pt-1 border-t">Read-only — editing offerings is restricted to the compliance/owner team.</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2">
      <div className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">{label}</div>
      <div>{value}</div>
    </div>
  );
}
