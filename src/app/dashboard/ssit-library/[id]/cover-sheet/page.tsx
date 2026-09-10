/**
 * Branded cover sheet — a printable single-page PDF the MFD prepends to
 * articles, PDFs, presentations etc. before sharing with clients. Auto-fires
 * window.print() on mount.
 *
 * The dashboard layout hides its sidebar + topbar on @media print thanks to
 * the global print:hidden rules added in the UI overhaul.
 */

import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { contentLibraryAssets, tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { assetVisibleTo } from "@/lib/content/asset-url";
import { ProposalPrintHelper } from "@/components/proposals/ProposalPrintHelper";
import { FirmLogo } from "@/components/common/FirmLogo";

export const dynamic = "force-dynamic";

export default async function CoverSheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  // Tenant context: the bespoke RLS policy (global OR own tenant) scopes the
  // lookup; the predicate is belt-and-suspenders. (withSystem would crash —
  // its empty-string app.tenant_id default is cast to ''::uuid by the policy.)
  const asset = await withTenant(session.tenantId, async (tx) =>
    (await tx
      .select()
      .from(contentLibraryAssets)
      .where(and(eq(contentLibraryAssets.id, id), assetVisibleTo(session.tenantId)))
      .limit(1))[0] ?? null
  );
  if (!asset) notFound();
  const tenant = (await withTenant(session.tenantId, async (tx) =>
    tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1)
  ))[0];
  const primary = (tenant as any)?.primaryColor || "#841f21";
  const accent = "#d22e32";
  const address = (tenant as any)?.address;
  const addressStr =
    typeof address === "string"
      ? address
      : address
      ? [address.line1, address.line2, address.city, address.state, address.pincode]
          .filter(Boolean)
          .join(", ")
      : "";

  return (
    <>
      <ProposalPrintHelper proposalId={asset.id} recipientName={asset.title} />
      <style>{`
        @media print {
          @page { size: A4; margin: 18mm 16mm; }
          body { background: white !important; }
        }
        .cs-page {
          background: white;
          color: #0f172a;
          max-width: 800px;
          margin: 0 auto;
          padding: 36px 40px 48px;
          font-family: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
          min-height: 90vh;
          display: flex;
          flex-direction: column;
        }
        .cs-strip { height: 6px; border-radius: 4px;
          background: linear-gradient(90deg, ${primary} 0%, ${accent} 100%);
          margin: 18px 0 24px; }
      `}</style>

      <div className="cs-page">
        {/* Letterhead */}
        <div className="flex items-center gap-4">
          <FirmLogo
            src={(tenant as any)?.logoUrl}
            name={tenant?.displayName ?? tenant?.legalName}
            color={primary}
            size={64}
            radius={14}
            maxWidth={220}
          />
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.01em" }}>
              {tenant?.legalName ?? tenant?.displayName}
            </div>
            <div style={{ color: "#64748b", fontSize: 12 }}>
              ARN {tenant?.arn ?? "—"}
              {(tenant as any)?.gstNumber && ` · GSTIN ${(tenant as any).gstNumber}`}
            </div>
          </div>
        </div>

        <div className="cs-strip" />

        {/* Title block */}
        <div style={{ marginTop: 8 }}>
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.16em",
              fontWeight: 700,
              color: primary,
            }}
          >
            Shared by your advisor — {asset.category.replace(/_/g, " ")}
          </div>
          <h1
            style={{
              fontSize: 30,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              margin: "10px 0 14px",
            }}
          >
            {asset.title}
          </h1>
          {asset.description && (
            <p style={{ color: "#334155", fontSize: 14, lineHeight: 1.65 }}>
              {asset.description}
            </p>
          )}
        </div>

        <div style={{ flex: 1 }} />

        {/* Footer with full firm contact */}
        <div
          style={{
            marginTop: 36,
            borderTop: "1px solid #e2e8f0",
            paddingTop: 16,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            fontSize: 11,
            color: "#475569",
            lineHeight: 1.6,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                fontWeight: 700,
                color: "#64748b",
              }}
            >
              Get in touch
            </div>
            {(tenant as any)?.phone && <div>☎ {(tenant as any).phone}</div>}
            {(tenant as any)?.email && <div>✉ {(tenant as any).email}</div>}
            {(tenant as any)?.website && <div>🌐 {(tenant as any).website}</div>}
          </div>
          <div>
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                fontWeight: 700,
                color: "#64748b",
              }}
            >
              Address
            </div>
            <div>{addressStr || "—"}</div>
          </div>
        </div>

        <div
          style={{
            marginTop: 10,
            fontSize: 9,
            color: "#94a3b8",
            lineHeight: 1.5,
          }}
        >
          {tenant?.legalName ?? tenant?.displayName} · ARN-
          {(tenant?.arn ?? "").replace(/^ARN-?/i, "")} · Mutual Fund investments are subject to
          market risks. Read all scheme-related documents carefully.
        </div>
      </div>
    </>
  );
}
