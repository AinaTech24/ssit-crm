import { v4 as uuid } from "uuid";
import { and, eq } from "drizzle-orm";
import { complianceDocuments } from "@/db/schema";
import type { Nominee } from "./nominee";

/**
 * Register each nominee's uploaded PAN document as a CLIENT document
 * (`compliance_documents` linked to the investor) so it surfaces in the client's
 * Documents tab alongside their other files.
 *
 * Idempotent: skips any PAN file already registered for this investor (matched
 * by storage key), so repeated PATCHes never create duplicates. Must run inside
 * a `withTenant` transaction.
 */
export async function registerNomineePanDocs(
  tx: any,
  tenantId: string,
  investorId: string,
  nominees: Nominee[] | undefined,
  uploadedByUserId: string
): Promise<void> {
  const withDocs = (nominees ?? []).filter((n) => n.panDocKey);
  if (!withDocs.length) return;

  const existing = await tx
    .select({ key: complianceDocuments.storageKey })
    .from(complianceDocuments)
    .where(
      and(
        eq(complianceDocuments.tenantId, tenantId),
        eq(complianceDocuments.relatedEntityType, "investor"),
        eq(complianceDocuments.relatedEntityId, investorId)
      )
    );
  const have = new Set<string>(existing.map((r: any) => r.key).filter(Boolean));

  for (const n of withDocs) {
    const key = n.panDocKey!;
    if (have.has(key)) continue;
    await tx.insert(complianceDocuments).values({
      id: uuid(),
      tenantId,
      category: "other",
      name: `Nominee PAN — ${n.name?.trim() || "nominee"}`,
      description: n.pan ? `Nominee PAN: ${n.pan}` : "Nominee PAN document",
      storageKey: key,
      mimeType: n.panDocMime ?? null,
      sizeBytes: n.panDocSize != null ? String(n.panDocSize) : null,
      relatedEntityType: "investor",
      relatedEntityId: investorId,
      tags: ["client", "nominee"],
      uploadedByUserId,
    } as any);
    have.add(key);
  }
}
