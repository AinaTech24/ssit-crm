import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, ShieldCheck, UserRoundCheck } from "lucide-react";

type Member = {
  id: string;
  name: string;
  nomineeName?: string | null;
  nomineeRelation?: string | null;
  dob?: string | Date | null;
  isMinor?: boolean | null;
  aum?: string | number | null;
};

export function SuccessionReadiness({ members, primaryInvestorId }: { members: Member[]; primaryInvestorId?: string | null }) {
  const missingNominee = members.filter((member) => !member.nomineeName);
  const minors = members.filter((member) => member.isMinor);
  const nextGen = members.filter((member) => {
    if (!member.dob) return false;
    const age = (Date.now() - new Date(member.dob).getTime()) / (365.25 * 86_400_000);
    return age >= 18 && age <= 30 && Number(member.aum ?? 0) === 0;
  });
  const checks = [members.length > 0, !!primaryInvestorId, missingNominee.length === 0, minors.length === 0 || members.some((member) => !member.isMinor), nextGen.length === 0];
  const score = Math.round((checks.filter(Boolean).length / checks.length) * 100);

  return (
    <section className="rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-4 text-primary" /> Succession readiness</h2><p className="mt-1 text-sm text-muted-foreground">Nomination, guardianship and next-generation relationship gaps across the household.</p></div><div className="text-right"><div className="text-2xl font-bold">{score}%</div><div className="text-xs text-muted-foreground">household ready</div></div></div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-primary" style={{ width: `${score}%` }} /></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3"><Gap label="Nominee gaps" count={missingNominee.length} detail={missingNominee.map((member) => member.name).join(", ")} /><Gap label="Minor members" count={minors.length} detail={minors.map((member) => member.name).join(", ")} /><Gap label="Next-gen prospects" count={nextGen.length} detail={nextGen.map((member) => member.name).join(", ")} /></div>
      {missingNominee.length > 0 && <div className="mt-4 border-t pt-3"><div className="text-xs font-semibold uppercase text-muted-foreground">Resolve first</div><div className="mt-2 flex flex-wrap gap-2">{missingNominee.map((member) => <Link key={member.id} href={`/dashboard/investors/${member.id}`} className="btn-secondary text-xs">Add nominee for {member.name}<ArrowRight className="size-3" /></Link>)}</div></div>}
    </section>
  );
}

function Gap({ label, count, detail }: { label: string; count: number; detail: string }) {
  const clear = count === 0;
  return <div className="rounded-lg border p-3"><div className="flex items-center gap-2">{clear ? <CheckCircle2 className="size-4 text-primary" /> : <AlertTriangle className="size-4 text-destructive" />}<span className="text-sm font-medium">{label}</span></div><div className="mt-2 text-lg font-bold">{count}</div><p className="truncate text-xs text-muted-foreground" title={detail}>{clear ? "No action required" : detail}</p></div>;
}

