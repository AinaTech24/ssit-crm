import { PageSkeleton } from "@/components/common/Skeleton";

/**
 * Dashboard-wide loading UI. Next renders this in the main content pane the
 * instant you navigate to any /dashboard/* route, while its server component
 * fetches data — so the app feels responsive instead of frozen. The persistent
 * layout (sidebar + topbar) stays put; only this inner pane shows the skeleton.
 */
export default function DashboardLoading() {
  return <PageSkeleton />;
}
