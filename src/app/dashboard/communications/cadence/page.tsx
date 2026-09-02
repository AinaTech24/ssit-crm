/**
 * Client Communication Cadence — read-only SOP reference, adopted from
 * Network FP "5.5 Client Communication Checklist".
 *
 * The firm's standard touchpoint policy + response SLAs + compliance rule.
 * Print-friendly so it can be wall-mounted / attached to the DDQ pack.
 */

import Link from "next/link";
import { ChevronLeft, Zap, Clock, ShieldCheck } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { PrintReportButton } from "@/components/investors/PrintReportButton";
import {
  COMMUNICATION_MATRIX,
  RESPONSE_TIMELINES,
  KEY_FOCUS_AREAS,
  TAILORING_NOTE,
  COMPLIANCE_NOTE,
} from "@/lib/communications/cadence";

export const dynamic = "force-dynamic";

export default async function CommunicationCadencePage() {
  await requireSession();

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-start justify-between gap-3 print:hidden">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Link
              href="/dashboard/communications"
              className="hover:underline inline-flex items-center gap-1"
            >
              <ChevronLeft className="size-3" /> Communications
            </Link>
          </div>
          <h1 className="text-2xl font-semibold">Client communication cadence</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            The firm's standard touchpoint policy — what we communicate, how often, on
            which channel — plus response-time SLAs. Strengthen relationships through
            consistent, meaningful touchpoints. This is the SOP your workflows should honour.
          </p>
        </div>
        <PrintReportButton />
      </div>

      <div className="hidden print:block text-center mb-3">
        <h1 className="text-xl font-bold">Client Communication Cadence</h1>
        <p className="text-xs text-slate-500">
          Generated {new Date().toLocaleDateString("en-GB")}
        </p>
      </div>

      {/* Communication matrix */}
      <div className="border rounded-lg bg-card overflow-hidden">
        <div className="border-b px-4 py-2.5 font-semibold text-sm">Communication matrix</div>
        <div className="table-scroll">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Purpose</th>
                <th className="text-left py-2 font-medium">Frequency</th>
                <th className="text-left py-2 font-medium">Channel</th>
                <th className="text-left py-2 font-medium pr-4">Automation</th>
              </tr>
            </thead>
            <tbody>
              {COMMUNICATION_MATRIX.map((r) => (
                <tr key={r.purpose} className="border-b last:border-0 align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.purpose}</div>
                    {r.note && (
                      <div className="text-[11px] text-muted-foreground mt-0.5">{r.note}</div>
                    )}
                  </td>
                  <td className="py-3 text-xs">{r.frequency}</td>
                  <td className="py-3 text-xs">{r.channel}</td>
                  <td className="py-3 pr-4">
                    {r.automatable ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <Zap className="size-3" /> Automatable
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">Manual / scheduled</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Response timelines */}
        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold text-sm flex items-center gap-2 mb-3">
            <Clock className="size-4 text-amber-600" /> Response timelines
          </h2>
          <ul className="space-y-2">
            {RESPONSE_TIMELINES.map((s) => (
              <li key={s.trigger} className="flex items-start justify-between gap-3 text-xs">
                <span className="text-foreground/90">{s.trigger}</span>
                <span className="font-semibold text-amber-700 whitespace-nowrap">{s.target}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Key focus areas */}
        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold text-sm mb-3">Key focus areas</h2>
          <div className="flex flex-wrap gap-1.5">
            {KEY_FOCUS_AREAS.map((a) => (
              <span
                key={a}
                className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-secondary border border-border/60"
              >
                {a}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">{TAILORING_NOTE}</p>
        </div>
      </div>

      {/* Compliance */}
      <div className="border rounded-lg bg-emerald-50/40 border-emerald-200 p-4 flex items-start gap-2.5">
        <ShieldCheck className="size-4 text-emerald-700 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-emerald-900">
          <span className="font-semibold">Compliance:</span> {COMPLIANCE_NOTE}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground border-t pt-3">
        Adapted from the Network FP "5.5 Client Communication Checklist". Use it as the
        baseline cadence; the workflow engine automates the rows marked Automatable.
      </p>
    </div>
  );
}
