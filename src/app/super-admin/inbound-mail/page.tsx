import Link from "next/link";
import { sql } from "drizzle-orm";
import { MailOpen } from "lucide-react";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { formatRelative } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Equitywala Admin → Inbound Mail.
 *
 * Every message the RTA mailback poller has touched, routed or not — the answer to
 * "did the email my firm forwarded actually arrive, and what happened to it?".
 * Reads rta_inbound_messages across all firms (platform admins only; unroutable
 * mail has no firm and is visible nowhere else).
 */

const OUTCOMES: Array<{ key: string; label: string; tone: string; hint: string }> = [
  { key: "imported", label: "Imported", tone: "bg-emerald-50 text-emerald-700", hint: "At least one report was queued for import" },
  { key: "confirmation", label: "Forwarding confirm", tone: "bg-sky-50 text-sky-700", hint: "A Gmail/Outlook confirmation code (no data)" },
  { key: "duplicate", label: "Already imported", tone: "bg-slate-100 text-slate-700", hint: "Every report in it was already received" },
  { key: "no_attachment", label: "No RTA file", tone: "bg-amber-50 text-amber-700", hint: "Reached a firm but nothing importable was recognised" },
  { key: "unroutable", label: "Unroutable", tone: "bg-rose-50 text-rose-700", hint: "No firm matched the address — needs a human" },
  { key: "error", label: "Error", tone: "bg-rose-50 text-rose-700", hint: "Handling the message failed" },
];
const TONE = Object.fromEntries(OUTCOMES.map((o) => [o.key, o.tone]));
const LABEL = Object.fromEntries(OUTCOMES.map((o) => [o.key, o.label]));

type Row = {
  id: string;
  received_at: string | null;
  created_at: string;
  from_address: string | null;
  to_address: string | null;
  subject: string | null;
  outcome: string;
  reason: string | null;
  body_snippet: string | null;
  attachments: Array<{ filename: string; size: number; source: string | null; kind: string | null; outcome: string; reason?: string | null }> | null;
  legal_name: string | null;
};

export default async function InboundMailPage({ searchParams }: { searchParams: Promise<{ outcome?: string }> }) {
  const session = await requireSession();
  requirePlatform(session.roles, "platform.settings.manage");
  const sp = await searchParams;
  const outcome = OUTCOMES.some((o) => o.key === sp.outcome) ? sp.outcome! : "";

  const { counts, rows, config } = await withPlatformAdmin(session.userId, async (tx) => {
    const c = await tx.execute(sql`
      SELECT outcome, COUNT(*)::int AS n
      FROM rta_inbound_messages
      WHERE created_at > now() - interval '30 days'
      GROUP BY outcome
    `);
    const r = await tx.execute(sql`
      SELECT m.id, m.received_at, m.created_at, m.from_address, m.to_address, m.subject,
             m.outcome, m.reason, m.body_snippet, m.attachments, t.legal_name
      FROM rta_inbound_messages m
      LEFT JOIN tenants t ON t.id = m.tenant_id
      WHERE ${outcome ? sql`m.outcome = ${outcome}` : sql`TRUE`}
      ORDER BY m.created_at DESC
      LIMIT 100
    `);
    const s = await tx.execute(sql`SELECT value FROM platform_settings WHERE key = 'rta_inbox' LIMIT 1`);
    return {
      counts: Object.fromEntries((c.rows as Array<{ outcome: string; n: number }>).map((x) => [x.outcome, x.n])),
      rows: r.rows as unknown as Row[],
      config: (s.rows[0] as { value?: { mode?: string; sesBucket?: string; sesPrefix?: string; host?: string } } | undefined)?.value ?? null,
    };
  });

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const source =
    config?.mode === "ses"
      ? `Amazon SES → s3://${config.sesBucket ?? "?"}/${config.sesPrefix ?? ""}`
      : config?.host
        ? `IMAP mailbox (${config.host})`
        : "not configured";

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <MailOpen className="size-6" /> Inbound Mail
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every forwarded RTA mailback email the platform has received, and what happened to it. Source:{" "}
            <span className="font-medium text-foreground">{source}</span>.
          </p>
        </div>
        <Link href="/super-admin/rta-inbox" className="text-sm text-brand-cyan hover:underline">
          Mailbox settings →
        </Link>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <Link
          href="/super-admin/inbound-mail"
          className={`px-3 py-1.5 rounded-full border ${!outcome ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}
        >
          All · last 30 days ({total})
        </Link>
        {OUTCOMES.map((o) => (
          <Link
            key={o.key}
            href={`/super-admin/inbound-mail?outcome=${o.key}`}
            title={o.hint}
            className={`px-3 py-1.5 rounded-full border ${outcome === o.key ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}
          >
            {o.label} ({counts[o.key] ?? 0})
          </Link>
        ))}
      </div>

      <div className="border rounded-lg bg-card overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No messages yet. Once the MX record is live, send a test email to your inbound address — it appears here within
            a couple of minutes.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b bg-secondary/40">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Received</th>
                <th className="text-left py-2 font-medium">From</th>
                <th className="text-left py-2 font-medium">To</th>
                <th className="text-left py-2 font-medium">Firm</th>
                <th className="text-left py-2 font-medium">Subject</th>
                <th className="text-left py-2 pr-4 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-b last:border-0 align-top">
                  <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                    {formatRelative(m.received_at ?? m.created_at)}
                  </td>
                  <td className="py-2 max-w-[14rem] truncate" title={m.from_address ?? ""}>{m.from_address ?? "—"}</td>
                  <td className="py-2 max-w-[14rem] truncate font-mono text-xs" title={m.to_address ?? ""}>{m.to_address ?? "—"}</td>
                  <td className="py-2">{m.legal_name ?? <span className="text-rose-600">unrouted</span>}</td>
                  <td className="py-2 max-w-[18rem]">
                    <details>
                      <summary className="cursor-pointer truncate">{m.subject || "(no subject)"}</summary>
                      <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                        {m.reason && <div className="text-foreground">{m.reason}</div>}
                        {(m.attachments ?? []).length > 0 && (
                          <ul className="space-y-0.5">
                            {(m.attachments ?? []).map((a, i) => (
                              <li key={i}>
                                <span className="font-mono">{a.filename}</span> · {Math.round(a.size / 1024)} KB ·{" "}
                                {a.source ? `${a.source} ${a.kind ?? ""}` : "not recognised"} · <b>{a.outcome}</b>
                                {a.reason ? ` — ${a.reason}` : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                        {m.body_snippet && <pre className="whitespace-pre-wrap max-h-40 overflow-auto rounded bg-secondary/50 p-2">{m.body_snippet}</pre>}
                      </div>
                    </details>
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${TONE[m.outcome] ?? "bg-secondary"}`}>
                      {LABEL[m.outcome] ?? m.outcome}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
