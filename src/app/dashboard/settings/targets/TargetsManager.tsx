"use client";

/**
 * TargetsManager — per-member targets + this-month achievement bars.
 *
 * Business target is entered as an ANNUAL ₹ figure (matches users.annual_target
 * + the dashboard quota ring); the monthly target shown against achievement is
 * annual/12. Meeting targets are monthly counts. Managers can edit every row;
 * everyone else sees only their own (server already scopes the list).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, IndianRupee, CalendarPlus, CalendarCheck, Save } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

export type MemberTarget = {
  id: string;
  name: string;
  annualTarget: number | null;
  sipMonthlyTarget: number | null;
  newMeetingsMonthlyTarget: number | null;
  renewalMeetingsMonthlyTarget: number | null;
  achievedBusiness: number;
  achievedNewMeetings: number;
  achievedRenewalMeetings: number;
};

function inr(n: number): string {
  if (!Number.isFinite(n)) return "₹0";
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  if (Math.abs(n) >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
  return `₹${Math.round(n)}`;
}

function pct(achieved: number, target: number): number {
  if (!target || target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((achieved / target) * 100)));
}

function Bar({
  icon: Icon,
  label,
  achievedText,
  targetText,
  percent,
  hasTarget,
}: {
  icon: any;
  label: string;
  achievedText: string;
  targetText: string;
  percent: number;
  hasTarget: boolean;
}) {
  const tone = percent >= 100 ? "bg-emerald-500" : percent >= 60 ? "bg-brand-cyan" : "bg-amber-500";
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="size-3.5 text-brand-cyan" /> {label}
        </span>
        <span className="tabular-nums font-medium">
          {achievedText}
          <span className="text-muted-foreground font-normal"> / {hasTarget ? targetText : "—"}</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-secondary overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${hasTarget ? tone : "bg-muted-foreground/20"}`}
          style={{ width: `${hasTarget ? percent : 0}%` }}
        />
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5 text-right tabular-nums">
        {hasTarget ? `${percent}% of target` : "no target set"}
      </div>
    </div>
  );
}

function MemberCard({
  m,
  canEdit,
  isSelf,
}: {
  m: MemberTarget;
  canEdit: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [annual, setAnnual] = useState(m.annualTarget != null ? String(m.annualTarget) : "");
  const [sip, setSip] = useState(m.sipMonthlyTarget != null ? String(m.sipMonthlyTarget) : "");
  const [newM, setNewM] = useState(m.newMeetingsMonthlyTarget != null ? String(m.newMeetingsMonthlyTarget) : "");
  const [renewM, setRenewM] = useState(
    m.renewalMeetingsMonthlyTarget != null ? String(m.renewalMeetingsMonthlyTarget) : ""
  );

  const monthlyBizTarget = m.annualTarget != null ? m.annualTarget / 12 : 0;

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/targets", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: m.id,
          annualTarget: annual.trim() === "" ? null : Number(annual),
          sipMonthlyTarget: sip.trim() === "" ? null : Number(sip),
          newMeetingsMonthlyTarget: newM.trim() === "" ? null : Math.round(Number(newM)),
          renewalMeetingsMonthlyTarget: renewM.trim() === "" ? null : Math.round(Number(renewM)),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? "Could not save targets", "Save failed");
        return;
      }
      toast.success(`Targets saved for ${m.name}`);
      router.refresh();
    } catch {
      toast.error("Network error — please try again", "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-surface p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold flex items-center gap-2">
          {m.name}
          {isSelf && <span className="chip text-[10px] bg-brand-cyan-light text-brand-cyan-deep">You</span>}
        </div>
      </div>

      {/* Target vs Achievement (month-to-date) */}
      <div className="grid sm:grid-cols-3 gap-3">
        <Bar
          icon={IndianRupee}
          label="Business"
          achievedText={inr(m.achievedBusiness)}
          targetText={inr(monthlyBizTarget)}
          percent={pct(m.achievedBusiness, monthlyBizTarget)}
          hasTarget={!!m.annualTarget}
        />
        <Bar
          icon={CalendarPlus}
          label="New meetings"
          achievedText={String(m.achievedNewMeetings)}
          targetText={String(m.newMeetingsMonthlyTarget ?? 0)}
          percent={pct(m.achievedNewMeetings, m.newMeetingsMonthlyTarget ?? 0)}
          hasTarget={!!m.newMeetingsMonthlyTarget}
        />
        <Bar
          icon={CalendarCheck}
          label="Renewal meetings"
          achievedText={String(m.achievedRenewalMeetings)}
          targetText={String(m.renewalMeetingsMonthlyTarget ?? 0)}
          percent={pct(m.achievedRenewalMeetings, m.renewalMeetingsMonthlyTarget ?? 0)}
          hasTarget={!!m.renewalMeetingsMonthlyTarget}
        />
      </div>

      {canEdit && (
        <div className="border-t pt-3 grid sm:grid-cols-4 gap-3">
          <Field label="Annual business (₹)" value={annual} onChange={setAnnual} placeholder="e.g. 12000000" />
          <Field label="Monthly SIP (₹)" value={sip} onChange={setSip} placeholder="e.g. 200000" />
          <Field label="New meetings / mo" value={newM} onChange={setNewM} placeholder="e.g. 10" />
          <Field label="Renewal meetings / mo" value={renewM} onChange={setRenewM} placeholder="e.g. 20" />
          <div className="sm:col-span-4 flex justify-end">
            <button onClick={save} disabled={busy} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save targets
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type="number"
        min={0}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full h-9 rounded-lg border border-border bg-card px-3 text-sm tabular-nums focus:outline-none focus:border-brand-cyan/60 focus:ring-2 focus:ring-brand-cyan/15"
      />
    </label>
  );
}

export function TargetsManager({
  members,
  canEditAll,
  selfId,
  monthLabel,
}: {
  members: MemberTarget[];
  canEditAll: boolean;
  selfId: string;
  monthLabel: string;
}) {
  if (members.length === 0) {
    return (
      <div className="card-surface p-12 text-center text-sm text-muted-foreground">
        No team members to show targets for.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {members.map((m) => (
        <MemberCard key={m.id} m={m} canEdit={canEditAll || m.id === selfId} isSelf={m.id === selfId} />
      ))}
    </div>
  );
}
