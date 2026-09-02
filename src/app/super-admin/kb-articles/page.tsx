import Link from "next/link";
import { asc, desc } from "drizzle-orm";
import { Plus, BookOpen, Eye, EyeOff, ImageIcon, HelpCircle } from "lucide-react";
import { withPlatformAdmin } from "@/db/client";
import { kbArticles } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

export default async function KbArticlesPage() {
  const session = await requireSession();
  requirePlatform(session.roles, "platform.package.manage");
  const rows = await withPlatformAdmin(session.userId, async (tx) =>
    tx.select().from(kbArticles).orderBy(asc(kbArticles.sortOrder), desc(kbArticles.episodeNo)).limit(500)
  );

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Knowledge Base — KAIZEN</h1>
          <p className="text-muted-foreground text-sm">
            Scenario + questions are public; the walkthrough and screenshots need a login. Changes go live immediately.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/knowledge-base" target="_blank" className="rounded-md border px-3 py-1.5 text-sm inline-flex items-center gap-1.5 hover:bg-accent">
            <Eye className="size-4" /> View hub
          </Link>
          <Link href="/super-admin/kb-articles/new" className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1.5">
            <Plus className="size-4" /> New article
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="p-12 text-center text-sm text-muted-foreground border rounded-lg bg-card">
          <BookOpen className="size-8 mx-auto text-muted-foreground/50" />
          <div className="mt-2">No articles yet.</div>
          <Link href="/super-admin/kb-articles/new" className="text-primary hover:underline mt-2 inline-block">
            Write KAIZEN #1 →
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((a) => {
            const shots = Array.isArray(a.screenshots) ? a.screenshots.length : 0;
            const qs = Array.isArray(a.questions) ? a.questions.length : 0;
            return (
              <Link
                key={a.id}
                href={`/super-admin/kb-articles/${a.id}`}
                className={`flex items-center gap-4 border rounded-lg bg-card px-4 py-3 hover:border-primary/40 hover:shadow-sm transition ${a.published ? "" : "opacity-60"}`}
              >
                <div className="w-16 shrink-0 text-center">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-primary">{a.series}</div>
                  <div className="text-sm font-mono tabular-nums">{a.episodeNo != null ? `#${a.episodeNo}` : "—"}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{a.title}</div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    /{a.slug}
                    {a.hook ? ` · ${a.hook}` : ""}
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1" title={`${qs} questions`}>
                    <HelpCircle className="size-3.5" /> {qs}
                  </span>
                  <span className="inline-flex items-center gap-1" title={`${shots} screenshots`}>
                    <ImageIcon className="size-3.5" /> {shots}
                  </span>
                </div>
                <div className="shrink-0 w-6 flex justify-center" title={a.published ? "Published" : "Draft"}>
                  {a.published ? <Eye className="size-4 text-emerald-600" /> : <EyeOff className="size-4 text-muted-foreground" />}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
