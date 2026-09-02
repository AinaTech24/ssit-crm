import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { templates, templateVersions } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { EditTemplateForm } from "./EditTemplateForm";

export const dynamic = "force-dynamic";

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  
  const data = await withTenant(session.tenantId, async (tx) => {
    const tpl = (await tx.select().from(templates).where(eq(templates.id, id)).limit(1))[0];
    if (!tpl) return null;
    
    const ver = tpl.currentVersionId
      ? (await tx.select().from(templateVersions).where(eq(templateVersions.id, tpl.currentVersionId)).limit(1))[0]
      : null;
      
    return { tpl, ver };
  });

  if (!data) {
    notFound();
  }

  return (
    <div className="max-w-[1400px] mx-auto py-2">
      <EditTemplateForm initialTemplate={data.tpl} initialVersion={data.ver} />
    </div>
  );
}
