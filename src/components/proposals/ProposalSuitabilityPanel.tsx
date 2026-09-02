"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, FileText, AlertCircle, Save, Loader2 } from "lucide-react";
import { RiskAlignmentBanner } from "./RiskAlignmentBanner";
import { useToast } from "@/components/ui/Toast";
import { type ClientProfile, type SchemeLine } from "@/lib/proposal/risk-alignment";

export function ProposalSuitabilityPanel({
  proposalId,
  initialSuitabilityNote,
  initialOverrideReason,
  clientRiskProfile,
  schemes,
}: {
  proposalId: string;
  initialSuitabilityNote: string | null;
  initialOverrideReason: string | null;
  clientRiskProfile: ClientProfile;
  schemes: SchemeLine[];
}) {
  const router = useRouter();
  const [suitabilityNote, setSuitabilityNote] = useState(initialSuitabilityNote ?? "");
  const [overrideReason, setOverrideReason] = useState(initialOverrideReason ?? "");
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    setBusy(true);
    try {
      const res = await fetch(`/api/proposals/${proposalId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          suitabilityNote: suitabilityNote.trim() || null,
          suitabilityOverrideReason: overrideReason.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? `Save failed (${res.status})`, "Couldn't save");
        return;
      }
      toast.success("Compliance details saved — you can now send the proposal.");
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "An error occurred.", "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-surface p-5 space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-5 text-brand-cyan" />
        <h2 className="section-title">Suitability & Compliance</h2>
      </div>

      {schemes.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
            Risk Profile Suitability Check
          </div>
          <RiskAlignmentBanner
            profile={clientRiskProfile}
            schemes={schemes}
          />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
        <label className="block space-y-1">
          <div className="text-xs font-semibold flex items-center gap-1">
            <FileText className="size-3.5 text-muted-foreground" />
            Suitability Note (Required to Send)
          </div>
          <textarea
            rows={3}
            value={suitabilityNote}
            onChange={(e) => setSuitabilityNote(e.target.value)}
            placeholder="Describe why this portfolio structure aligns with the client's goals and risk profile..."
            className="input-base text-xs font-sans leading-relaxed"
          />
          <div className="text-[10px] text-muted-foreground leading-normal">
            Must detail the recommendations' alignment with client goals (e.g. tax planning, wealth creation).
          </div>
        </label>

        <label className="block space-y-1">
          <div className="text-xs font-semibold flex items-center gap-1 text-amber-700">
            <AlertCircle className="size-3.5" />
            Owner Override Reason (Optional)
          </div>
          <textarea
            rows={3}
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            placeholder="Owner justification for bypassing suitability check warning..."
            className="input-base text-xs font-sans leading-relaxed border-amber-200 focus:border-amber-400 focus:ring-amber-200"
          />
          <div className="text-[10px] text-amber-600 leading-normal">
            Required only if suitability note is missing and you have owner rights to override compliance warning.
          </div>
        </label>
      </div>

      <div className="flex justify-end pt-2">
        <button
          onClick={handleSave}
          disabled={busy}
          className="btn-primary text-xs"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save Compliance Details
        </button>
      </div>
    </div>
  );
}
