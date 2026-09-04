import Link from "next/link";
import { desc, or, isNull, eq } from "drizzle-orm";
import { Sparkles, Plus } from "lucide-react";
import { withTenant } from "@/db/client";
import { contentLibraryAssets } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { can } from "@/lib/auth/rbac";
import { LibraryGrid } from "@/components/content-library/LibraryGrid";

export const dynamic = "force-dynamic";

export default async function EquitywalaLibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const session = await requireSession();
  const q = (sp.q ?? "").trim().toLowerCase();
  const categoryFilter = (sp.category ?? "").split(",").filter(Boolean);
  const typeFilter = (sp.type ?? "").split(",").filter(Boolean);

  const canUpload = can(session.roles, "template.edit", session.permissions);

  // Platform-shared assets (tenant_id IS NULL) PLUS this tenant's own uploads.
  // Run in tenant context: the bespoke RLS policy on content_library_assets
  // (tenant_id IS NULL OR tenant_id = app.tenant_id) returns exactly that set.
  // (withSystem doesn't set app.tenant_id, so its empty-string default crashed
  // the uuid cast — `invalid input syntax for type uuid: ""`.)
  const allRows = await withTenant(session.tenantId, async (tx) =>
    tx
      .select()
      .from(contentLibraryAssets)
      .where(
        or(
          isNull(contentLibraryAssets.tenantId),
          eq(contentLibraryAssets.tenantId, session.tenantId)
        )
      )
      .orderBy(desc(contentLibraryAssets.createdAt))
  );

  let rows = allRows.filter(
    (r) => r.isActive && (!r.expireAt || new Date(r.expireAt) > new Date())
  );
  if (q) {
    rows = rows.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        (r.description?.toLowerCase().includes(q) ?? false)
    );
  }
  if (categoryFilter.length) rows = rows.filter((r) => categoryFilter.includes(r.category));
  if (typeFilter.length) rows = rows.filter((r) => typeFilter.includes(r.type));

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="page-title">
            <Sparkles className="size-6 text-brand-cyan" /> Equitywala Content Library
          </h1>
        </div>
        {canUpload && (
          <Link href="/dashboard/ssit-library/new" className="btn-primary flex items-center gap-1 text-xs">
            <Plus className="size-4" /> Upload Custom Creative
          </Link>
        )}
      </div>

      <CompactFilterBar
        totalCount={rows.length}
        filters={[
          { type: "search", key: "q", placeholder: "Search assets by title or description…" },
          {
            type: "multi",
            key: "type",
            label: "Type",
            options: [
              { value: "image", label: "Image" },
              { value: "pdf", label: "PDF" },
              { value: "article", label: "Article" },
              { value: "presentation", label: "Presentation" },
              { value: "video", label: "Video" },
              { value: "audio", label: "Audio" },
              { value: "other", label: "Other" },
            ],
          },
          {
            type: "multi",
            key: "category",
            label: "Category",
            options: [
              { value: "festive", label: "Festive" },
              { value: "market_update", label: "Market update" },
              { value: "investor_education", label: "Investor education" },
              { value: "product_brochure", label: "Product brochure" },
              { value: "tax_planning", label: "Tax planning" },
              { value: "regulatory", label: "Regulatory" },
              { value: "newsletter", label: "Newsletter" },
              { value: "social_creative", label: "Social creative" },
              { value: "thought_leadership", label: "Thought leadership" },
              { value: "other", label: "Other" },
            ],
          },
        ]}
        rightSlot={
          <CustomViews
            viewsKey="views:ssit-library"
            presets={[
              { id: "images", name: "Images only", params: "type=image" },
              { id: "festive", name: "Festive creatives", params: "category=festive&type=image" },
              { id: "market", name: "Market updates", params: "category=market_update" },
              { id: "education", name: "Investor education", params: "category=investor_education" },
            ]}
          />
        }
      />

      {rows.length === 0 ? (
        <div className="card-surface p-12 text-center text-sm text-muted-foreground">
          <Sparkles className="size-8 mx-auto text-muted-foreground/50" />
          <div className="mt-2 font-medium">No assets in the library yet.</div>
          <p className="mt-2 text-xs max-w-md mx-auto">
            Equitywala uploads festive creatives, market updates, and articles here. Check back soon.
          </p>
        </div>
      ) : (
        <LibraryGrid rows={rows} />
      )}
    </div>
  );
}

