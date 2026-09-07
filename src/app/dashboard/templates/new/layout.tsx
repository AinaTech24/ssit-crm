import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";

/**
 * Server-side gate for the "new template" designer.
 *
 * The page itself is a client component, so it cannot check the session. The
 * templates list already hides the button, and POST /api/templates already
 * requires template.create — but without this the whole designer still rendered
 * for anyone who typed the URL, and only failed on save. Authoring a template
 * is firm-admin only; the wall belongs at the door.
 */
export default async function NewTemplateLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  requireAny(session.roles, ["template.create"], session.permissions);
  return <>{children}</>;
}
