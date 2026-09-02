/**
 * Worker process entry point. Run via `npm run worker`.
 *
 * Starts every background worker in a single Node process. In production
 * with higher load, split into multiple processes by passing
 * `WORKER_GROUPS=outbox,wf,seg` etc.
 */

import "dotenv/config";
import { startOutboxPollerWorker } from "./outbox-poller";
import { startWorkflowRunnerWorker } from "./workflow-runner";
import { startSegmentMaterializerWorker } from "./segment-materializer";
import { startMasterSchedulerWorker } from "./master-scheduler";
import { startWorkflowRulesSchedulerWorker } from "./workflow-rules-scheduler";
import { startWorkflowRulesTimeScannerWorker } from "./workflow-rules-time-scanner";
import { startBlueprintSLAWorker } from "./blueprint-sla-worker";
import { startScheduledCommsWorker } from "./scheduled-comms";
import { startReportSchedulerWorker } from "./report-scheduler";
import { startTaskReminderScannerWorker } from "./task-reminder-scanner";
import { startVartifyTemplateSyncWorker } from "./vartify-template-sync";
import { startCampaignDispatcherWorker } from "./campaign-dispatcher";
import { startImapPollerWorker } from "./imap-poller";
import { startRtaInboxPollerWorker } from "./rta-inbox-poller";
import { startZohoSyncWorker } from "./zoho-sync";
import { startRtaImportWorker } from "./rta-import-worker";
import { startDailyBriefingWorker } from "./daily-briefing";
import { startWeeklyDigestWorker } from "./weekly-digest";
import { runDailyOpsScan } from "./daily-ops-scanner";
import { runMonthlyComplianceSweep } from "./monthly-compliance-seeder";
import { runReconciliationScan } from "./reconciliation-scanner";
import { runHoldingsReconciliation } from "./reconciliation-holdings";
import { runMarketScan } from "./market-scanner";
import { runFeedIngest } from "./feed-ingest";
import { runStatementScheduler } from "./statement-scheduler";
import { refreshNav } from "@/lib/finance/nav-feed";
import { syncMfSchemeCatalog, enrichMfSchemes } from "@/lib/finance/mfapi";
import { getLastRun, recordRun } from "./scheduler-state";
import { recordDailySnapshots } from "./firm-snapshot-recorder";
import { runDscReminder } from "./dsc-reminder";
import { runReviewDueReminder } from "./review-due-reminder";
import { captureError } from "@/lib/observability/capture";

const groups = (process.env.WORKER_GROUPS ?? "outbox,wf,seg,sched,wa_sync,mail,ops,monthly,nav,recon,market,feed,statements,zoho,rta,briefing")
  .split(",")
  .map((s) => s.trim());
// 'sched' covers the scheduled-comms drain too (kept with the other schedulers).

const stops: Array<() => void> = [];

/**
 * Schedule a once-a-day fixed-time job with MISSED-RUN CATCH-UP + run recording.
 *
 * On boot, if today's scheduled time already passed and the job's last recorded
 * run predates it (process was down at that moment), it runs immediately instead
 * of silently skipping the day. Every run records a watermark + heartbeat in
 * `scheduler_state` so a readiness probe can tell automation is alive.
 */
