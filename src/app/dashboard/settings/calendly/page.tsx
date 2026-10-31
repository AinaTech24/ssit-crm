import Link from "next/link";
import { ChevronLeft, CalendarCheck } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { CalendlyCard } from "@/components/integrations/CalendlyCard";

export const dynamic = "force-dynamic";

/**
 * Open to every member (no role gate): each person connects their OWN Calendly,
 * and the API behind it is hard-scoped to the signed-in user.
 */
export default async function CalendlySettingsPage() {
  await requireSession();
  return (
    <div className="space-y-4 max-w-2xl">
      <Link href="/dashboard/settings" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to settings
      </Link>
      <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
        <CalendarCheck className="size-5" /> My Calendly
      </h1>
      <p className="text-sm text-muted-foreground">
        Add your Calendly booking link once. After that, every meeting you schedule in the CRM is booked on your
        Calendly too.
      </p>
      <CalendlyCard />
    </div>
  );
}
