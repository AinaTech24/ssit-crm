import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/error-handler";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { investors, families } from "@/db/schema";
import { eq, isNull } from "drizzle-orm";

export const dynamic = "force-dynamic";

type InvestorRow = {
  id: string;
  name: string;
  pan: string;
  phone: string | null;
  email: string | null;
  address: any | null;
  bankAccountNumberMasked: string | null;
  familyId: string | null;
  aum: number;
  activeSipAmount: number;
};

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["family.view", "investor.view.all", "investor.view.assigned"], session.permissions);

    const suggestions = await withTenant(session.tenantId, async (tx) => {
      // 1. Fetch all investors for the tenant
      const allInvestorsRaw = await tx
        .select({
          id: investors.id,
          name: investors.name,
          pan: investors.pan,
          phone: investors.phone,
          email: investors.email,
          address: investors.address,
          bankAccountNumberMasked: investors.bankAccountNumberMasked,
          familyId: investors.familyId,
          aum: investors.aum,
          activeSipAmount: investors.activeSipAmount,
        })
        .from(investors)
        .where(isNull(investors.deletedAt));

      const allFamilies = await tx.select().from(families);

      const familyMap = new Map(allFamilies.map((f) => [f.id, f]));

      const allInvestors: InvestorRow[] = allInvestorsRaw.map((i) => ({
        id: i.id,
        name: i.name,
        pan: i.pan,
        phone: i.phone,
        email: i.email,
        address: i.address,
        bankAccountNumberMasked: i.bankAccountNumberMasked,
        familyId: i.familyId,
        aum: Number(i.aum ?? 0),
        activeSipAmount: Number(i.activeSipAmount ?? 0),
      }));

      // Helper match utilities
      const cleanPhone = (p: string | null) => p?.replace(/[^\d]/g, "") || "";
      const cleanEmail = (e: string | null) => e?.trim().toLowerCase() || "";
      const cleanBank = (b: string | null) => b?.trim() || "";
      const cleanAddr = (a: any) => {
        if (!a || typeof a !== "object") return "";
        const l1 = a.line1?.trim().toLowerCase() || "";
        const city = a.city?.trim().toLowerCase() || "";
        if (!l1 || !city) return "";
        return `${l1}|${city}`;
      };

      const unlinked = allInvestors.filter((i) => !i.familyId);
      const linked = allInvestors.filter((i) => i.familyId);

      const results: any[] = [];
      const processedUnlinkedIds = new Set<string>();

      for (const inv of unlinked) {
        if (processedUnlinkedIds.has(inv.id)) continue;

        const invPhone = cleanPhone(inv.phone);
        const invEmail = cleanEmail(inv.email);
        const invBank = cleanBank(inv.bankAccountNumberMasked);
        const invAddr = cleanAddr(inv.address);

        // A. Look for matches in already LINKED families
        let matchedLinkedMember: InvestorRow | null = null;
        let matchReason = "";
        let confidence: "high" | "medium" = "medium";

        for (const l of linked) {
          if (invPhone && cleanPhone(l.phone) === invPhone) {
            matchedLinkedMember = l;
            matchReason = `Shares phone number (${inv.phone}) with family member ${l.name}`;
            confidence = "high";
            break;
          }
          if (invEmail && cleanEmail(l.email) === invEmail) {
            matchedLinkedMember = l;
            matchReason = `Shares email (${inv.email}) with family member ${l.name}`;
            confidence = "high";
            break;
          }
          if (invBank && cleanBank(l.bankAccountNumberMasked) === invBank) {
            matchedLinkedMember = l;
            matchReason = `Shares bank account with family member ${l.name}`;
            confidence = "high";
            break;
          }
          if (invAddr && cleanAddr(l.address) === invAddr) {
            matchedLinkedMember = l;
            matchReason = `Shares address with family member ${l.name}`;
            confidence = "medium";
            break;
          }
        }

        if (matchedLinkedMember && matchedLinkedMember.familyId) {
          const targetFam = familyMap.get(matchedLinkedMember.familyId);
          if (targetFam) {
            results.push({
              type: "add_to_family",
              investor: {
                id: inv.id,
                name: inv.name,
                pan: inv.pan,
                aum: inv.aum,
                activeSipAmount: inv.activeSipAmount,
              },
              targetFamily: {
                id: targetFam.id,
                name: targetFam.familyName ?? targetFam.headName,
              },
              reason: matchReason,
              confidence,
            });
            processedUnlinkedIds.add(inv.id);
            continue;
          }
        }

        // B. Look for matches in other UNLINKED investors to suggest a new family
        const potentialPartners: any[] = [];
        let partnerReason = "";
        let partnerConf: "high" | "medium" = "medium";

        for (const other of unlinked) {
          if (other.id === inv.id || processedUnlinkedIds.has(other.id)) continue;

          let isMatch = false;
          if (invPhone && cleanPhone(other.phone) === invPhone) {
            isMatch = true;
            partnerReason = `Shared phone number (${inv.phone})`;
            partnerConf = "high";
          } else if (invEmail && cleanEmail(other.email) === invEmail) {
            isMatch = true;
            partnerReason = `Shared email (${inv.email})`;
            partnerConf = "high";
          } else if (invBank && cleanBank(other.bankAccountNumberMasked) === invBank) {
            isMatch = true;
            partnerReason = `Shared bank account`;
            partnerConf = "high";
          } else if (invAddr && cleanAddr(other.address) === invAddr) {
            isMatch = true;
            partnerReason = `Shared home address`;
            partnerConf = "medium";
          }

          if (isMatch) {
            potentialPartners.push({
              id: other.id,
              name: other.name,
              pan: other.pan,
              aum: other.aum,
              activeSipAmount: other.activeSipAmount,
            });
            processedUnlinkedIds.add(other.id);
          }
        }

        if (potentialPartners.length > 0) {
          results.push({
            type: "create_family",
            investor: {
              id: inv.id,
              name: inv.name,
              pan: inv.pan,
              aum: inv.aum,
              activeSipAmount: inv.activeSipAmount,
            },
            potentialPartners,
            reason: partnerReason,
            confidence: partnerConf,
          });
          processedUnlinkedIds.add(inv.id);
        }
      }

      return results;
    });

    return NextResponse.json({ suggestions });
  } catch (err: any) {
    return handleApiError(err);
  }
}