function scheduleDaily(
  group: string,
  jobName: string,
  hour: number,
  minute: number,
  fn: () => Promise<unknown>,
  bootEnv?: string
) {
  if (!groups.includes(group)) return;

  const run = async (reason: string) => {
    try {
      await fn();
      await recordRun(jobName, "ok", reason);
    } catch (err) {
      captureError(`[${jobName}] ${reason} run failed`, err);
      await recordRun(jobName, "error", (err as Error)?.message);
    }
  };

  // Missed-run catch-up.
  void (async () => {
    const now = new Date();
    const scheduledToday = new Date(now);
    scheduledToday.setHours(hour, minute, 0, 0);
    if (now >= scheduledToday) {
      const last = await getLastRun(jobName);
      if (!last || last < scheduledToday) {
        console.log(`[${jobName}] missed today's ${hour}:${String(minute).padStart(2, "0")} run — catching up now`);
        await run("catchup");
      }
    }
    if (bootEnv && process.env[bootEnv] === "1") await run("boot");
  })();

  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delayMs = next.getTime() - now.getTime();
    const t = setTimeout(async () => {
      await run("scheduled");
      scheduleNext();
    }, delayMs);
    t.unref?.();
    stops.push(() => clearTimeout(t));
    console.log(`[${jobName}] next run at ${next.toISOString()} (in ${Math.round(delayMs / 60000)} min)`);
  };
  scheduleNext();
}

if (groups.includes("outbox")) stops.push(startOutboxPollerWorker());
if (groups.includes("wf")) stops.push(startWorkflowRunnerWorker());
if (groups.includes("seg")) stops.push(startSegmentMaterializerWorker());
if (groups.includes("sched")) {
  stops.push(startMasterSchedulerWorker());
  stops.push(startWorkflowRulesSchedulerWorker());
  stops.push(startWorkflowRulesTimeScannerWorker());
  stops.push(startBlueprintSLAWorker());
  stops.push(startScheduledCommsWorker());
  stops.push(startCampaignDispatcherWorker());
  stops.push(startReportSchedulerWorker());
  // Task due-date/reminder sweep — fires overdue alerts (previously never
  // triggered) + per-task reminders every 5 min.
  stops.push(startTaskReminderScannerWorker());
}
if (groups.includes("wa_sync")) stops.push(startVartifyTemplateSyncWorker());
if (groups.includes("mail")) {
  stops.push(startImapPollerWorker());
  // Direct RTA mailback auto-import: polls the catch-all inbox MFDs forward to.
  stops.push(startRtaInboxPollerWorker());
}
if (groups.includes("zoho")) stops.push(startZohoSyncWorker());
if (groups.includes("rta")) {
  stops.push(startRtaImportWorker());
  // FP mailback import shares the "rta" worker group (same import surface).
}
// Morning briefing — 8 AM IST digest (in-app + email) per RM/owner. The worker
// computes the IST window itself (server clock is UTC) and dedupes per day, so
// a plain interval registration is correct here (not scheduleDaily/local-time).
if (groups.includes("briefing")) {
  stops.push(startDailyBriefingWorker());
  // Monday "your firm this week" digest for owners/branch heads (9 AM IST).
  stops.push(startWeeklyDigestWorker());
}

/**
 * Daily ops scanner — fires once a day at 06:30 local time. Scans every
 * tenant for birthdays / anniversaries / minor-to-major / dormancy /
 * KYC + risk-profile expiry and emits events the recipes consume.
 *
 * Why not in master-scheduler: the scanner is a single sweep, not a
 * per-trigger fire. Wiring it through workflow_triggers would create
 * one trigger per tenant. A self-scheduled tick is cheaper and easier
 * to reason about.
 */
scheduleDaily("ops", "daily-ops-scanner", 6, 30, runDailyOpsScan, "DAILY_OPS_ON_BOOT");

/**
 * Daily firm snapshot — records each tenant's AUM / clients / SIP book at 00:05
 * local, powering the copilot's AUM/SIP trend. Scheduled early so the missed-run
 * catch-up in scheduleDaily seeds the very first data point immediately on the
 * deploy that ships this (00:05 has already passed on any normal-hours deploy).
 */
scheduleDaily("ops", "daily-firm-snapshot", 0, 5, recordDailySnapshots, "FIRM_SNAPSHOT_ON_BOOT");

/**
 * DDQ 4.26 — annual Declaration of Self-Certification. Checked daily at 07:00
 * (cheap: it no-ops the moment the FY's DSC is recorded) so the reminder lands
 * as soon as the new financial year opens and stays until the DSC is filed.
 */
