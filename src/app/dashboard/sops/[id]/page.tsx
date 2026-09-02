import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, desc, and, isNull } from "drizzle-orm";
import { ChevronLeft, ScrollText } from "lucide-react";
import { withTenant } from "@/db/client";
import { sops, sopVersions, sopAcknowledgements } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { formatDate } from "@/lib/utils";
import { AcknowledgeButton } from "@/components/sops/AcknowledgeButton";
import { PublishVersionForm } from "@/components/sops/PublishVersionForm";

export const dynamic = "force-dynamic";

export default async function SopDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const data = await withTenant(session.tenantId, async (tx) => {
    // Tenant predicate — a foreign SOP id must resolve to not-found, not leak content.
    const sop = (
      await tx
        .select()
        .from(sops)
        .where(and(eq(sops.id, id), eq(sops.tenantId, session.tenantId), isNull(sops.deletedAt)))
        .limit(1)
    )[0];
    if (!sop) return null;
    const versions = await tx
      .select()
      .from(sopVersions)
      .where(and(eq(sopVersions.sopId, id), eq(sopVersions.tenantId, session.tenantId)))
      .orderBy(desc(sopVersions.createdAt));
    const current = versions.find((v) => v.id === sop.currentVersionId);
    
    const acks = current
      ? await tx
          .select()
          .from(sopAcknowledgements)
          .where(eq(sopAcknowledgements.sopVersionId, current.id))
      : [];

    const myAck = current
      ? (await tx
          .select()
          .from(sopAcknowledgements)
          .where(
            and(
              eq(sopAcknowledgements.sopVersionId, current.id),
              eq(sopAcknowledgements.userId, session.userId)
            )
          )
          .limit(1))[0] || null
      : null;

    return { sop, versions, current, acks, myAck };
  });
  if (!data) notFound();
  const canManage = can(session.roles, "sop.manage", session.permissions);
  const currentMarkdown =
    ((data.current?.body as any)?.markdown as string | undefined) ?? "";

  return (
    <div className="space-y-6 max-w-4xl">
      <Link href="/dashboard/sops" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to SOPs
      </Link>

      <div className="border rounded-lg bg-card p-6">
        <div className="flex items-start gap-4 flex-wrap justify-between">
          <div className="flex items-start gap-4 min-w-0 flex-1">
            <ScrollText className="size-8 text-muted-foreground mt-1 shrink-0" />
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold tracking-tight">{data.sop.title}</h1>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                <span className="font-mono">{data.sop.key}</span>
                {data.sop.category && <span>· {data.sop.category}</span>}
                {data.current && <span>· v{data.current.versionNumber}</span>}
                <span>· {data.acks.length} acknowledged</span>
              </div>
              {(data.sop.requiredRoles ?? []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(data.sop.requiredRoles ?? []).map((r: string) => (
                    <span key={r} className="text-xs px-1.5 py-0.5 rounded bg-muted">{r}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
          
          {data.current && (
            <div className="pt-2 sm:pt-0 shrink-0">
              <AcknowledgeButton
                sopId={data.sop.id}
                hasAcknowledged={!!data.myAck}
                acknowledgedAt={data.myAck?.acknowledgedAt}
              />
            </div>
          )}
        </div>
      </div>

      {data.current && (
        <div className="border rounded-lg bg-card p-6">
          <h2 className="font-semibold mb-3">Current version (v{data.current.versionNumber})</h2>
          <p className="text-xs text-muted-foreground">
            Published {data.current.publishedAt ? formatDate(data.current.publishedAt) : "—"}
          </p>
          <div className="prose prose-sm max-w-none mt-3 whitespace-pre-wrap">
            {(data.current.body as any)?.markdown ?? JSON.stringify(data.current.body, null, 2)}
          </div>
          {canManage && (
            <div className="mt-5 pt-4 border-t">
              <PublishVersionForm sopId={data.sop.id} currentMarkdown={currentMarkdown} />
            </div>
          )}
        </div>
      )}

      {data.versions.length > 1 && (
        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold mb-3">Version history</h2>
          <ul className="divide-y text-sm">
            {data.versions.map((v) => (
              <li key={v.id} className="py-2 flex items-center justify-between">
                <span>v{v.versionNumber}</span>
                <span className="text-xs text-muted-foreground">
                  {v.publishedAt ? formatDate(v.publishedAt) : "draft"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
