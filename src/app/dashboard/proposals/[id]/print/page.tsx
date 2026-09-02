/**
 * Branded printable proposal — for client sharing as PDF.
 *
 * Loads tenant + recipient + proposal data server-side, then a small
 * client helper auto-triggers window.print() once on mount. The user
 * picks "Save as PDF" in the dialog and shares it via WhatsApp / email.
 *
 * The styles use a strict A4-sized layout with tenant-color accents.
 */

import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { FirmLogo } from "@/components/common/FirmLogo";
import { withTenant } from "@/db/client";
import { proposals, tenants, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatDate, formatINR } from "@/lib/utils";
import { ProposalPrintHelper } from "@/components/proposals/ProposalPrintHelper";
import { fvLumpAnnual } from "@/lib/proposals/projections";
import { fvSip } from "@/lib/goal-planning/calc";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  comprehensive: "Comprehensive Investment Plan",
  mutual_fund: "Mutual Fund Proposal",
  insurance: "Insurance Proposal",
  pms: "PMS Proposal",
  aif: "AIF Proposal",
  mixed: "Investment Proposal",
};

const KIND_TITLE: Record<string, string> = {
  mf: "Mutual Fund Recommendations",
  insurance: "Insurance Recommendations",
  pms: "Portfolio Management Services",
  aif: "Alternative Investment Funds",
  other: "Other Investment Products",
};

// MF is rendered first as split Lumpsum/SIP tables; `other` is rendered last.
// This loop covers the remaining kinds in between.
const KIND_ORDER = ["insurance", "pms", "aif"] as const;

