import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { ChevronLeft, ShieldCheck, AlertTriangle, Check } from "lucide-react";
import { withTenant, db } from "@/db/client";
import { templates, templateVersions, tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * SEBI May 1, 2026 mandate scanner.
 *
 * AMFI Master Circular AMFI/MFD-CIR/32/2025-26 requires every outbound
 * communication to carry:
 *   - "AMFI Registered Mutual Fund Distributor"
 *   - "ARN-<number>"
 *   - the registered firm name
 *
 * This page scans every approved template version and flags any that don't.
 * Click into a template to fix it before the deadline.
 */

const REQUIRED_PHRASES = [
  { key: "amfi_registered", pattern: /AMFI Registered/i, label: "AMFI Registered tag" },
  { key: "arn", patternBuilder: (arn: string) => new RegExp(`ARN[\\s-]?${arn.replace(/[^A-Z0-9]/gi, "")}`, "i"), label: "ARN number" },
  { key: "market_risk", pattern: /market risk/i, label: "Market risk disclaimer", marketingOnly: true },
];

function extractText(channel: string, body: any): string {
  if (!body) return "";
  if (channel === "whatsapp")
    return [body?.header?.text, body?.body?.text, body?.footer?.text].filter(Boolean).join("\n");
  if (channel === "email")
    return [
      body?.subject,
      body?.preheader,
      (body?.blocks ?? []).map((b: any) => b?.text ?? b?.content ?? "").filter(Boolean).join("\n"),
      body?.textFallback,
    ]
      .filter(Boolean)
      .join("\n");
  if (channel === "sms") return body?.text ?? "";
  return JSON.stringify(body);
}

export default async function TaglineCheckPage() {
  const session = await requireSession();
  const tenant = (await withTenant(session.tenantId, async (tx) =>
    tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1)
  ))[0];
  const arnNumber = (tenant?.arn ?? "").replace(/[^A-Z0-9]/gi, "");

  const rows = await withTenant(session.tenantId, async (tx) => {
    return tx
      .select({ tpl: templates, ver: templateVersions })
      .from(templates)
      .innerJoin(templateVersions, eq(templateVersions.id, templates.currentVersionId))
      .where(eq(templates.status, "approved"))
      .orderBy(desc(templates.updatedAt));
  });

  // For each row, compute the missing phrases
  const audited = rows.map((r) => {
    const text = extractText(r.tpl.channel, r.ver.body);
    const missing: string[] = [];
    for (const req of REQUIRED_PHRASES) {
      if (req.marketingOnly && r.tpl.category !== "marketing") continue;
      const pattern = "patternBuilder" in req && typeof (req as any).patternBuilder === "function" && arnNumber
        ? (req as any).patternBuilder(arnNumber)
        : (req as any).pattern;
      if (!pattern.test(text)) missing.push(req.label);
    }
    return { ...r, missing, text };
  });

  const compliant = audited.filter((a) => a.missing.length === 0).length;
  const nonCompliant = audited.length - compliant;

  return (
    <div className="space-y-6 max-w-6xl">
      <Link
        href="/dashboard/compliance"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to compliance
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ShieldCheck className="size-6" /> SEBI May 2026 tagline check
        </h1>
        <p className="text-muted-foreground text-sm max-w-3xl">
          AMFI Master Circular requires every outbound communication to display{" "}
          <strong>"AMFI Registered Mutual Fund Distributor"</strong>, your firm's <strong>ARN number</strong>,
          and (for marketing) the standard <strong>market-risk disclaimer</strong> — effective May 1, 2026.
          This page scans every approved template; the live compliance gate also blocks any send that doesn't include these phrases.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Approved templates" value={audited.length} icon={ShieldCheck} />
        <Stat label="Compliant" value={compliant} tone="emerald" icon={Check} />
        <Stat label="Need fix" value={nonCompliant} tone={nonCompliant > 0 ? "rose" : "muted"} icon={AlertTriangle} />
      </div>

      <div className="rounded-md border bg-card p-4 text-sm">
        <div className="font-medium mb-1">Your firm's tagline tokens</div>
        <div className="grid grid-cols-3 gap-3 mt-2 text-xs">
          <div>
            <div className="text-muted-foreground">Firm name</div>
            <div className="font-medium">{tenant?.legalName ?? "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">ARN</div>
            <div className="font-mono font-medium">{tenant?.arn ?? "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Principal EUIN</div>
            <div className="font-mono font-medium">{tenant?.principalEuin ?? "—"}</div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          These auto-resolve from <code className="bg-muted px-1 rounded">{`{{arn_name}}`}</code>,{" "}
          <code className="bg-muted px-1 rounded">{`{{arn_no}}`}</code>,{" "}
          <code className="bg-muted px-1 rounded">{`{{euin}}`}</code> tokens in any template — just include them in the footer.
        </p>
      </div>

      <div className="border rounded-lg bg-card">
        <div className="border-b px-4 py-2.5 font-medium">Template audit</div>
        {audited.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No approved templates yet. Templates go through the compliance gate on submit anyway.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Template</th>
                <th className="text-left py-2 font-medium">Channel</th>
                <th className="text-left py-2 font-medium">Category</th>
                <th className="text-left py-2 font-medium">Status</th>
                <th className="text-left py-2 font-medium pl-3">Missing</th>
              </tr>
            </thead>
            <tbody>
              {audited.map((r) => (
                <tr key={r.tpl.id} className="border-b last:border-0 hover:bg-accent/40">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/templates/${r.tpl.id}`} className="font-medium hover:underline">
                      {r.tpl.name}
                    </Link>
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">{r.tpl.key}</div>
                  </td>
                  <td className="py-3 text-xs uppercase text-muted-foreground">{r.tpl.channel}</td>
                  <td className="py-3 text-xs uppercase text-muted-foreground">{r.tpl.category}</td>
                  <td className="py-3">
                    {r.missing.length === 0 ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 flex items-center gap-1 w-fit">
                        <Check className="size-3" /> Compliant
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 flex items-center gap-1 w-fit">
                        <AlertTriangle className="size-3" /> Needs fix
                      </span>
                    )}
                  </td>
                  <td className="py-3 pl-3 text-xs text-muted-foreground">
                    {r.missing.length > 0 ? r.missing.join(", ") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border rounded-lg bg-blue-50 border-blue-200 p-4 text-sm text-blue-900">
        <strong>Standard footer to copy</strong> (add to any template footer):
        <pre className="mt-2 bg-white/60 rounded p-3 text-xs whitespace-pre-wrap">
{`Mutual fund investments are subject to market risks.
Read all scheme related documents carefully.
— ${tenant?.legalName ?? "{{arn_name}}"}, AMFI Registered Mutual Fund Distributor (ARN-${tenant?.arn?.replace(/^ARN-?/, "") ?? "{{arn_no}}"}).`}
        </pre>
      </div>
    </div>
  );
}

function Stat({ label, value, tone, icon: Icon }: { label: string; value: number; tone?: "rose" | "emerald" | "muted"; icon?: any }) {
  const color = tone === "rose" ? "text-rose-600" : tone === "emerald" ? "text-emerald-600" : "text-foreground";
  return (
    <div className="border rounded-lg p-4 bg-card">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        {Icon && <Icon className="size-3.5" />}
      </div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}