scheduleDaily("ops", "dsc-reminder", 7, 0, runDscReminder, "DSC_REMINDER_ON_BOOT");

/**
 * Client review-due reminder — raises a task (7-day lead) AND an in-app bell
 * alert on the due date for each client whose review cadence falls due.
 * Cadence-agnostic: it covers the presets AND a custom "every N days"
 * schedule such as every 100 days.
 *
 * Hourly, not daily, and once on boot: an RM who logs a review today expects
 * the reminder to appear when it comes due, not up to 24h later. Both the task
 * and the notification are idempotent on (client, due date), so a re-run inside
 * the same day is a no-op — the extra ticks cost one indexed query per tenant.
 */
if (groups.includes("ops")) {
  const tick = async () => {
    try {
      await runReviewDueReminder();
    } catch (err) {
      console.error("[review-due] tick failed:", (err as Error).message);
    }
  };
  const interval = setInterval(tick, 60 * 60 * 1000); // hourly
  interval.unref?.();
  stops.push(() => clearInterval(interval));
  void tick();
  console.log("[review-due] armed (hourly + on boot)");
}

/**
 * Monthly compliance checklist — seeds the standard SEBI-flavoured tasks
 * to every active tenant on the 1st of each month at 06:00. Hourly tick
 * is cheap; we no-op unless it's actually the 1st and we haven't run
 * already in this calendar month.
 */
if (groups.includes("monthly")) {
  let lastRunYearMonth = ""; // YYYY-MM of last run
  const tick = async () => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    // Only fire on the 1st of the month and at most once per calendar month.
    if (now.getDate() === 1 && ym !== lastRunYearMonth) {
      try {
        await runMonthlyComplianceSweep();
        lastRunYearMonth = ym;
      } catch (err) {
        console.error("[monthly-compliance] sweep failed:", err);
      }
    }
  };
  // Once on boot if requested.
  if (process.env.MONTHLY_COMPLIANCE_ON_BOOT === "1") {
    void runMonthlyComplianceSweep();
  }
  const interval = setInterval(tick, 60 * 60 * 1000); // hourly
  interval.unref?.();
  stops.push(() => clearInterval(interval));
  console.log("[monthly-compliance] hourly check armed — fires on 1st of each month");
}

/**
 * Daily NAV refresh — downloads the AMFI NAVAll feed once a day at 07:00 local
 * time (after the prior day's NAVs are published) and upserts scheme_nav. This
 * is what keeps live portfolio valuation + XIRR current. Self-scheduled tick,
 * same rationale as the daily-ops scanner (single sweep, not per-tenant).
 */
scheduleDaily(
  "nav",
  "nav-refresh",
  7,
  0,
  async () => {
    const r = await refreshNav();
    console.log(`[nav-refresh] upserted ${r.written} schemes (nav date ~${r.navDate})`);
  },
  "NAV_REFRESH_ON_BOOT"
);

/**
 * Daily MF scheme catalog sync — pulls the full scheme list from mfapi.in at
 * 06:30 (before the AMFI NAV refresh) and progressively enriches scheme detail
 * (fund house / type / category / latest NAV). Platform-shared (mf_schemes),
 * so every MFD tenant gets the same up-to-date scheme + AMC + NAV catalog,
 * which powers the scheme/AMC autocomplete. Lives in the "nav" group.
 */
scheduleDaily(
  "nav",
  "mfapi-catalog",
  6,
  30,
  async () => {
    const c = await syncMfSchemeCatalog();
    const e = await enrichMfSchemes(1500);
    console.log(`[mfapi-catalog] upserted ${c.written}/${c.fetched} schemes; enriched ${e.updated}/${e.scanned}`);
  },
  "MFAPI_SYNC_ON_BOOT"
);

