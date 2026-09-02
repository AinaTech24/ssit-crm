import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { BranchRmMatrix } from "@/components/reports/BranchRmMatrix";
import { rmMatrixBySlug } from "@/lib/business/rm-matrix-config";

export const dynamic = "force-dynamic";

export default async function BranchRmPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind: slug } = await params;
  const meta = rmMatrixBySlug(slug);
  if (!meta) notFound();

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="print:hidden">
        <Link
          href="/dashboard/reports"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"
        >
          <ChevronLeft className="size-3.5" /> Reports &amp; MIS
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{meta.title} — Branch &amp; RM-wise</h1>
        <p className="text-muted-foreground text-sm">
          Per-RM {meta.title} for a branch and month, with an “Outside to our” residual and total —
          computed live from your data.
        </p>
      </div>

      <BranchRmMatrix kind={meta.key} />
    </div>
  );
}
