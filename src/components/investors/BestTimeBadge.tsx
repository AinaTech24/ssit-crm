/**
 * BestTimeBadge — surfaces the client's inferred best contact window (Zoho Zia
 * "Best Time to Contact" parity) as a compact chip on Client 360. Renders
 * nothing until there are enough successful-contact data points.
 */

import { Clock } from "lucide-react";
import { withTenant } from "@/db/client";
import { bestContactWindow } from "@/lib/contact-timing";

export async function BestTimeBadge({ session, investorId }: { session: { tenantId: string; userId: string; branchId?: string | null; roles: string[] }; investorId: string }) {
  const bt = await withTenant(
    session.tenantId,
    (tx) => bestContactWindow(tx as any, { tenantId: session.tenantId, investorId }),
    { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles }
  );
  if (!bt) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-sky-50 text-sky-700" title={`Inferred from ${bt.basis} successful contacts`}>
      <Clock className="size-3" /> Best time: {bt.label}
    </span>
  );
}
