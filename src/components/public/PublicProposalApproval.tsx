"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, FileSignature, ExternalLink } from "lucide-react";

export function PublicProposalApproval({
  tokenId,
  proposal,
  acceptanceText,
}: {
  tokenId: string;
  proposal: {
    id: string;
    number: string;
    title: string;
    recipientName: string;
    totalInvestment: number | null;
    expectedCorpus: number | null;
    riskRating: string;
    type: string;
    validUntil: string | null;
    url: string;
  };
  acceptanceText: string;
}) {
  const [signature, setSignature] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!signature.trim()) {
      setError("Please type your name to confirm acceptance.");
      return;
    }
    if (!agreed) {
      setError("Please tick the agreement box.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/public/proposals/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenId, signatureName: signature.trim(), acceptanceText }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setDone(true);
    } catch (e: any) {
      setError(e?.message ?? "Approval failed");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="bg-white rounded-xl shadow p-8 text-center">
        <CheckCircle2 className="size-12 text-emerald-500 mx-auto" />
        <h2 className="text-xl font-bold mt-3">Approved!</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Thank you, {proposal.recipientName.split(" ")[0] || "investor"}. Your relationship manager will reach out shortly with the next
          steps — typically a document-collection form for KYC.
        </p>
        <a
          href={proposal.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 mt-4 text-xs text-brand-cyan hover:underline"
        >
          Download a signed copy <ExternalLink className="size-3" />
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold">{proposal.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              For <span className="font-medium text-foreground">{proposal.recipientName}</span>
              {proposal.number ? <> · <span className="font-mono">{proposal.number}</span></> : null}
            </p>
          </div>
          {proposal.validUntil && (
            <div className="text-right text-xs">
              <div className="text-muted-foreground">Valid until</div>
              <div className="font-semibold tabular-nums">{proposal.validUntil}</div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <Stat label="Investment type" value={proposal.type.replace(/_/g, " ")} />
          {proposal.totalInvestment != null && <Stat label="Total investment" value={`₹${proposal.totalInvestment.toLocaleString("en-IN")}`} />}
          {proposal.expectedCorpus != null && <Stat label="Expected corpus" value={`₹${proposal.expectedCorpus.toLocaleString("en-IN")}`} />}
          {proposal.riskRating && <Stat label="Risk rating" value={proposal.riskRating} />}
        </div>

        <a
          href={proposal.url}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-center gap-1 text-sm text-brand-cyan hover:underline"
        >
          Read the full proposal <ExternalLink className="size-3.5" />
        </a>
      </div>

      <div className="bg-white rounded-xl shadow p-6 space-y-4">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <FileSignature className="size-4 text-brand-cyan" /> Accept this proposal
        </h2>

        <div className="rounded-lg border bg-slate-50 p-3 text-sm text-slate-700 leading-relaxed">
          {acceptanceText}
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1" />
          <span>I have read the proposal above and I agree to the terms quoted in this acceptance.</span>
        </label>

        <label className="block">
          <div className="text-xs font-semibold mb-1">Signature — type your full name *</div>
          <input
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder="e.g. Rajesh Sharma"
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
          <div className="text-[10px] text-muted-foreground mt-1">
            Your typed name + the time, IP, and browser will be recorded as your electronic signature — SEBI
            requires us to keep this record for audit.
          </div>
        </label>

        {error && <div className="text-xs text-rose-700 bg-rose-50 rounded-md p-2">{error}</div>}

        <button
          onClick={submit}
          disabled={busy || !signature.trim() || !agreed}
          className="w-full rounded-md bg-brand-cyan text-white px-4 py-2.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          {busy ? "Submitting…" : "Approve proposal"}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-lg p-3 bg-slate-50">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold mt-1 capitalize tabular-nums">{value}</div>
    </div>
  );
}
