import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import {
  ChevronLeft,
  Download,
  FileText,
  Image as ImageIcon,
  Presentation,
  Video,
  Music,
  File,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { contentLibraryAssets, tenants, ASSET_CATEGORIES } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { AssetEditPanel } from "@/components/content-library/AssetEditPanel";
import { assetVisibleTo } from "@/lib/content/asset-url";
import { formatDate } from "@/lib/utils";
import { BrandingLayoutPicker } from "@/components/content-library/BrandingLayoutPicker";
import { PdfBrandingPicker } from "@/components/content-library/PdfBrandingPicker";
import { NonImageSendButton } from "@/components/content-library/NonImageSendButton";

const TYPE_ICON: Record<string, any> = {
  image: ImageIcon,
  pdf: FileText,
  article: FileText,
  presentation: Presentation,
  video: Video,
  audio: Music,
  other: File,
};

const TYPE_TONE: Record<string, string> = {
  image: "bg-emerald-50 text-emerald-700",
  pdf: "bg-rose-50 text-rose-700",
  article: "bg-blue-50 text-blue-700",
  presentation: "bg-amber-50 text-amber-700",
  video: "bg-violet-50 text-violet-700",
  audio: "bg-cyan-50 text-cyan-700",
  other: "bg-gray-50 text-gray-700",
};

export const dynamic = "force-dynamic";

export default async function EquitywalaLibraryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  if (!can(session.roles, "content_library.view", session.permissions)) notFound();
  const canEditAsset = can(session.roles, "content_library.edit", session.permissions);
  // Tenant context: the bespoke RLS policy (global OR own tenant) scopes the
  // lookup; the explicit predicate is belt-and-suspenders. (withSystem would
  // crash here — it leaves app.tenant_id at the role's empty-string default,
  // which the policy casts to ''::uuid.)
  const asset = await withTenant(session.tenantId, async (tx) =>
    (await tx
      .select()
      .from(contentLibraryAssets)
      .where(and(eq(contentLibraryAssets.id, id), assetVisibleTo(session.tenantId)))
      .limit(1))[0] ?? null
  );
  if (!asset) notFound();
  const tenant = (await withTenant(session.tenantId, async (tx) =>
    tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1)
  ))[0];
  const Icon = TYPE_ICON[asset.type] ?? File;

  // For images we never expose the raw S3 URL — preview + download go
  // through /api/content-library/[id]/branded, which composites the
  // tenant's logo / ARN / contact details server-side.
  const brandedPreview = `/api/content-library/${asset.id}/branded?mode=preview`;

  return (
    <div className="space-y-6 max-w-5xl">
      <Link
        href="/dashboard/ssit-library"
        className="text-sm text-muted-foreground hover:underline hover:text-foreground flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to library
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={`chip text-[10px] capitalize ${TYPE_TONE[asset.type] ?? ""}`}>
              {asset.type}
            </span>
            <span className="chip text-[10px] bg-secondary text-foreground capitalize">
              {asset.category.replace(/_/g, " ")}
            </span>
          </div>
          <h1 className="page-title">
            <Icon className="size-6 text-brand-cyan" /> {asset.title}
          </h1>
          {asset.description && (
            <p className="page-subtitle mt-1 max-w-3xl">{asset.description}</p>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground tabular-nums text-right">
          Added {formatDate(asset.createdAt)}
          {asset.fileName && (
            <div className="font-mono truncate max-w-[18rem]">{asset.fileName}</div>
          )}
        </div>
      </div>

      {/* Only the firm's own uploads are editable — the shared assets are Equitywala's. */}
      {canEditAsset && asset.tenantId === session.tenantId && (
        <AssetEditPanel
          assetId={asset.id}
          title={asset.title}
          description={asset.description}
          category={asset.category}
          categories={[...ASSET_CATEGORIES]}
        />
      )}

      {/* The actual co-brand / download UX, per asset type */}
      {asset.type === "image" ? (
        <div className="card-surface p-4 space-y-3">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <h2 className="section-title">Co-brand & download</h2>
              <p className="section-subtitle">
                Pick a layout — your logo, firm name, ARN, mobile, email, website and address are
                composited server-side. The raw image is not accessible.
              </p>
            </div>
          </div>
          <BrandingLayoutPicker
            assetId={asset.id}
            assetTitle={asset.title}
            assetType={asset.type}
            assetFileUrl={asset.fileUrl}
            defaultHeightPct={asset.brandingConfig?.heightPct ?? undefined}
          />
        </div>
      ) : asset.type === "pdf" ? (
        <div className="card-surface p-4 space-y-3">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <h2 className="section-title">Co-brand &amp; download</h2>
              <p className="section-subtitle">
                Pick a template — a branded cover page (your logo, firm name, ARN and the title) is
                prepended and a firm · ARN · SEBI disclaimer · page-number footer is stamped on every
                page. The raw file is never exposed.
              </p>
            </div>
          </div>

          <PdfBrandingPicker
            assetId={asset.id}
            assetTitle={asset.title}
            assetType={asset.type}
            assetFileUrl={asset.fileUrl}
          />

          {/* Secondary options */}
          <div className="flex flex-wrap gap-2 pt-3 border-t border-border">
            <a
              href={asset.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              download={asset.fileName ?? undefined}
              className="btn-secondary"
            >
              <Download className="size-4" /> Download original (un-branded)
            </a>
            <a
              href={`/dashboard/ssit-library/${asset.id}/cover-sheet?autoprint=0`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
            >
              <FileText className="size-4" /> Standalone cover sheet
            </a>
          </div>
        </div>
      ) : (
        <div className="card-surface p-5 space-y-4">
          <h2 className="section-title">Download options</h2>
          <p className="text-sm text-muted-foreground">
            {asset.type === "article"
              ? "View the article and download a branded cover sheet to send alongside it."
              : "Download the original file. Use the branded cover sheet to identify it as yours."}
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={asset.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              download={asset.fileName ?? undefined}
              className="btn-primary"
            >
              <Download className="size-4" /> Download original
            </a>
            <a
              href={`/dashboard/ssit-library/${asset.id}/cover-sheet?autoprint=0`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
            >
              <FileText className="size-4" /> Branded cover sheet (PDF)
            </a>
            <NonImageSendButton
              assetId={asset.id}
              assetTitle={asset.title}
              assetType={asset.type}
              assetFileUrl={asset.fileUrl}
            />
          </div>
        </div>
      )}

      {/* Tags */}
      {Array.isArray(asset.tags) && asset.tags.length > 0 && (
        <div className="card-surface p-4">
          <h2 className="section-title mb-2">Tags</h2>
          <div className="flex flex-wrap gap-1.5">
            {(asset.tags as string[]).map((t) => (
              <span key={t} className="chip text-[10px] bg-secondary text-foreground">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
