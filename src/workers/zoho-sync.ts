/**
 * Zoho sync worker — drains each connected tenant's outbox backlog into their
 * Zoho CRM on a short interval. Self-contained (own cursor), so it can be
 * enabled/disabled independently of the other workers via WORKER_GROUPS.
 */
import { runZohoSyncOnce } from "@/lib/integrations/zoho/sync";
import { captureError } from "@/lib/observability/capture";

export function startZohoSyncWorker(): () => void {
  const interval = Number(process.env.ZOHO_SYNC_INTERVAL_MS ?? 30_000);
  let running = false;
  const tick = async () => {
    if (running) return; // skip if the previous tick is still in flight
    running = true;
    try {
      const { tenants, pushed, failed } = await runZohoSyncOnce();
      if (pushed || failed) console.log(`[zoho-sync] tick: tenants=${tenants} pushed=${pushed} failed=${failed}`);
    } catch (err) {
      captureError("[zoho-sync] tick failed", err);
    } finally {
      running = false;
    }
  };
  void tick();
  const t = setInterval(tick, interval);
  t.unref?.();
  console.log(`[zoho-sync] worker started (every ${Math.round(interval / 1000)}s)`);
  return () => clearInterval(t);
}
