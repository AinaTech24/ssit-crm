import { eq } from "drizzle-orm";
import { tenants } from "@/db/schema";
import { runComplianceChecks, type ComplianceResult } from "@/lib/comms/compliance";
import type { Tx } from "@/db/client";

/**
 * Run the deterministic compliance engine over a social-media post caption.
 *
 * Uses channel 'inapp' so the text rules fire (guaranteed-returns, AMFI
 * disclaimer, "adviser" misuse, scheme-specific) without the WhatsApp-session /
 * SMS-DLT channel checks that don't apply to a social post. Advisory: the
 * result is stored and surfaced, not used to hard-block (the human
 * compliance_checked + maker-checker approval are the binding gates).
 */
export async function scanCaption(tx: Tx, tenantId: string, caption: string | null | undefined): Promise<ComplianceResult | null> {
  if (!caption || !caption.trim()) return null;
  const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return runComplianceChecks({
    channel: "inapp",
    category: "marketing",
    tenant: {
      legalName: t?.legalName ?? "",
      arn: t?.arn ?? "",
      principalEuin: t?.principalEuin ?? undefined,
      riaRegistered: t?.riaRegistered ?? false,
    },
    text: caption,
  });
}
