/**
 * MF Investment Calculators — Network FP "3.5 MF Investment Calculators"
 * parity (extended). Searchable calculator gallery, no DB writes. RM uses
 * these during client meetings to demonstrate scenarios live.
 *
 * Print/PDF output carries the SAME branded letterhead + footer as the proposal
 * PDF (firm logo, name, ARN, brand strip, footer line) so a calculator
 * illustration handed to a client looks like an official firm document.
 */

import Link from "next/link";
import { Calculator, SlidersHorizontal } from "lucide-react";
import { eq } from "drizzle-orm";
import { CalculatorsApp } from "@/components/calculators/CalculatorsApp";
import { FirmLogo } from "@/components/common/FirmLogo";
import { withTenant } from "@/db/client";
import { tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils";
import { loadCalcAssumptions } from "@/lib/calculators/assumptions";

export const dynamic = "force-dynamic";

export default async function CalculatorsPage() {
  const session = await requireSession();
  const { tenant, assumptions } = await withTenant(session.tenantId, async (tx) => ({
    tenant: (await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0] ?? null,
    assumptions: await loadCalcAssumptions(tx, session.tenantId),
  }));
  const primary = (tenant as any)?.primaryColor || "#0e2557";
  const accent = (tenant as any)?.secondaryColor || (tenant as any)?.accentColor || "#0ea5e9";
  const firmName = tenant?.legalName ?? tenant?.displayName ?? "—";
  const arnClean = (tenant?.arn ?? "").replace(/^ARN-?/i, "");

  return (
    <div className="space-y-5">
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm 12mm; }
          body { background: #fff !important; }
        }
      `}</style>

      {/* Branded letterhead — ONLY on print/PDF (matches the proposal PDF) */}
      <div className="hidden print:block">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <FirmLogo
              src={tenant?.logoUrl}
              name={tenant?.displayName ?? tenant?.legalName}
              color={primary}
              size={44}
              radius={10}
              maxWidth={170}
            />
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{firmName}</div>
              <div style={{ fontSize: 11, color: "#64748b" }}>
                ARN · {tenant?.arn ?? "—"}
                {(tenant as any)?.gstNumber ? ` · GSTIN ${(tenant as any).gstNumber}` : ""}
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: primary }}>Investment Illustration</div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>Prepared {formatDate(new Date())}</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>by {session.name}</div>
          </div>
        </div>
        <div
          style={{
            height: 6,
            borderRadius: 4,
            background: `linear-gradient(90deg, ${primary} 0%, ${accent} 100%)`,
            margin: "12px 0 6px",
          }}
        />
      </div>

      {/* On-screen heading — hidden on print (the letterhead replaces it) */}
      <div className="print:hidden flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Calculator className="size-6" /> MF Investment Calculators
          </h1>
        </div>
        <Link href="/dashboard/calculators/settings" className="btn-secondary text-xs shrink-0">
          <SlidersHorizontal className="size-3.5" /> Assumptions
        </Link>
      </div>

      <CalculatorsApp firmName={firmName} assumptions={assumptions} />

      {/* Disclaimer must stay visible in print/PDF — any illustration handed
          to a client has to carry the market-risk disclaimer (AMFI best
          practice; mirrors the 3.5 spreadsheet, which keeps it on the
          printable sheet). Do NOT add print:hidden here. */}
      <div className="text-[11px] text-muted-foreground border-t pt-3">
        <strong>Disclaimer:</strong> Past performance may or may not be
        sustained in future and is not a guarantee of any future returns.
        These calculators are for illustration only and do not represent
        actual returns. Mutual fund investments are subject to market
        risks. Read all scheme related documents carefully.
      </div>

      {/* Branded footer line — ONLY on print/PDF */}
      <div
        className="hidden print:flex"
        style={{
          marginTop: 16,
          paddingTop: 10,
          borderTop: "1px solid #e2e8f0",
          fontSize: 9,
          color: "#64748b",
          justifyContent: "space-between",
        }}
      >
        <div>{firmName} · ARN-{arnClean}</div>
        <div>Investment calculator illustration</div>
      </div>
    </div>
  );
}
