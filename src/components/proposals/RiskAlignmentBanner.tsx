"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldX, ChevronDown, ChevronUp } from "lucide-react";
import { checkAlignment, type ClientProfile, type SchemeLine } from "@/lib/proposal/risk-alignment";

export function RiskAlignmentBanner({
  profile,
  schemes,
  onOverrideChange,
}: {
  profile: ClientProfile;
  schemes: SchemeLine[];
  /** Parent sets to disable the Send button until the RM overrides. */
  onOverrideChange?: (overridden: boolean, reason: string) => void;
}) {
  const result = checkAlignment(profile, schemes);
  const [open, setOpen] = useState(result.overall !== "ok");
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");

  if (result.overall === "ok") {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50/40 p-3 text-emerald-800 text-xs flex items-center gap-2">
        <CheckCircle2 className="size-4" /> {result.summary}
      </div>
    );
  }

  const tone =
    result.overall === "block"
      ? { border: "border-rose-300", bg: "bg-rose-50/40", text: "text-rose-800", icon: ShieldX }
      : { border: "border-amber-300", bg: "bg-amber-50/40", text: "text-amber-800", icon: AlertTriangle };

  return (
    <div className={`rounded-lg border ${tone.border} ${tone.bg} ${tone.text} p-3 space-y-2`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <tone.icon className="size-4" /> {result.summary}
        </div>
        <button onClick={() => setOpen((v) => !v)} className="text-xs hover:underline flex items-center gap-1">
          {open ? "Hide details" : "Show details"}
          {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        </button>
      </div>

      {open && (
        <ul className="space-y-1 text-xs">
          {result.findings.map((f, i) => (
            <li key={i} className="flex items-start gap-2 border-t pt-1.5 first:border-t-0 first:pt-0">
              <span
                className={`mt-0.5 size-2 rounded-full flex-shrink-0 ${
                  f.severity === "ok" ? "bg-emerald-500" : f.severity === "warn" ? "bg-amber-500" : "bg-rose-500"
                }`}
              />
              <div className="flex-1">
                <span className="font-medium">{f.schemeName}</span>
                {f.schemeRisk && <span className="text-[10px] opacity-70 ml-1.5">({f.schemeRisk}-risk)</span>}
                <div className="text-[11px] opacity-80">{f.message}</div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* `overall` is narrowed to "warn" | "block" by the early-return above */}
      {onOverrideChange && (
        <div className="pt-2 border-t">
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={override}
              onChange={(e) => {
                setOverride(e.target.checked);
                onOverrideChange(e.target.checked, reason);
              }}
              className="mt-0.5"
            />
            <span>
              I have discussed this risk mismatch with the client and they wish to proceed anyway. Provide a brief
              reason — this will be recorded for audit.
            </span>
          </label>
          {override && (
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                onOverrideChange(true, e.target.value);
              }}
              placeholder="e.g. Client signed an Investor Suitability Confirmation form acknowledging the higher risk."
              className="mt-2 w-full text-xs border rounded-md px-2 py-1.5"
            />
          )}
        </div>
      )}
    </div>
  );
}
