/**
 * PM2 process supervisor — keeps BOTH the web app and the background worker
 * alive and auto-restarts them on crash. The worker drives ALL time-based
 * automation (daily-ops scanner, NAV refresh, reconciliation, market scanner,
 * feed ingestion, schedulers). If it isn't supervised, time-based automation
 * silently stops the moment the process dies — which is the single biggest
 * "why did automation stop?" operational trap.
 *
 * Usage:
 *   npm run build
 *   pm2 start ecosystem.config.cjs
 *   pm2 logs            # tail
 *   pm2 save            # persist across reboots
 *   pm2 startup         # generate the boot script (run the printed command)
 *
 * Alternatives (pick one):
 *   • systemd: one unit for `npm run start:prod`, one for `npm run worker:prod`,
 *     both with Restart=always.
 *   • Docker/compose: two services, both `restart: unless-stopped`.
 *
 * The worker is a SINGLE long-lived process with internal timers (no external
 * cron), so `restart`/`autorestart` is what makes the schedule reliable.
 */

module.exports = {
  apps: [
    {
      name: "mfd-web",
      script: "npm",
      args: "run start:prod",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "20s",
      env: { NODE_ENV: "production" },
    },
    {
      name: "mfd-worker",
      script: "npm",
      args: "run worker:prod",
      autorestart: true,
      max_restarts: 20,
      min_uptime: "20s",
      // Split groups across processes at higher load, e.g.:
      //   env: { WORKER_GROUPS: "outbox,wf" }   // one process
      //   env: { WORKER_GROUPS: "sched,ops,nav,recon,market,feed" } // another
      env: { NODE_ENV: "production" },
    },
  ],
};
