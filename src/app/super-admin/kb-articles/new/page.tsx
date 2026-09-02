import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { KbArticleForm } from "@/components/super-admin/KbArticleForm";

export const dynamic = "force-dynamic";

export default async function NewKbArticlePage() {
  const session = await requireSession();
  requirePlatform(session.roles, "platform.package.manage");
  return <KbArticleForm />;
}
