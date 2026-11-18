/**
 * The one place a proposal PDF is produced for a client (download and "send"):
 * the Investment Analysis & Performance Report layout, with the previous plain
 * layout as a safety net - a bug in the report must never stop a proposal going out.
 */

import { renderProposalPdf, type ProposalData } from "@/lib/proposal/proposal-pdf";
import { renderProposalReportPdf, type ReportBrand } from "@/lib/proposal/report-pdf";

/** The firm's branding + contact details, read from the tenant row. */
export function brandFromTenant(t: any): ReportBrand {
  return {
    displayName: t?.displayName,
    legalName: t?.legalName,
    arn: t?.arn,
    euin: t?.euin,
    primaryColor: t?.primaryColor,
    secondaryColor: t?.secondaryColor,
    logoUrl: t?.logoUrl,
    phone: t?.phone,
    email: t?.email,
    website: t?.website,
    address: t?.address,
  };
}

export async function renderClientProposalPdf(args: { proposal: ProposalData; brand: ReportBrand; generatedAt?: string }): Promise<Buffer> {
  try {
    return await renderProposalReportPdf(args);
  } catch (e) {
    console.warn("[proposal] report layout failed, using the standard layout:", (e as Error)?.message);
    return renderProposalPdf(args);
  }
}
