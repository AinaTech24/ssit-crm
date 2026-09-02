"use client";

import { useState } from "react";
import { IndianRupee, Loader2, TrendingUp } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

const OUTCOMES = [
  ["aum_protected", "AUM protected"],
  ["aum_generated", "AUM generated"],
  ["sip_recovered", "SIP recovered"],
  ["sip_started", "New SIP started"],
  ["referral_won", "Referral won"],
  ["service_recovery", "Service recovery"],
] as const;

const SOURCES = [
  ["next_best_action", "Next best action"],
  ["workflow", "Workflow"],
  ["campaign", "Campaign"],
  ["meeting", "Meeting"],
  ["service", "Service request"],
  ["manual", "Manual follow-up"],
] as const;

export function RecordBusinessImpact({ investorId }: { investorId: string }) {
  const toast = useToast();
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number][0]>("aum_protected");
  const [sourceType, setSourceType] = useState<(typeof SOURCES)[number][0]>("next_best_action");
  const [amount, setAmount] = useState(0);
  const [monthlySipAmount, setMonthlySipAmount] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/business-impacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ investorId, outcome, sourceType, amount, monthlySipAmount, note }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not record the outcome");
      setAmount(0);
      setMonthlySipAmount(0);
      setNote("");
      toast.success("Business impact recorded", "It is now included in the impact-attribution report.");
    } catch (error) {
      toast.error("Could not record impact", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="relative">
      <summary className="btn-secondary cursor-pointer list-none text-xs"><TrendingUp className="size-3.5" /> Record outcome</summary>
      <form onSubmit={submit} className="absolute right-0 top-full z-40 mt-2 w-[22rem] space-y-3 rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg">
        <div><div className="text-sm font-semibold">Record measurable impact</div><p className="mt-0.5 text-xs text-muted-foreground">Connect the team&apos;s action to retained or generated business.</p></div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs font-medium">Outcome<select value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)} className="input-base mt-1 w-full text-xs">{OUTCOMES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs font-medium">Source<select value={sourceType} onChange={(event) => setSourceType(event.target.value as typeof sourceType)} className="input-base mt-1 w-full text-xs">{SOURCES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs font-medium">AUM value<input type="number" min={0} value={amount || ""} onChange={(event) => setAmount(Number(event.target.value))} className="input-base mt-1 w-full text-xs" placeholder="₹" /></label>
          <label className="text-xs font-medium">Monthly SIP<input type="number" min={0} value={monthlySipAmount || ""} onChange={(event) => setMonthlySipAmount(Number(event.target.value))} className="input-base mt-1 w-full text-xs" placeholder="₹ / month" /></label>
        </div>
        <label className="block text-xs font-medium">Evidence / note<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={2} className="input-base mt-1 w-full resize-y text-xs" /></label>
        <button type="submit" disabled={busy || (amount <= 0 && monthlySipAmount <= 0)} className="btn-primary w-full justify-center text-xs disabled:opacity-50">{busy ? <Loader2 className="size-3.5 animate-spin" /> : <IndianRupee className="size-3.5" />} Save impact</button>
      </form>
    </details>
  );
}

