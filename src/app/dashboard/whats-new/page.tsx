/**
 * What's new — the in-app changelog.
 *
 * SSIT ships continuously; without this an MFD only discovers a feature by
 * stumbling on it. Entries are published once at platform level and every firm
 * sees the same timeline. Opening the page marks everything read, which clears
 * the header badge.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { Sparkles, ArrowRight } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { Markdown } from "@/components/ai/Markdown";

export const dynamic = "force-dynamic";

const CATEGORY_STYLE: Record<string, { label: string; cls: string }> = {
  feature: { label: "New", cls: "bg-emerald-50 text-emerald-700" },
  improvement: { label: "Improved", cls: "bg-sky-50 text-sky-700" },
  fix: { label: "Fixed", cls: "bg-amber-50 text-amber-700" },
  compliance: { label: "Compliance", cls: "bg-brand-cyan-light/60 text-brand-cyan-deep" },
};

export default async function WhatsNewPage() {
  const session = await requireSession();

  const notes = await withTenant(
    session.tenantId,
    async (tx) => {
      const r = await tx.execute(sql`
        SELECT id, version, title, body, category, module, href, published_at
        FROM release_notes
        WHERE published_at IS NOT NULL AND published_at <= now()
        ORDER BY published_at DESC
        LIMIT 200`);

      // Opening the page IS the read receipt — mark everything currently
      // published as read for this user so the header badge clears.
      await tx.execute(sql`
        INSERT INTO release_note_reads (tenant_id, user_id, release_note_id)
        SELECT ${session.tenantId}::uuid, ${session.userId}::uuid, rn.id
          FROM release_notes rn
         WHERE rn.published_at IS NOT NULL AND rn.published_at <= now()
        ON CONFLICT (tenant_id, user_id, release_note_id) DO NOTHING`);

      return r.rows as any[];
    },
    { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles }
  );

  // Group by month so a long history stays scannable.
  const groups = new Map<string, any[]>();
  for (const n of notes) {
    const d = new Date(n.published_at);
    const key = d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(n);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="page-title"><Sparkles className="size-6 text-brand-cyan" /> What&apos;s new</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Everything we&apos;ve shipped to your CRM, newest first.
        </p>
      </div>

      {notes.length === 0 ? (
        <div className="card-surface p-12 text-center text-sm text-muted-foreground">
          No release notes published yet.
        </div>
      ) : (
        [...groups.entries()].map(([month, items]) => (
          <section key={month} className="space-y-3">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{month}</h2>
            {items.map((n) => {
              const cat = CATEGORY_STYLE[n.category] ?? CATEGORY_STYLE.feature;
              return (
                <article key={n.id} className="card-surface p-4">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className={`chip text-[11px] ${cat.cls}`}>{cat.label}</span>
                    {n.module && <span className="text-[11px] text-muted-foreground">{n.module}</span>}
                    {n.version && <span className="text-[11px] text-muted-foreground">· {n.version}</span>}
                    <span className="text-[11px] text-muted-foreground ml-auto">
                      {new Date(n.published_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                    </span>
                  </div>
                  <h3 className="font-semibold text-sm">{n.title}</h3>
                  <div className="mt-1.5 text-sm">
                    <Markdown text={n.body} />
                  </div>
                  {n.href && (
                    <Link href={n.href} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-cyan-deep hover:underline">
                      Open it <ArrowRight className="size-3.5" />
                    </Link>
                  )}
                </article>
              );
            })}
          </section>
        ))
      )}
    </div>
  );
}
