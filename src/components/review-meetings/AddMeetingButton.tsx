"use client";

/**
 * "Add Meeting" button — a single primary action that routes straight to the
 * schedule form (the meeting type is chosen there). The old type-picker dropdown
 * was removed.
 */

import Link from "next/link";
import { Plus } from "lucide-react";

export function AddMeetingButton() {
  return (
    <Link href="/dashboard/review-meetings/new" className="btn-primary">
      <Plus className="size-4" /> Add Meeting
    </Link>
  );
}
