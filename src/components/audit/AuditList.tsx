"use client";

/**
 * Audit event list with an expandable detail drawer. Each row can open to show
 * the field-level before→after diff plus actor IP / user-agent / reason / meta —
 * turning the flat trail into an investigation tool for disputes and DPDP/SEBI
 * inquiries. The before/after JSON is already captured server-side; this surfaces it.
 */

import { useState } from "react";
import { User, Bot, Workflow, Webhook, AlertCircle, ChevronRight } from "lucide-react";

const actorIcons = { user: User, system: Bot, workflow: Workflow, webhook: Webhook };

export type AuditRow = {
  id: string;
  at: string; // ISO
  atLabel: string; // relative
  actorType: string;
  actorName: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  reason: string | null;
  pii: boolean;
  piiFields: string[];
  ip: string | null;
  userAgent: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
};

function istLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "medium" }) + " IST";
  } catch {
    return iso;
  }
}

/** Field-level diff: keys whose value changed between before and after. */
function diffFields(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: { key: string; from: unknown; to: unknown }[] = [];
  for (const k of keys) {
    const a = before?.[k];
    const b = after?.[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ key: k, from: a, to: b });
  }
  return out;
}

function fmt(v: unknown): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function AuditList({ rows }: { rows: AuditRow[] }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <ul className="divide-y text-sm">
      {rows.map((r) => {
        const Icon = actorIcons[r.actorType as keyof typeof actorIcons] ?? User;
        const isOpen = open === r.id;
        const changes = diffFields(r.before, r.after);
        const hasDetail = changes.length > 0 || r.ip || r.userAgent || r.reason || (r.meta && Object.keys(r.meta).length > 0) || r.piiFields.length > 0;
        return (
          <li key={r.id}>
            <button
              onClick={() => hasDetail && setOpen(isOpen ? null : r.id)}
              className={`w-full px-4 py-2.5 flex items-center gap-3 hover:bg-accent/40 text-left font-mono ${hasDetail ? "cursor-pointer" : "cursor-default"}`}
            >
              {hasDetail ? (
                <ChevronRight className={`size-3.5 text-muted-foreground flex-shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} />
              ) : (
                <span className="w-3.5 flex-shrink-0" />
              )}
              <Icon className="size-3.5 text-muted-foreground flex-shrink-0" />
              <span className="text-xs text-muted-foreground tabular-nums w-32 flex-shrink-0" title={istLabel(r.at)}>
                {r.atLabel}
              </span>
              <span className="text-xs w-32 truncate flex-shrink-0">{r.actorName}</span>
              <span className="text-xs flex-1 truncate">
                <span className="font-semibold">{r.action}</span>
                {r.entityType && (
                  <span className="text-muted-foreground"> · {r.entityType}:{r.entityId?.slice(0, 8)}</span>
                )}
                {r.reason && <span className="text-muted-foreground"> · &quot;{r.reason}&quot;</span>}
              </span>
              {r.pii && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 flex items-center gap-1 flex-shrink-0">
                  <AlertCircle className="size-3" /> PII
                </span>
              )}
            </button>

            {isOpen && hasDetail && (
              <div className="px-12 pb-4 pt-1 bg-secondary/20 text-xs space-y-3 border-t">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 pt-3">
                  <Meta label="When (IST)" value={istLabel(r.at)} />
                  <Meta label="Actor" value={`${r.actorName} (${r.actorType})`} />
                  {r.ip && <Meta label="IP address" value={r.ip} />}
                  {r.entityId && <Meta label="Entity" value={`${r.entityType}:${r.entityId}`} mono />}
                </div>
                {r.userAgent && <Meta label="User agent" value={r.userAgent} />}

                {r.piiFields.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold mb-1">PII fields accessed</div>
                    <div className="flex flex-wrap gap-1">
                      {r.piiFields.map((f) => (
                        <span key={f} className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-mono">{f}</span>
                      ))}
                    </div>
                  </div>
                )}

                {changes.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Changes ({changes.length})</div>
                    <table className="w-full font-mono">
                      <thead>
                        <tr className="text-[10px] text-muted-foreground">
                          <th className="text-left font-medium py-0.5 w-1/4">Field</th>
                          <th className="text-left font-medium py-0.5">Before</th>
                          <th className="text-left font-medium py-0.5">After</th>
                        </tr>
                      </thead>
                      <tbody>
                        {changes.map((c) => (
                          <tr key={c.key} className="border-t border-border/50 align-top">
                            <td className="py-1 pr-2 font-medium">{c.key}</td>
                            <td className="py-1 pr-2 text-rose-600 break-all">{fmt(c.from)}</td>
                            <td className="py-1 text-emerald-700 break-all">{fmt(c.to)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {r.meta && Object.keys(r.meta).length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Metadata</div>
                    <pre className="bg-card border rounded p-2 overflow-x-auto text-[11px]">{JSON.stringify(r.meta, null, 2)}</pre>
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={`truncate ${mono ? "font-mono" : ""}`} title={value}>{value}</div>
    </div>
  );
}
