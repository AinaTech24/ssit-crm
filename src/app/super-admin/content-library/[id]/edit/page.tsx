import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/platform";
import { contentLibraryAssets } from "@/db/schema";
import { AssetEditForm, type AssetInitial } from "@/components/super-admin/AssetEditForm";

export const dynamic = "force-dynamic";

export default async function EditAssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  if (!isPlatformAdmin(session.roles)) {
    return <div className="card-surface p-12 text-center text-sm text-muted-foreground">Platform admins only.</div>;
  }

  const row = await withPlatformAdmin(session.userId, async (tx) =>
    (await tx.select().from(contentLibraryAssets).where(eq(contentLibraryAssets.id, id)).limit(1))[0] ?? null
  );
  if (!row) notFound();

  const asset: AssetInitial = {
    id: row.id,
    title: row.title ?? "",
    description: row.description ?? "",
    type: row.type,
    category: row.category ?? "general",
    thumbnailUrl: row.thumbnailUrl ?? "",
    tags: (row.tags as string[]) ?? [],
    isActive: row.isActive,
    publishAt: row.publishAt ? new Date(row.publishAt).toISOString().slice(0, 10) : "",
    expireAt: row.expireAt ? new Date(row.expireAt).toISOString().slice(0, 10) : "",
    branding: (row.brandingConfig as any) ?? {},
  };

  return <AssetEditForm asset={asset} />;
}
