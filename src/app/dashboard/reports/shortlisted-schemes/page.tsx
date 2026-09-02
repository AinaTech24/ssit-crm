/**
 * AMC Schemes Shortlist — Network FP "3.1 AMC Schemes" parity.
 *
 * One card per empanelled AMC, with the firm's investment-committee
 * notes (philosophy / strengths / red flags) and the shortlisted
 * schemes from that AMC grouped by coarse category (Equity / Hybrid /
 * Debt / Liquid / Commodity / International / Other).
 *
 * Designed for print — the IC takes this to its quarterly review,
 * and it's the canonical "what do we recommend" document at audit.
 */

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { and, eq, inArray, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { amcEmpanelments, schemeMaster, users } from "@/db/schema";
import { PrintButton } from "@/components/settings/PrintButton";

export const dynamic = "force-dynamic";

const COARSE_LABELS: Record<string, string> = {
  equity: "Equity",
  hybrid: "Hybrid",
  debt: "Debt",
  liquid: "Liquid",
  commodity: "Commodity",
  international: "International",
  other: "Other",
};

const COARSE_ORDER = [
  "equity",
  "hybrid",
  "debt",
  "liquid",
  "commodity",
  "international",
  "other",
];

const COARSE_TONE: Record<string, string> = {
  equity: "bg-emerald-50 text-emerald-700 border-emerald-200",
  hybrid: "bg-blue-50 text-blue-700 border-blue-200",
  debt: "bg-amber-50 text-amber-700 border-amber-200",
  liquid: "bg-cyan-50 text-cyan-700 border-cyan-200",
  commodity: "bg-orange-50 text-orange-700 border-orange-200",
  international: "bg-violet-50 text-violet-700 border-violet-200",
  other: "bg-slate-50 text-slate-700 border-slate-200",
};

export default async function ShortlistedSchemesPage() {
  const session = await requireSession();
  requireCap(session.roles, "compliance.edit", session.permissions);
  await assertActiveLicense(session.tenantId, session.roles);

  const data = await withTenant(session.tenantId, async (tx) => {
    const empanelments = await tx
      .select()
      .from(amcEmpanelments)
      .where(
        and(
          eq(amcEmpanelments.tenantId, session.tenantId),
          eq(amcEmpanelments.status, "empanelled")
        )
      )
      .orderBy(amcEmpanelments.amcName);

    // All shortlisted schemes for this tenant
    const schemes = await tx
      .select({
        id: schemeMaster.id,
        amcCode: schemeMaster.amcCode,
        schemeName: schemeMaster.schemeName,
        category: schemeMaster.category,
        coarseCategory: schemeMaster.coarseCategory,
        shortlistRationale: schemeMaster.shortlistRationale,
        shortlistedAt: schemeMaster.shortlistedAt,
        shortlistedBy: schemeMaster.shortlistedBy,
        riskCategory: schemeMaster.riskCategory,
      })
      .from(schemeMaster)
      .where(
        and(
          eq(schemeMaster.tenantId, session.tenantId),
          eq(schemeMaster.isShortlisted, true)
        )
      )
      .orderBy(schemeMaster.schemeName);

    // Resolve approver names
    const userIds = [
      ...new Set(schemes.map((s) => s.shortlistedBy).filter(Boolean)),
    ] as string[];
    const userMap = new Map<string, string>();
    if (userIds.length > 0) {
      const us = await tx
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, userIds));
      for (const u of us) userMap.set(u.id, u.name);
    }
    return { empanelments, schemes, userMap };
  });

  // Group schemes by AMC code, then by coarse category within each AMC
  const byAmc = new Map<
    string,
    { byCategory: Map<string, typeof data.schemes>; count: number }
  >();
  for (const s of data.schemes) {
    if (!byAmc.has(s.amcCode)) {
      byAmc.set(s.amcCode, { byCategory: new Map(), count: 0 });
    }
    const entry = byAmc.get(s.amcCode)!;
    const cat = s.coarseCategory ?? "other";
    if (!entry.byCategory.has(cat)) entry.byCategory.set(cat, []);
    entry.byCategory.get(cat)!.push(s);
    entry.count++;
  }

  const totalShortlisted = data.schemes.length;

  return (
    <div className="space-y-5 max-w-6xl print:max-w-none">
      <div className="flex items-center justify-between print:hidden">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Link
              href="/dashboard/reports"
              className="hover:underline inline-flex items-center gap-1"
            >
              <ChevronLeft className="size-3" /> Reports
            </Link>
          </div>
          <h1 className="text-2xl font-semibold">AMC scheme shortlist</h1>
          <p className="text-sm text-muted-foreground mt-1">
            The investment-committee buy list — one card per empanelled
            AMC with our philosophy notes and the schemes we recommend.
          </p>
        </div>
        <PrintButton />
      </div>

      <div className="hidden print:block text-center mb-3">
        <h1 className="text-xl font-bold">AMC Schemes Shortlist</h1>
        <p className="text-xs text-slate-500">
          Generated {new Date().toLocaleDateString("en-GB")} · {totalShortlisted}{" "}
          schemes across {byAmc.size} AMCs
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 print:hidden">
        <Tile label="Empanelled AMCs" value={data.empanelments.length} />
        <Tile label="AMCs on shortlist" value={byAmc.size} />
        <Tile label="Total schemes shortlisted" value={totalShortlisted} />
        <Tile
          label="AMCs with no shortlist"
          value={data.empanelments.length - byAmc.size}
          tone={
            data.empanelments.length - byAmc.size > 0 ? "amber" : undefined
          }
        />
      </div>

      {data.empanelments.length === 0 ? (
        <div className="card-surface p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No empanelled AMCs on record. Add one at{" "}
            <Link
              href="/dashboard/amc-empanelments/new"
              className="text-violet-600 hover:underline"
            >
              AMC Empanelments
            </Link>{" "}
            first.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {data.empanelments.map((amc) => {
            const entry = byAmc.get(amc.amcCode);
            return (
              <div
                key={amc.id}
                className="card-surface p-5 space-y-3 print:break-inside-avoid"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{amc.amcName}</h2>
                    <div className="text-[11px] text-muted-foreground">
                      {amc.amcCode}
                      {amc.distributorCode && ` · ${amc.distributorCode}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 print:hidden">
                    <span className="text-xs text-muted-foreground">
                      {entry?.count ?? 0} shortlisted
                    </span>
                    <Link
                      href={`/dashboard/amc-empanelments/${amc.id}`}
                      className="text-[11px] text-violet-600 hover:underline"
                    >
                      Manage →
                    </Link>
                  </div>
                </div>

                {/* IC due diligence */}
                {((amc as any).investmentPhilosophy ||
                  (amc as any).fundHouseStrengths ||
                  (amc as any).redFlags) && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {(amc as any).investmentPhilosophy && (
                      <DueDiligenceCell
                        label="Investment philosophy"
                        body={(amc as any).investmentPhilosophy}
                        tone="cyan"
                      />
                    )}
                    {(amc as any).fundHouseStrengths && (
                      <DueDiligenceCell
                        label="Strengths"
                        body={(amc as any).fundHouseStrengths}
                        tone="emerald"
                      />
                    )}
                    {(amc as any).redFlags && (
                      <DueDiligenceCell
                        label="Red flags"
                        body={(amc as any).redFlags}
                        tone="rose"
                      />
                    )}
                  </div>
                )}

                {/* Shortlisted schemes grouped by coarse category */}
                {!entry || entry.count === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    No schemes shortlisted from this AMC yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {COARSE_ORDER.filter((c) => entry.byCategory.has(c)).map(
                      (cat) => {
                        const list = entry.byCategory.get(cat)!;
                        return (
                          <div
                            key={cat}
                            className={`border rounded-md p-3 ${COARSE_TONE[cat]}`}
                          >
                            <div className="text-[10px] uppercase tracking-wide font-semibold mb-1.5">
                              {COARSE_LABELS[cat]} · {list.length} scheme
                              {list.length === 1 ? "" : "s"}
                            </div>
                            <ul className="space-y-1.5">
                              {list.map((s) => (
                                <li
                                  key={s.id}
                                  className="text-xs leading-relaxed"
                                >
                                  <span className="font-medium">
                                    {s.schemeName}
                                  </span>
                                  {s.category && (
                                    <span className="text-[10px] opacity-70 ml-1">
                                      ({s.category})
                                    </span>
                                  )}
                                  {s.shortlistRationale && (
                                    <div className="text-[11px] opacity-80 mt-0.5 italic">
                                      “{s.shortlistRationale}”
                                    </div>
                                  )}
                                  {s.shortlistedBy && (
                                    <div className="text-[10px] opacity-60 mt-0.5 print:hidden">
                                      Approved by{" "}
                                      {data.userMap.get(s.shortlistedBy) ?? "—"}
                                      {s.shortlistedAt &&
                                        ` · ${new Date(
                                          s.shortlistedAt
                                        ).toLocaleDateString("en-GB", {
                                          day: "2-digit",
                                          month: "short",
                                          year: "2-digit",
                                        })}`}
                                    </div>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      }
                    )}
                  </div>
                )}

                {amc.remarks && (
                  <div className="text-[11px] text-muted-foreground italic pt-1 border-t border-slate-100">
                    Remarks: {amc.remarks}
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

function DueDiligenceCell({
  label,
  body,
  tone,
}: {
  label: string;
  body: string;
  tone: "cyan" | "emerald" | "rose";
}) {
  const headerTone =
    tone === "cyan"
      ? "text-cyan-700"
      : tone === "emerald"
        ? "text-emerald-700"
        : "text-rose-700";
  return (
    <div className="text-xs">
      <div
        className={`text-[10px] uppercase tracking-wide font-semibold mb-0.5 ${headerTone}`}
      >
        {label}
      </div>
      <div className="text-foreground whitespace-pre-wrap">{body}</div>
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "amber" | "rose";
}) {
  const cardTone =
    value > 0 && tone === "rose"
      ? "border-rose-200 bg-rose-50/40"
      : value > 0 && tone === "amber"
        ? "border-amber-200 bg-amber-50/40"
        : "";
  return (
    <div className={`card-surface p-3 ${cardTone}`}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

// Touch sql to avoid unused-import warning
void sql;