export default async function ProposalPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const data = await withTenant(session.tenantId, async (tx) => {
    const p = (
      await tx.select().from(proposals).where(eq(proposals.id, id)).limit(1)
    )[0];
    if (!p) return null;
    const tenant = (
      await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1)
    )[0];
    const preparedBy = p.preparedByUserId
      ? (await tx.select().from(users).where(eq(users.id, p.preparedByUserId)).limit(1))[0]
      : null;
    return { p, tenant, preparedBy };
  });
  if (!data) notFound();
  const { p, tenant, preparedBy } = data;
  const products = ((p.products ?? []) as any[]) || [];
  const primary = (tenant as any)?.primaryColor || "#0e2557";
  const accent = (tenant as any)?.accentColor || "#0ea5e9";

  // Group products by kind for the report
  const grouped: Record<string, any[]> = {};
  for (const it of products) {
    if (!grouped[it.kind]) grouped[it.kind] = [];
    grouped[it.kind].push(it);
  }

  return (
    <>
      <ProposalPrintHelper proposalId={p.id} recipientName={p.recipientName} />

      <style>{`
        @media print {
          @page { size: A4; margin: 14mm 12mm; }
          body { background: white !important; }
        }
        .pp-page {
          background: white;
          color: #0f172a;
          max-width: 800px;
          margin: 0 auto;
          padding: 28px 32px 48px;
          font-family: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
        }
        .pp-h1 { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
        .pp-h2 { font-size: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${primary}; }
        .pp-muted { color: #64748b; }
        .pp-strip {
          height: 6px; border-radius: 4px;
          background: linear-gradient(90deg, ${primary} 0%, ${accent} 100%);
          margin: 16px 0 20px;
        }
        .pp-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .pp-table th, .pp-table td { border-bottom: 1px solid #e2e8f0; padding: 8px 8px; text-align: left; vertical-align: top; }
        .pp-table th { background: #f8fafc; font-weight: 700; color: #475569; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
        .pp-total-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 14px; }
        .pp-chip { display: inline-block; padding: 2px 8px; font-size: 10px; font-weight: 700; border-radius: 999px; background: ${primary}10; color: ${primary}; }
        .pp-section { page-break-inside: avoid; }
      `}</style>

      <div className="pp-page">
        {/* Tenant letterhead */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <FirmLogo
              src={tenant?.logoUrl}
              name={tenant?.displayName ?? tenant?.legalName}
              color={primary}
              size={48}
              radius={10}
              maxWidth={170}
            />
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {tenant?.legalName ?? tenant?.displayName ?? "—"}
              </div>
              <div className="pp-muted" style={{ fontSize: 11 }}>
                ARN · {tenant?.arn ?? "—"}
                {tenant?.gstNumber && ` · GSTIN ${tenant.gstNumber}`}
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="pp-chip">{p.proposalNumber}</div>
            <div className="pp-muted" style={{ fontSize: 11, marginTop: 4 }}>
              Prepared {formatDate(p.preparedAt)}
            </div>
            {p.validUntil && (
              <div className="pp-muted" style={{ fontSize: 11 }}>
                Valid till {formatDate(p.validUntil)}
              </div>
            )}
          </div>
        </div>

        <div className="pp-strip" />

        {/* Title */}
        <div className="pp-h2" style={{ marginBottom: 4 }}>
          {TYPE_LABEL[p.type] ?? "Investment Proposal"}
        </div>
        <div className="pp-h1">{p.title}</div>
        {p.summary && (
          <p className="pp-muted" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
            {p.summary}
          </p>
        )}

        {/* Recipient block */}
        <div
          style={{
            marginTop: 24,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
          }}
        >
          <div>
            <div className="pp-muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
              Prepared for
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>
              {p.recipientName}
            </div>
            <div className="pp-muted" style={{ fontSize: 12, marginTop: 2 }}>
              {p.recipientEmail ?? "—"}{p.recipientPhone ? ` · ${p.recipientPhone}` : ""}
            </div>
          </div>
          <div>
            <div className="pp-muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
              Prepared by
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>
              {preparedBy?.name ?? "—"}
            </div>
            <div className="pp-muted" style={{ fontSize: 12, marginTop: 2 }}>
              {(preparedBy as any)?.email ?? "—"}{(preparedBy as any)?.euin ? ` · EUIN ${(preparedBy as any).euin}` : ""}
            </div>
          </div>
        </div>

        {/* Cover letter */}
        {p.coverLetter && (
          <div className="pp-section" style={{ marginTop: 28 }}>
            <p style={{ fontSize: 13, lineHeight: 1.65, whiteSpace: "pre-line" }}>
              {p.coverLetter}
            </p>
          </div>
        )}

        {/* Totals summary card */}
        {(p.totalInvestment || p.expectedCorpus || p.riskRating) && (
          <div className="pp-total-card pp-section" style={{ marginTop: 24 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
              <div>
                <div className="pp-muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                  Total investment
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>
                  {p.totalInvestment ? formatINR(Number(p.totalInvestment)) : "—"}
                </div>
              </div>
              <div>
                <div className="pp-muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                  Projected corpus
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, color: "#059669" }}>
                  {p.expectedCorpus ? formatINR(Number(p.expectedCorpus)) : "—"}
                </div>
              </div>
              <div>
                <div className="pp-muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                  Risk rating
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, textTransform: "capitalize" }}>
                  {p.riskRating ?? "—"}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Mutual Funds — split into Lumpsum & SIP vehicle tables */}
        {(() => {
          const mf = grouped["mf"] ?? [];
          const lump = mf.filter((it: any) => Number(it.lumpsum ?? 0) > 0);
          const sip = mf.filter((it: any) => Number(it.monthlyAmount ?? 0) > 0);
          const mfNotes = mf.filter((it: any) => it.notes);
          if (mf.length === 0) return null;
          return (
            <>
              {lump.length > 0 && (
                <div className="pp-section" style={{ marginTop: 28 }}>
                  <div className="pp-h2">Mutual Fund — Lumpsum</div>
                  <div style={{ marginTop: 8 }}>
                    <table className="pp-table">
                      <thead>
                        <tr>
                          <th style={{ width: "32%" }}>Scheme</th>
                          <th>AMC / Category</th>
                          <th style={{ textAlign: "right" }}>Lumpsum</th>
                          <th style={{ textAlign: "right" }}>Period</th>
                          <th style={{ textAlign: "right" }}>Assumed Return</th>
                          <th style={{ textAlign: "right" }}>Expected Future Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lump.map((it: any, i: number) => {
                          const years = Number(it.sipTermYears ?? 0);
                          const fv = fvLumpAnnual(Number(it.lumpsum ?? 0), Number(it.expectedReturn ?? 0), years);
                          return (
                            <tr key={i}>
                              <td style={{ fontWeight: 700 }}>{it.schemeName}</td>
                              <td>
                                {it.amcName ?? "—"}
                                {it.category && (
                                  <div className="pp-muted" style={{ fontSize: 11 }}>{it.category}</div>
                                )}
                              </td>
                              <td style={{ textAlign: "right" }}>{formatINR(Number(it.lumpsum))}</td>
                              <td style={{ textAlign: "right" }}>{years ? `${years} yrs` : "—"}</td>
                              <td style={{ textAlign: "right" }}>{it.expectedReturn ? `${it.expectedReturn}%` : "—"}</td>
                              <td style={{ textAlign: "right", color: "#059669", fontWeight: 700 }}>
                                {fv > 0 ? formatINR(Math.round(fv)) : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {sip.length > 0 && (
                <div className="pp-section" style={{ marginTop: 28 }}>
                  <div className="pp-h2">Mutual Fund — SIP</div>
                  <div style={{ marginTop: 8 }}>
                    <table className="pp-table">
                      <thead>
                        <tr>
                          <th style={{ width: "30%" }}>Scheme</th>
                          <th>AMC / Category</th>
                          <th style={{ textAlign: "right" }}>Monthly SIP</th>
                          <th style={{ textAlign: "right" }}>Period</th>
                          <th style={{ textAlign: "right" }}>Assumed Return</th>
                          <th style={{ textAlign: "right" }}>Total Invested</th>
                          <th style={{ textAlign: "right" }}>Expected Future Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sip.map((it: any, i: number) => {
                          const years = Number(it.sipTermYears ?? 0);
                          const monthly = Number(it.monthlyAmount ?? 0);
                          const invested = monthly * 12 * years;
                          const fv = fvSip(monthly, Number(it.expectedReturn ?? 0), Math.round(years * 12));
                          return (
                            <tr key={i}>
                              <td style={{ fontWeight: 700 }}>{it.schemeName}</td>
                              <td>
                                {it.amcName ?? "—"}
                                {it.category && (
                                  <div className="pp-muted" style={{ fontSize: 11 }}>{it.category}</div>
                                )}
                              </td>
                              <td style={{ textAlign: "right" }}>{formatINR(monthly)}/mo</td>
                              <td style={{ textAlign: "right" }}>{years ? `${years} yrs` : "—"}</td>
                              <td style={{ textAlign: "right" }}>{it.expectedReturn ? `${it.expectedReturn}%` : "—"}</td>
                              <td style={{ textAlign: "right" }}>{invested > 0 ? formatINR(invested) : "—"}</td>
                              <td style={{ textAlign: "right", color: "#059669", fontWeight: 700 }}>
                                {fv > 0 ? formatINR(Math.round(fv)) : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {mfNotes.length > 0 && (
                <div className="pp-section" style={{ marginTop: 8 }}>
                  {mfNotes.map((it: any, i: number) => (
                    <div
                      key={i}
                      style={{ fontSize: 11, color: "#475569", marginTop: 4, paddingLeft: 8, borderLeft: `2px solid ${accent}` }}
                    >
                      <strong>{it.schemeName}: </strong>
                      {it.notes}
                    </div>
                  ))}
                </div>
              )}
            </>
          );
        })()}

        {/* Products — one section per kind (insurance / pms / aif) */}
        {KIND_ORDER.filter((k) => grouped[k]).map((kind) => (
          <div className="pp-section" key={kind} style={{ marginTop: 28 }}>
            <div className="pp-h2">{KIND_TITLE[kind]}</div>
            <div style={{ marginTop: 8 }}>
              {kind === "insurance" && (
                <table className="pp-table">
                  <thead>
                    <tr>
                      <th style={{ width: "30%" }}>Policy</th>
                      <th>Insurer / Type</th>
                      <th style={{ textAlign: "right" }}>Sum Assured</th>
                      <th style={{ textAlign: "right" }}>Annual Premium</th>
                      <th style={{ textAlign: "right" }}>Term</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped[kind].map((it: any, i: number) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 700 }}>{it.policyName}</td>
                        <td>
                          {it.insurer ?? "—"}
                          {it.policyType && (
                            <div className="pp-muted" style={{ fontSize: 11, textTransform: "capitalize" }}>
                              {it.policyType}
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>{it.sumAssured ? formatINR(Number(it.sumAssured)) : "—"}</td>
                        <td style={{ textAlign: "right" }}>{it.annualPremium ? formatINR(Number(it.annualPremium)) : "—"}</td>
                        <td style={{ textAlign: "right" }}>{it.termYears ? `${it.termYears} yrs` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {kind === "pms" && (
                <table className="pp-table">
                  <thead>
                    <tr>
                      <th style={{ width: "30%" }}>Strategy</th>
                      <th>Manager</th>
                      <th style={{ textAlign: "right" }}>Minimum</th>
                      <th style={{ textAlign: "right" }}>Proposed</th>
                      <th style={{ textAlign: "right" }}>Exp. Return</th>
                      <th style={{ textAlign: "right" }}>Horizon</th>
                      <th style={{ textAlign: "right" }}>Projected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped[kind].map((it: any, i: number) => {
                      const projectedPMS = Number(it.proposedAmount ?? 0) * Math.pow(1 + Number(it.expectedReturn ?? 0) / 100, Number(it.termYears ?? 0));
                      return (
                        <tr key={i}>
                          <td style={{ fontWeight: 700 }}>{it.strategyName}</td>
                          <td>{it.manager ?? "—"}</td>
                          <td style={{ textAlign: "right" }}>{it.minInvestment ? formatINR(Number(it.minInvestment)) : "—"}</td>
                          <td style={{ textAlign: "right" }}>{it.proposedAmount ? formatINR(Number(it.proposedAmount)) : "—"}</td>
                          <td style={{ textAlign: "right" }}>{it.expectedReturn ? `${it.expectedReturn}%` : "—"}</td>
                          <td style={{ textAlign: "right" }}>{it.termYears ? `${it.termYears} yrs` : "—"}</td>
                          <td style={{ textAlign: "right", color: "#059669", fontWeight: 700 }}>
                            {projectedPMS ? formatINR(Math.round(projectedPMS)) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {kind === "aif" && (
                <table className="pp-table">
                  <thead>
                    <tr>
                      <th style={{ width: "30%" }}>Fund</th>
                      <th>Manager / Cat</th>
                      <th style={{ textAlign: "right" }}>Minimum</th>
                      <th style={{ textAlign: "right" }}>Proposed</th>
                      <th style={{ textAlign: "right" }}>Lock-in</th>
                      <th style={{ textAlign: "right" }}>Target IRR</th>
                      <th style={{ textAlign: "right" }}>Projected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped[kind].map((it: any, i: number) => {
                      const projectedAIF = Number(it.proposedAmount ?? 0) * Math.pow(1 + Number(it.targetIrr ?? 0) / 100, Number(it.lockInYears ?? 0));
                      return (
                        <tr key={i}>
                          <td style={{ fontWeight: 700 }}>{it.fundName}</td>
                          <td>
                            {it.manager ?? "—"}
                            {it.category && (
                              <div className="pp-muted" style={{ fontSize: 11 }}>
                                {String(it.category).toUpperCase()}
                              </div>
                            )}
                          </td>
                          <td style={{ textAlign: "right" }}>{it.minInvestment ? formatINR(Number(it.minInvestment)) : "—"}</td>
                          <td style={{ textAlign: "right" }}>{it.proposedAmount ? formatINR(Number(it.proposedAmount)) : "—"}</td>
                          <td style={{ textAlign: "right" }}>{it.lockInYears ? `${it.lockInYears} yrs` : "—"}</td>
                          <td style={{ textAlign: "right" }}>{it.targetIrr ? `${it.targetIrr}%` : "—"}</td>
                          <td style={{ textAlign: "right", color: "#059669", fontWeight: 700 }}>
                            {projectedAIF ? formatINR(Math.round(projectedAIF)) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            {/* Notes per product */}
            {grouped[kind].some((it: any) => it.notes) && (
              <div style={{ marginTop: 8 }}>
                {grouped[kind].map(
                  (it: any, i: number) =>
                    it.notes && (
                      <div
                        key={i}
                        style={{ fontSize: 11, color: "#475569", marginTop: 4, paddingLeft: 8, borderLeft: `2px solid ${accent}` }}
                      >
                        <strong>
                          {it.schemeName ?? it.policyName ?? it.strategyName ?? it.fundName}
                          :{" "}
                        </strong>
                        {it.notes}
                      </div>
                    )
                )}
              </div>
            )}
          </div>
        ))}

        {/* Other Investment Products — bank FD, bonds, NPS, etc. */}
        {grouped["other"] && grouped["other"].length > 0 && (
          <div className="pp-section" style={{ marginTop: 28 }}>
            <div className="pp-h2">{KIND_TITLE.other}</div>
            <div style={{ marginTop: 8 }}>
              <table className="pp-table">
                <thead>
                  <tr>
                    <th style={{ width: "28%" }}>Product</th>
                    <th>Company / Issuer</th>
                    <th style={{ textAlign: "right" }}>Amount</th>
                    <th style={{ textAlign: "right" }}>Assumed Return</th>
                    <th style={{ textAlign: "right" }}>Period</th>
                    <th style={{ textAlign: "right" }}>Expected Future Value</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped["other"].map((it: any, i: number) => {
                    const amt = Number(it.amount ?? 0);
                    const r = Number(it.expectedReturn ?? 0);
                    const y = Number(it.termYears ?? 0);
                    const fv = amt > 0 && r > 0 && y > 0 ? fvLumpAnnual(amt, r, y) : 0;
                    return (
                      <tr key={i}>
                        <td style={{ fontWeight: 700 }}>{it.productName}</td>
                        <td>{it.company ?? "—"}</td>
                        <td style={{ textAlign: "right" }}>{amt > 0 ? formatINR(amt) : "—"}</td>
                        <td style={{ textAlign: "right" }}>{r > 0 ? `${r}%` : "—"}</td>
                        <td style={{ textAlign: "right" }}>{y > 0 ? `${y} yrs` : "—"}</td>
                        <td style={{ textAlign: "right", color: "#059669", fontWeight: 700 }}>
                          {fv > 0 ? formatINR(Math.round(fv)) : "—"}
                        </td>
                        <td className="pp-muted">{it.remarks ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Disclaimer */}
        {p.disclaimer && (
          <div className="pp-section" style={{ marginTop: 32 }}>
            <div className="pp-h2" style={{ fontSize: 12 }}>Disclaimer</div>
            <p style={{ fontSize: 10, color: "#64748b", lineHeight: 1.55, marginTop: 6 }}>
              {p.disclaimer}
            </p>
          </div>
        )}

        {/* Signature footer */}
        <div
          className="pp-section"
          style={{
            marginTop: 40,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 32,
            alignItems: "end",
          }}
        >
          <div>
            <div
              style={{ borderBottom: "1px solid #94a3b8", paddingBottom: 4, marginBottom: 6, height: 32 }}
            />
            <div style={{ fontSize: 11, fontWeight: 700 }}>{preparedBy?.name ?? "—"}</div>
            <div className="pp-muted" style={{ fontSize: 10 }}>
              {(preparedBy as any)?.euin ? `EUIN ${(preparedBy as any).euin}` : ""}
            </div>
            <div className="pp-muted" style={{ fontSize: 10 }}>
              {tenant?.legalName ?? tenant?.displayName ?? ""}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="pp-muted" style={{ fontSize: 10 }}>Client signature</div>
            <div
              style={{ borderBottom: "1px solid #94a3b8", paddingBottom: 4, marginTop: 24, height: 32 }}
            />
          </div>
        </div>

        {/* Footer — firm credentials + contact (AMFI / BIF / ARN) */}
        {(() => {
          const bareArn = (tenant?.arn ?? "").replace(/^ARN-?/i, "");
          const contacts = [
            (tenant as any)?.email,
            (tenant as any)?.phone,
            (tenant as any)?.website,
          ].filter(Boolean);
          return (
            <div
              style={{
                marginTop: 32,
                paddingTop: 12,
                borderTop: "1px solid #e2e8f0",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "#0f172a" }}>
                {tenant?.legalName ?? tenant?.displayName ?? ""}
              </div>
              <div className="pp-muted" style={{ fontSize: 9.5, marginTop: 2 }}>
                AMFI-Registered Mutual Fund Distributor · BIF Distributor
                {bareArn && ` | ARN-${bareArn}`}
                {(tenant as any)?.principalEuin && ` · EUIN ${(tenant as any).principalEuin}`}
              </div>
              {contacts.length > 0 && (
                <div className="pp-muted" style={{ fontSize: 9.5, marginTop: 2 }}>
                  {contacts.join("  ·  ")}
                </div>
              )}
              <div className="pp-muted" style={{ fontSize: 9, marginTop: 6 }}>
                {(tenant as any)?.address ? `${(tenant as any).address} · ` : ""}Proposal {p.proposalNumber}
              </div>
            </div>
          );
        })()}
      </div>
    </>
  );
}
