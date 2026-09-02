import { redirect } from "next/navigation";

/**
 * Root route. The public marketing landing page was removed — SSIT CRM is a
 * private application, so `/` sends every visitor straight to the login screen.
 * Middleware forwards an already-authenticated visitor on to their console.
 */
export default function RootPage() {
  redirect("/login");
}
