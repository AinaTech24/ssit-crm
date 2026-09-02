import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { MetricStatusBoard } from "@/components/reports/MetricStatusBoard";
import { metricBySlug } from "@/lib/finance/metric-config";

export const dynamic = "force-dynamic";

export default async function MetricStatusPage({
  params,
}: {
  params: Promise<{ metric: string }>;
}) {
  const { metric: slug } = await params;
  const meta = metricBySlug(slug);
  if (!meta) notFound();

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="print:hidden">
        <Link
          href="/dashboard/reports"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"
        >
          <ChevronLeft className="size-3.5" /> Reports &amp; MIS
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{meta.title} — Branch-wise</h1>
        <p className="text-muted-foreground text-sm">
          Month-end {meta.label} by branch and external source, with FY target achievement and
          month-on-month movement — the figures your monthly review needs.
        </p>
      </div>

      <MetricStatusBoard metricKey={meta.key} />
    </div>
  );
}
