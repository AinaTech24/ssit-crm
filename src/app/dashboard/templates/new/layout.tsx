import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import Link from "next/link";

/**
 * Server-side gate for the "new template" designer.
 *
 * The page itself is a client component, so it cannot check the session. The
 * templates list already hides the button, and POST /api/templates already
 * requires template.create — but without this the whole designer still rendered
 * for anyone who typed the URL, and only failed on save. Authoring a template
 * is firm-admin only; the wall belongs at the door. Someone without it gets a plain
 * explanation, not the generic "Something went wrong" error page.
 */
export default async function NewTemplateLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!can(session.roles, "template.create", session.permissions)) {
    return (
      <div className="max-w-xl mx-auto mt-10 border rounded-lg bg-card p-8 text-center space-y-3">
        <h1 className="text-lg font-semibold">Only an admin can create templates</h1>
        <p className="text-sm text-muted-foreground">
          A template is what the firm is allowed to say to clients, so writing one is limited to the firm admin. You can
          still view the existing templates, and an admin can give you this permission.
        </p>
        <Link href="/dashboard/templates" className="btn-secondary inline-flex">
          Back to templates
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}
