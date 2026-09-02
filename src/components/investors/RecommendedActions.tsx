/**
 * RecommendedActions — the Next-Best-Action card on Client 360. Shows this
 * client's open, ₹-scored recommendations (retention, SIP rescue, KYC, review,
 * cross-sell, RP refresh, birthday) so the RM knows exactly what to do for
 * THIS person, ranked. Server component — runs the NBA engine for one investor.
 */

import { Sparkles, ShieldCheck } from "lucide-react";
import { withTenant } from "@/db/client";
import { buildNextBestActions, NBA_META, type NbaAction } from "@/lib/nba/engine";
import { ContactQuickActions } from "@/components/common/ContactQuickActions";

const CHIP_TONE: Record<string, string> = {
  rose: "bg-rose-50 text-rose-700", amber: "bg-amber-50 text-amber-700", sky: "bg-sky-50 text-sky-700", violet: "bg-violet-50 text-violet-700", emerald: "bg-emerald-50 text-emerald-700",
};
const inr = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : n > 0 ? `₹${Math.round(n).toLocaleString("en-IN")}` : "");

export async function RecommendedActions({
  session, investorId, name, phone, email,
}: {
  session: { tenantId: string; userId: string; branchId?: string | null; roles: string[] };
  investorId: string; name: string; phone?: string | null; email?: string | null;
}) {
  const actions: NbaAction[] = await withTenant(
    session.tenantId,
    (tx) => buildNextBestActions(tx as any, { userId: session.userId, firmWide: true, forInvestorId: investorId }),
    { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles }
  );

  const firstName = name?.split(" ")[0] ?? "";

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="size-5 text-brand-cyan" />
        <h2 className="font-semibold">Recommended actions</h2>
        {actions.length > 0 && <span className="text-xs text-muted-foreground">{actions.length}</span>}
      </div>
      {actions.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-emerald-700"><ShieldCheck className="size-4" /> This client is in good shape — nothing pressing.</div>
      ) : (
        <ul className="space-y-2">
          {actions.map((a) => {
            const meta = NBA_META[a.type];
            return (
              <li key={a.key} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                <span className={`chip text-[10px] shrink-0 ${CHIP_TONE[meta.tone]}`}>{meta.label}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{a.title}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{a.reason}</div>
                </div>
                {a.impactInr > 0 && <div className="text-xs font-semibold tabular-nums text-emerald-700 shrink-0">{inr(a.impactInr)}</div>}
                <ContactQuickActions phone={phone ?? a.phone} email={email ?? a.email} message={a.type === "birthday_today" ? `Dear ${firstName}, wishing you a very Happy Birthday! 🎂` : `Hi ${firstName}, `} show={["whatsapp", "call"]} size={14} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