/**
 * Reconciliation scanner — fires once a day at 07:30 local (after the 07:00
 * NAV refresh). Turns newly-ingested RTA transactions (redemptions, SIP
 * bounces) into automation events so the recipes chase them hands-off, and
 * reports AUM drift. Self-scheduled tick, same rationale as the ops scanner.
 */
scheduleDaily(
  "recon",
  "reconciliation-scanner",
  7,
  30,
  async () => {
    await runReconciliationScan();
    // Three-way holdings reconciliation right after — reconciles the freshly
    // ingested feed against the CRM ledger + live NAV and writes exceptions.
    await runHoldingsReconciliation();
  },
  "RECON_ON_BOOT"
);

/**
 * Market scanner — ticks hourly. Reads the configured index feed and, on a
 * qualifying NIFTY drop, fans out one `market.nifty_drop` event per
 * marketing-opted-in investor (the market_volatility_broadcast recipe consumes
 * it). No-ops when no index feed is configured. The per-day dedup index makes
 * the hourly cadence safe (at most one nudge per client per drop day).
 */
if (groups.includes("market")) {
  const tick = async () => {
    try {
      const r = await runMarketScan();
      if (r.qualified) {
        console.log(
          `[market-scanner] drop ${r.changePct}% ≤ ${r.thresholdPct}% — emitted ${r.emitted} nudge(s)`
        );
      }
    } catch (err) {
      console.error("[market-scanner] tick failed:", (err as Error).message);
    }
  };
  const interval = setInterval(tick, 60 * 60 * 1000); // hourly
  interval.unref?.();
  stops.push(() => clearInterval(interval));
  if (process.env.MARKET_SCAN_ON_BOOT === "1") void tick();
  console.log("[market-scanner] hourly market-drop watch armed");
}

/**
 * Live CAMS/KFin feed ingestion — polls the RTA drop folder every 15 minutes
 * and runs new files through the processor. No-ops when RTA_FEED_DIR is unset.
 * RTAs deliver daily; the short poll just means files are picked up promptly.
 */
if (groups.includes("feed")) {
  const tick = async () => {
    try {
      const r = await runFeedIngest();
      if (r.enabled && r.filesFound > 0) {
        console.log(`[feed-ingest] ${r.filesIngested} ingested, ${r.filesFailed} failed of ${r.filesFound} file(s)`);
      }
    } catch (err) {
      console.error("[feed-ingest] tick failed:", (err as Error).message);
    }
  };
  const interval = setInterval(tick, 15 * 60 * 1000); // every 15 min
  interval.unref?.();
  stops.push(() => clearInterval(interval));
  if (process.env.FEED_INGEST_ON_BOOT === "1") void tick();
  console.log("[feed-ingest] RTA drop-folder watch armed (15 min)");
}

/**
 * Scheduled auto-statements — once a day at 08:00 local, emails the live PDF
 * statement to every client whose cadence (monthly/quarterly) is due. The
 * per-period watermark means it sends each client at most once per period.
 */
scheduleDaily(
  "statements",
  "statement-scheduler",
  8,
  0,
  async () => {
    const r = await runStatementScheduler();
    if (r.sent > 0) console.log(`[statement-scheduler] sent ${r.sent} auto-statement(s)`);
  },
  "STATEMENTS_ON_BOOT"
);

// Last-resort safety net: a floating rejection or uncaught exception in any
// tick must NOT silently crash the whole worker (taking down every automation).
// Log + report; keep the process alive so PM2 doesn't churn-restart and lose a
// fixed-time window. A truly fatal error still surfaces loudly via captureError.
process.on("unhandledRejection", (reason) => {
  captureError("[worker] unhandledRejection", reason);
});
process.on("uncaughtException", (err) => {
  captureError("[worker] uncaughtException", err);
});

console.log(`✓ Worker process up. Groups: ${groups.join(", ")}`);

const shutdown = async () => {
  console.log("Shutting down workers...");
  for (const stop of stops) {
    try {
      stop();
    } catch {}
  }
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
