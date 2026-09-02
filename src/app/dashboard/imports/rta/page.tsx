/**
 * Legacy standalone RTA import page — CONSOLIDATED.
 *
 * There used to be two RTA importers (this rich master/holdings page, and the
 * feed dashboard at /dashboard/rta-imports), which confused users. They're now
 * ONE: /dashboard/rta-imports handles every file kind and routes master/holdings
 * uploads to the rich engine (client creation + ISIN-resolved AMC/scheme names)
 * under the hood. This route just redirects there so old links keep working.
 */

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function RtaImportRedirect() {
  redirect("/dashboard/rta-imports");
}
