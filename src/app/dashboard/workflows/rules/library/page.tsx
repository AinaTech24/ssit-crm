import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, BookMarked } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { RuleLibraryGrid } from "@/components/workflow-rules/RuleLibraryGrid";

export const dynamic = "force-dynamic";

export default async function RuleLibraryPage() {
  const session = await requireSession();
  if (!can(session.roles, "workflow.edit", session.permissions)) redirect("/dashboard/workflows/rules");

  return (
    <div className="space-y-5 max-w-5xl">
      <Link href="/dashboard/workflows/rules" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to Workflow Rules
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <BookMarked className="size-6 text-brand-cyan" /> Rule Library
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Ready-made automations. Add one to your rules — it&apos;s created <strong>disabled</strong> so you can review it,
          pick your message template, then turn it on.
        </p>
      </div>
      <RuleLibraryGrid />
    </div>
  );
}
