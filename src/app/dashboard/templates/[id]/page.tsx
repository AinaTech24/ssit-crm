import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { ChevronLeft, MessageCircle, Mail, MessageSquare, AlertCircle, FileText, CheckCircle2, ShieldAlert } from "lucide-react";
import { withTenant } from "@/db/client";
import { templates, templateVersions } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { RecordProvenance } from "@/components/common/RecordProvenance";
import { TemplateActions } from "./TemplateActions";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<string, string> = {
  // version approval statuses
  draft: "bg-gray-100 text-gray-800 border-gray-200",
  submitted: "bg-amber-100 text-amber-800 border-amber-200",
  approved_internal: "bg-emerald-100 text-emerald-800 border-emerald-200",
  approved_external: "bg-emerald-100 text-emerald-800 border-emerald-200",
  rejected: "bg-rose-100 text-rose-800 border-rose-200",
  paused: "bg-slate-100 text-slate-800 border-slate-200",
  // template-level statuses (header chip)
  approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  pending_approval: "bg-amber-100 text-amber-800 border-amber-200",
  archived: "bg-zinc-100 text-zinc-700 border-zinc-200",
};

const channelIcons = { whatsapp: MessageCircle, email: Mail, sms: MessageSquare, inapp: MessageSquare };

export default async function TemplateDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { id } = await params;
  const { v: versionParam } = await searchParams;
  const session = await requireSession();
  
  const data = await withTenant(session.tenantId, async (tx) => {
    const tpl = (await tx.select().from(templates).where(eq(templates.id, id)).limit(1))[0];
    if (!tpl) return null;

    const allVersions = await tx
      .select()
      .from(templateVersions)
      .where(eq(templateVersions.templateId, id))
      .orderBy(desc(templateVersions.versionNumber));

    let ver = null;
    if (versionParam) {
      const vNum = parseInt(versionParam, 10);
      ver = allVersions.find((v) => v.versionNumber === vNum) || null;
    }
    if (!ver && tpl.currentVersionId) {
      ver = allVersions.find((v) => v.id === tpl.currentVersionId) || null;
    }
    if (!ver && allVersions.length > 0) {
      ver = allVersions[0];
    }

    return { tpl, ver, allVersions };
  });

  if (!data) notFound();
  const { tpl, ver, allVersions } = data;

  const hasApproveRole = can(session.roles, "template.approve", session.permissions);
  // Authoring (edit / new version / submit) is firm-admin only — the same
  // capability the API enforces, so nobody is shown a button that 403s.
  const canAuthor = can(session.roles, "template.create", session.permissions);
  const Icon = channelIcons[tpl.channel as keyof typeof channelIcons] ?? MessageSquare;

  return (
    <div className="space-y-6 max-w-5xl mx-auto py-2">
      <Link href="/dashboard/templates" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to templates
      </Link>

      <div className="border rounded-lg bg-card p-6 shadow-sm">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{tpl.name}</h1>
            <div className="flex items-center gap-3 mt-2 text-sm flex-wrap">
              <span className="font-mono text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded border">{tpl.key}</span>
              <div className="flex items-center gap-1.5 text-slate-600 font-semibold uppercase text-xs">
                <Icon className="size-4 text-slate-500" />
                <span>{tpl.channel}</span>
              </div>
              <span className="text-xs font-semibold uppercase text-slate-500 bg-slate-50 px-2 py-0.5 rounded border">{tpl.category}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full border capitalize font-medium ${STATUS_COLORS[tpl.status] ?? ""}`}>
                {tpl.status.replace(/_/g, " ")}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold text-slate-700">Version {ver?.versionNumber ?? "—"}</div>
            {ver?.complianceScore && (
              <div className="flex items-center gap-1.5 mt-1 text-xs justify-end font-mono">
                <span className="text-slate-500">Compliance Score:</span>
                <span className={`font-bold ${Number(ver.complianceScore) >= 90 ? "text-emerald-600" : Number(ver.complianceScore) >= 70 ? "text-amber-600" : "text-rose-600"}`}>
                  {ver.complianceScore}/100
                </span>
              </div>
            )}
          </div>
        </div>

        {ver && (
          <div className="mt-6 border-t pt-4">
            <TemplateActions
              templateId={tpl.id}
              templateStatus={tpl.status}
              versionId={ver.id}
              versionStatus={ver.approvalStatus}
              versionNumber={ver.versionNumber}
              hasApproveRole={hasApproveRole}
              canAuthor={canAuthor}
            />
          </div>
        )}

        <RecordProvenance
          entityType="template"
          entityId={tpl.id}
          createdAt={tpl.createdAt}
          updatedAt={tpl.updatedAt}
          className="mt-3"
        />
      </div>

      {ver && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* Version History Sidebar */}
          <div className="col-span-1 border rounded-lg bg-card p-4 space-y-4 shadow-sm h-fit">
            <h3 className="font-semibold text-xs text-slate-500 uppercase tracking-wider">
              Version History
            </h3>
            <div className="space-y-2">
              {allVersions.map((v) => {
                const isSelected = v.id === ver.id;
                const isActive = v.id === tpl.currentVersionId;
                return (
                  <Link
                    key={v.id}
                    href={`/dashboard/templates/${tpl.id}?v=${v.versionNumber}`}
                    className={`block p-3 rounded-lg border transition-all ${
                      isSelected
                        ? "bg-slate-50 border-primary/50 text-slate-900 shadow-sm font-medium"
                        : "hover:bg-slate-50/50 border-transparent text-slate-600"
                    }`}
                  >
                    <div className="flex justify-between items-center gap-1.5">
                      <span className="font-semibold text-xs text-slate-700">Version {v.versionNumber}</span>
                      {isActive && (
                        <span className="text-[9px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-200 font-bold uppercase tracking-wider">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="flex justify-between items-center mt-2 text-[10px]">
                      <span className={`px-1.5 py-0.5 rounded capitalize ${STATUS_COLORS[v.approvalStatus] ?? ""}`}>
                        {v.approvalStatus.replace(/_/g, " ").replace("approved ", "")}
                      </span>
                      {v.complianceScore && (
                        <span className="font-mono text-slate-500">
                          Score: {Math.round(Number(v.complianceScore))}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Version Details Content */}
          <div className="col-span-1 md:col-span-3 space-y-6">
            <div className="border rounded-lg bg-card p-5 shadow-sm">
              <h2 className="font-semibold mb-3 text-slate-900 flex items-center gap-1.5">
                <FileText className="size-4 text-slate-500" /> Template Body Content
              </h2>
              
              {tpl.channel === "email" ? (
                <div className="space-y-4">
                  <div className="bg-slate-50 p-3 rounded-lg border text-sm space-y-2">
                    <div><strong>Subject:</strong> {(ver.body as any)?.subject}</div>
                    <div><strong>Preheader:</strong> {(ver.body as any)?.preheader}</div>
                  </div>
                  <div className="border rounded-lg overflow-hidden bg-white p-4">
                    {/* Email block renderer preview */}
                    {((ver.body as any)?.blocks as any[])?.length > 0 ? (
                      <div className="divide-y space-y-3">
                        {((ver.body as any).blocks as any[]).map((b, idx) => (
                          <div key={idx} className="pt-3 first:pt-0">
                            <span className="text-[10px] text-slate-400 font-bold tracking-wider uppercase block mb-1">{b.type}</span>
                            <p className="text-sm text-slate-800 whitespace-pre-line">{b.text || b.content || b.title || b.subtitle || b.html || b.label || "—"}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <pre className="text-xs bg-slate-50 p-3 rounded font-mono overflow-x-auto whitespace-pre-wrap">
                        {JSON.stringify(ver.body, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              ) : tpl.channel === "whatsapp" ? (
                <div className="bg-slate-50 border p-4 rounded-lg font-mono text-sm whitespace-pre-wrap text-slate-800">
                  {(ver.body as any).body?.text || JSON.stringify(ver.body)}
                </div>
              ) : (
                <div className="space-y-3">
                  {/* SMS body */}
                  {/* @ts-ignore */}
                  {ver.body?.dltTemplateId && (
                    <div className="text-xs bg-slate-50 border px-3 py-1.5 rounded-lg font-mono">
                      <strong>DLT Template ID:</strong> {(ver.body as any).dltTemplateId}
                    </div>
                  )}
                  <div className="bg-slate-50 border p-4 rounded-lg font-mono text-sm whitespace-pre-wrap text-slate-800">
                    {(ver.body as any).text}
                  </div>
                </div>
              )}
            </div>

            {ver.variables && (ver.variables as any[]).length > 0 && (
              <div className="border rounded-lg bg-card p-5 shadow-sm">
                <h2 className="font-semibold mb-3 text-slate-900">Declared Variables ({(ver.variables as any[]).length})</h2>
                <div className="border rounded-lg overflow-hidden bg-background">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-slate-500 bg-slate-50 border-b">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium">Variable Key</th>
                        <th className="text-left py-2 font-medium">Type</th>
                        <th className="text-left py-2 font-medium">Binding Source</th>
                        <th className="text-left py-2 font-medium">Required</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(ver.variables as any[]).map((v: any) => (
                        <tr key={v.key} className="border-b last:border-0 hover:bg-slate-50/50">
                          <td className="px-4 py-2.5 font-mono font-medium text-slate-700">{v.key}</td>
                          <td className="py-2.5">
                            <span className="text-xs font-semibold bg-blue-50 text-blue-700 px-2 py-0.5 rounded capitalize">{v.type}</span>
                          </td>
                          <td className="py-2.5 font-mono text-xs text-slate-500">{v.source ?? "—"}</td>
                          <td className="py-2.5 text-xs">
                            {v.required ? (
                              <span className="text-rose-600 font-semibold">Yes</span>
                            ) : (
                              <span className="text-slate-400">No</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {Array.isArray((ver as any).attachments) && (ver as any).attachments.length > 0 && (
              <div className="border rounded-lg bg-card p-5 shadow-sm">
                <h2 className="font-semibold mb-3 text-slate-900">Attachments ({(ver as any).attachments.length})</h2>
                <ul className="space-y-1.5 text-sm">
                  {((ver as any).attachments as Array<{ name: string; url: string }>).map((a, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="text-slate-400">📎</span>
                      <a href={a.url} target="_blank" rel="noreferrer" className="text-brand-cyan hover:underline truncate">
                        {a.name || a.url}
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-muted-foreground mt-2">Auto-attached on every email send.</p>
              </div>
            )}

            {Boolean(ver.complianceChecks) && (
              <div className="border rounded-lg bg-card p-5 shadow-sm">
                <h2 className="font-semibold mb-3 text-slate-900 flex items-center gap-1.5">
                  <ShieldAlert className="size-4 text-slate-500" /> Compliance Scan Findings
                </h2>
                {/* @ts-ignore */}
                {ver.complianceChecks.findings && (ver.complianceChecks.findings as any[]).length > 0 ? (
                  <div className="space-y-3">
                    {/* @ts-ignore */}
                    {(ver.complianceChecks.findings as any[]).map((f: any, idx: number) => {
                      const badgeColor = f.severity === "block" ? "bg-rose-50 text-rose-700 border-rose-250" : f.severity === "warn" ? "bg-amber-50 text-amber-700 border-amber-250" : "bg-blue-50 text-blue-700 border-blue-250";
                      return (
                        <div key={idx} className="p-3.5 border rounded-lg bg-slate-50/50 flex gap-3 items-start text-sm">
                          <span className={`px-2 py-0.5 text-xs rounded border capitalize font-semibold ${badgeColor}`}>{f.severity}</span>
                          <div className="space-y-1 flex-1">
                            <div className="font-medium text-slate-800">{f.message}</div>
                            {f.match && <div className="text-xs font-mono bg-slate-100 px-2 py-0.5 rounded inline-block text-slate-600 mt-1">Match: "{f.match}"</div>}
                            {f.remediation && <div className="text-xs text-emerald-700 mt-1"><strong>Suggested Fix:</strong> {f.remediation}</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-6 text-sm text-center text-emerald-800 border border-emerald-200 rounded-lg bg-emerald-50/20 flex flex-col items-center gap-2">
                    <CheckCircle2 className="size-8 text-emerald-600" />
                    <div>
                      <div className="font-semibold">Fully Compliant!</div>
                      <div className="text-xs text-slate-500">This template passes all AMFI and SEBI rules with a compliance score of {ver.complianceScore}/100.</div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
