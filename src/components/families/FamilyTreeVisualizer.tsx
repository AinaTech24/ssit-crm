"use client";

import Link from "next/link";
import { ShieldAlert, Award, TrendingUp } from "lucide-react";
import { formatINR } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";

type Member = {
  id: string;
  name: string;
  pan: string;
  avatarUrl?: string | null;
  familyRole: string | null;
  aum: string | number;
  activeSipAmount: string | number;
  kycStatus: string;
  nomineeName: string | null;
  ckycExpiryAt: string | null;
};

const ROLE_LABELS: Record<string, string> = {
  self: "Self / Head",
  spouse: "Spouse",
  father: "Father",
  mother: "Mother",
  son: "Son",
  daughter: "Daughter",
  sibling: "Sibling",
  huf_karta: "HUF Karta",
  huf_coparcener: "HUF Co-parcener",
  huf: "HUF Member",
  other: "Other",
};

export function FamilyTreeVisualizer({
  members,
  primaryInvestorId,
}: {
  members: Member[];
  primaryInvestorId: string | null;
}) {
  if (!members || members.length === 0) return null;

  // Classify members into generational tiers
  const ancestors: Member[] = [];
  const core: Member[] = [];
  const dependents: Member[] = [];

  members.forEach((m) => {
    const role = m.familyRole ? m.familyRole.toLowerCase() : "";
    if (role === "father" || role === "mother" || role === "huf_karta" || role === "huf") {
      ancestors.push(m);
    } else if (role === "son" || role === "daughter" || role === "huf_coparcener" || role === "sibling") {
      dependents.push(m);
    } else {
      core.push(m);
    }
  });

  // Ensure there is at least one primary head in the core group
  if (core.length === 0 && members.length > 0) {
    // Fallback: place the primary investor or the first member in core
    const primaryIndex = members.findIndex((m) => m.id === primaryInvestorId);
    const head = primaryIndex !== -1 ? members[primaryIndex] : members[0];
    core.push(head);
    
    // Remove head from other lists
    const indexInAncestors = ancestors.findIndex((m) => m.id === head.id);
    if (indexInAncestors !== -1) ancestors.splice(indexInAncestors, 1);
    
    const indexInDependents = dependents.findIndex((m) => m.id === head.id);
    if (indexInDependents !== -1) dependents.splice(indexInDependents, 1);
  }

  // Sort core to place the primary head first
  core.sort((a, b) => {
    const aIsPrimary = a.id === primaryInvestorId;
    const bIsPrimary = b.id === primaryInvestorId;
    return aIsPrimary ? -1 : bIsPrimary ? 1 : 0;
  });

  return (
    <div className="border rounded-lg bg-card p-6 overflow-hidden">
      <h2 className="font-semibold text-sm mb-6 flex items-center gap-2">
        <Award className="size-4 text-brand-cyan-deep" />
        Family Wealth Map
      </h2>

      <div className="flex flex-col items-center justify-center relative min-h-[300px]">
        {/* Tier 1: Ancestors / HUF */}
        {ancestors.length > 0 && (
          <div className="flex flex-col items-center w-full">
            <div className="flex flex-wrap gap-6 justify-center items-center">
              {ancestors.map((m) => (
                <MemberNode
                  key={m.id}
                  member={m}
                  isPrimary={m.id === primaryInvestorId}
                />
              ))}
            </div>
            <div className="w-px h-6 bg-border my-2" />
          </div>
        )}

        {/* Tier 2: Core (Self & Spouse) */}
        <div className="flex flex-col items-center w-full">
          <div className="flex flex-wrap gap-8 justify-center items-center relative">
            {core.map((m, index) => (
              <div key={m.id} className="flex items-center">
                {index > 0 && (
                  <div className="hidden md:block w-8 h-px bg-border -ml-8 mr-0" />
                )}
                <MemberNode
                  member={m}
                  isPrimary={m.id === primaryInvestorId}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Tier 3: Dependents (Children / Next-gen) */}
        {dependents.length > 0 && (
          <div className="flex flex-col items-center w-full">
            <div className="w-px h-6 bg-border my-2" />
            <div className="flex flex-wrap gap-6 justify-center items-center">
              {dependents.map((m) => (
                <MemberNode
                  key={m.id}
                  member={m}
                  isPrimary={m.id === primaryInvestorId}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MemberNode({
  member,
  isPrimary,
}: {
  member: Member;
  isPrimary: boolean;
}) {
  const roleLabel = member.familyRole ? ROLE_LABELS[member.familyRole] ?? member.familyRole : "Member";
  const aumValue = Number(member.aum ?? 0);
  const sipValue = Number(member.activeSipAmount ?? 0);

  // Compliance calculations
  const hasKycGaps = member.kycStatus !== "verified" || (member.ckycExpiryAt && new Date(member.ckycExpiryAt).getTime() <= Date.now() + 30 * 24 * 60 * 60 * 1000);
  const hasNomineeGaps = !member.nomineeName;

  return (
    <div className={`relative bg-card/75 backdrop-blur border rounded-xl p-4 shadow-sm w-56 transition-all hover:shadow-md hover:border-brand-cyan/40 ${
      isPrimary ? "border-brand-cyan/60 bg-gradient-to-br from-brand-cyan-light/10 to-transparent" : "border-border/60"
    }`}>
      {isPrimary && (
        <span className="absolute -top-2 left-4 px-2 py-0.5 rounded-full text-[9px] uppercase tracking-wider font-extrabold bg-brand-cyan text-white shadow-sm">
          Head
        </span>
      )}

      <div className="flex items-start gap-2.5">
        <Avatar
          src={member.avatarUrl ? `/api/investors/${member.id}/avatar` : null}
          name={member.name}
          size={32}
          className="flex-shrink-0"
        />
        <div className="min-w-0 flex-1">
          <Link
            href={`/dashboard/investors/${member.id}`}
            className="font-bold text-xs hover:text-brand-cyan-deep hover:underline truncate block"
          >
            {member.name}
          </Link>
          <span className="text-[10px] text-muted-foreground capitalize block mt-0.5 font-medium">
            {roleLabel}
          </span>
        </div>
      </div>

      <div className="border-t border-border/40 mt-3 pt-2.5 grid grid-cols-2 gap-1 text-[11px] font-medium text-muted-foreground">
        <div>
          <span className="text-[9px] text-muted-foreground/70 block uppercase font-semibold">AUM</span>
          <span className="text-foreground font-semibold tabular-nums">{formatINR(aumValue)}</span>
        </div>
        {sipValue > 0 && (
          <div>
            <span className="text-[9px] text-muted-foreground/70 block uppercase font-semibold flex items-center gap-0.5">
              <TrendingUp className="size-2.5 text-emerald-500" /> SIP
            </span>
            <span className="text-foreground font-semibold tabular-nums">{formatINR(sipValue)}/mo</span>
          </div>
        )}
      </div>

      {(hasKycGaps || hasNomineeGaps) && (
        <div className="border-t border-border/40 mt-2.5 pt-2 flex flex-wrap gap-1">
          {hasKycGaps && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold bg-rose-50 text-rose-700 border border-rose-100 rounded px-1.5 py-0.5">
              <ShieldAlert className="size-2.5" /> KYC Gap
            </span>
          )}
          {hasNomineeGaps && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold bg-rose-50 text-rose-700 border border-rose-100 rounded px-1.5 py-0.5">
              <ShieldAlert className="size-2.5" /> Nominee Gap
            </span>
          )}
        </div>
      )}
    </div>
  );
}
