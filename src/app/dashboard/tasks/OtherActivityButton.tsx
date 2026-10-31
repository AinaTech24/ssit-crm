/**
 * "Other activity" — logs day-to-day work that isn't a client task. It opens the
 * full New task form in activity mode; the kind (bank work, AMC work, BA service,
 * other) is picked from the dropdown in the form's Title field. Saved as a task
 * of type `other_activity` and listed under Tasks → Other activity.
 */

import Link from "next/link";
import { Briefcase } from "lucide-react";

export function OtherActivityButton() {
  return (
    <Link
      href="/dashboard/tasks/new?activity=bank_work"
      className="rounded-md border px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 hover:bg-accent"
    >
      <Briefcase className="size-4" /> Other activity
    </Link>
  );
}
