import Link from "next/link";
import { ChevronLeft, Network } from "lucide-react";
import { DeskManager } from "@/components/settings/DeskManager";

export const dynamic = "force-dynamic";

export default function DesksSettingsPage() {
  return (
    <div className="space-y-4 max-w-4xl">
      <Link
        href="/dashboard/settings"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to settings
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Network className="size-5" /> Desks (sub-branch teams)
        </h1>
        <p className="text-muted-foreground text-sm">
          Group each branch into desks (e.g. DK, RC, 1) and assign every RM to a desk. The monthly
          MIS reports roll up RM → desk → branch → firm.
        </p>
      </div>

      <DeskManager />
    </div>
  );
}
