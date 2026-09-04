import Link from "next/link";
import { sql } from "drizzle-orm";
import { Plus, Image as ImageIcon, Sparkles, Download, Share2, Layers } from "lucide-react";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/platform";
import { ContentLibraryManager, type AssetRow } from "@/components/super-admin/ContentLibraryManager";

export const dynamic = "force-dynamic";

export default async function EquitywalaContentLibraryPage() {
  const session = await requireSession();
  if (!isPlatformAdmin(session.roles)) {
    return <div className="card-surface p-12 text-center text-sm text-muted-foreground">Platform admins only.</div>;
  }

  const { assets, totals } = await withPlatformAdmin(session.userId, async (tx) => {
    // Assets + their usage counts in one round-trip.
    const rows = await tx.execute(sql`
      SELECT a.id, a.title, a.description, a.type, a.category, a.thumbnail_url, a.is_active,
             a.source, a.publish_at, a.expire_at, a.created_at, a.file_size_bytes,
             COALESCE(e.cobrands, 0)::int AS cobrands,
             COALESCE(e.downloads, 0)::int AS downloads,
             COALESCE(e.sends, 0)::int AS sends
      FROM content_library_assets a
      LEFT JOIN (
        SELECT asset_id,
               COUNT(*) FILTER (WHERE event_type = 'cobrand')  AS cobrands,
               COUNT(*) FILTER (WHERE event_type = 'download')  AS downloads,
               COUNT(*) FILTER (WHERE event_type = 'send')      AS sends
        FROM content_library_events GROUP BY asset_id
      ) e ON e.asset_id = a.id
      ORDER BY a.created_at DESC
    `);

    const t = (await tx.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM content_library_assets WHERE is_active) AS active_assets,
        (SELECT COUNT(*)::int FROM content_library_assets) AS total_assets,
        (SELECT COUNT(*)::int FROM content_library_events WHERE event_type = 'download') AS downloads,
        (SELECT COUNT(*)::int FROM content_library_events WHERE event_type = 'send') AS sends,
        (SELECT COUNT(*)::int FROM content_library_events WHERE event_type = 'cobrand') AS cobrands
    `)).rows[0] as any;

    return {
      assets: (rows.rows as any[]).map((r): AssetRow => ({
        id: r.id,
        title: r.title,
        description: r.description,
        type: r.type,
        category: r.category,
        thumbnailUrl: r.thumbnail_url,
        isActive: r.is_active,
        source: r.source,
        publishAt: r.publish_at ? new Date(r.publish_at).toISOString() : null,
        expireAt: r.expire_at ? new Date(r.expire_at).toISOString() : null,
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
        fileSizeBytes: r.file_size_bytes != null ? Number(r.file_size_bytes) : null,
        cobrands: Number(r.cobrands),
        downloads: Number(r.downloads),
        sends: Number(r.sends),
      })),
      totals: {
        activeAssets: Number(t.active_assets),
        totalAssets: Number(t.total_assets),
        downloads: Number(t.downloads),
        sends: Number(t.sends),
        cobrands: Number(t.cobrands),
      },
    };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title"><ImageIcon className="size-6 text-primary" /> Content Library</h1>
        </div>
        <Link href="/super-admin/content-library/new" className="btn-primary"><Plus className="size-4" /> Upload asset</Link>
      </div>

      {/* Usage summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={Layers} label="Assets" value={`${totals.activeAssets} active`} sub={`${totals.totalAssets} total`} tone="brand" />
        <Stat icon={Sparkles} label="Co-brands" value={totals.cobrands.toLocaleString("en-IN")} sub="MFD brand overlays" tone="violet" />
        <Stat icon={Download} label="Downloads" value={totals.downloads.toLocaleString("en-IN")} sub="saved by MFDs" tone="emerald" />
        <Stat icon={Share2} label="Sends" value={totals.sends.toLocaleString("en-IN")} sub="to clients" tone="amber" />
      </div>

      {totals.totalAssets === 0 ? (
        <div className="card-surface p-12 text-center text-sm text-muted-foreground">
          <ImageIcon className="size-8 mx-auto text-muted-foreground/50" />
          <div className="mt-2 font-medium">No assets yet.</div>
          <Link href="/super-admin/content-library/new" className="text-primary hover:underline mt-2 inline-block">Upload the first asset →</Link>
        </div>
      ) : (
        <ContentLibraryManager assets={assets} />
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub, tone }: { icon: any; label: string; value: string; sub: string; tone: "brand" | "violet" | "emerald" | "amber" }) {
  const tones: Record<string, string> = {
    brand: "text-primary bg-primary/10",
    violet: "text-violet-600 bg-violet-500/10",
    emerald: "text-emerald-600 bg-emerald-500/10",
    amber: "text-amber-600 bg-amber-500/10",
  };
  return (
    <div className="border rounded-xl bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        <span className={`size-7 rounded-lg grid place-items-center ${tones[tone]}`}><Icon className="size-4" /></span>
      </div>
      <div className="text-xl font-bold mt-2">{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}
