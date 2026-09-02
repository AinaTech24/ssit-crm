#!/usr/bin/env node
/**
 * Self-healing dev-server wrapper.
 *
 * Why this exists: `next dev` on Windows accumulates HMR-cached modules
 * indefinitely. After a few hours of edit-save cycles the Node process
 * sits at 8-12 GB resident and the OS starts page-thrashing. The TCP
 * socket on :3000 stays open but the event loop is starved, so every
 * request hangs at "loading". We've hit this six times in a single
 * session.
 *
 * This wrapper:
 *
 *   1. Bounds the heap (`--max-old-space-size`, default 3 GB). When Next
 *      crosses that, V8 OOM-crashes the process *cleanly* instead of
 *      living in the swap zone for 30 minutes. 3 GB (was 2 GB) gives the
 *      heavy dashboard route enough headroom to finish its first Turbopack
 *      compile without OOM-ing mid-build. Override with NEXT_HEAP_MB.
 *
 *   2. Kills any stale process holding port 3000 before starting,
 *      so a half-dead previous instance doesn't block the new one.
 *
 *   3. Polls `/api/health` after start; if no 200 within the health
 *      timeout (default 240 s), restarts. The window is generous because a
 *      cold compile of the largest route can saturate the event loop for
 *      a minute+ — a tighter timeout was killing valid-but-slow compiles
 *      and looping. Override with NEXT_HEALTH_TIMEOUT_MS.
 *
 *   4. Auto-restarts on crash up to MAX_RESTARTS within a window. If
 *      the process keeps crashing, gives up with a loud diagnostic so
 *      we know it's a real bug, not memory creep.
 *
 *   5. On Ctrl-C, forwards SIGINT once, then SIGKILL if Next ignores it.
 *
 * Result: a dev server that recovers itself the way prod does, without
 * a human killing PIDs every other hour.
 *
 * For production / end-user delivery use `npm run start:prod` instead —
 * `next start` doesn't have HMR memory creep at all, so none of this
 * is needed there.
 */

import { spawn, execSync } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PORT = Number(process.env.PORT ?? 3000);
const HEAP_MB = Number(process.env.NEXT_HEAP_MB ?? 3072);
const HEALTH_PATH = "/api/health";
const HEALTH_TIMEOUT_MS = Number(process.env.NEXT_HEALTH_TIMEOUT_MS ?? 240_000);
const HEALTH_INTERVAL_MS = 2_000;
const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 5 * 60_000; // 5 minutes

const restarts = [];

function log(msg) {
  process.stdout.write(`[dev-server] ${msg}\n`);
}

function err(msg) {
  process.stderr.write(`[dev-server] ${msg}\n`);
}

/** Kill any process listening on PORT — Windows-aware. */
function freePort(port) {
  try {
    if (process.platform === "win32") {
      const out = execSync(`netstat -ano | findstr :${port}`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(/LISTENING\s+(\d+)/);
        if (m) pids.add(m[1]);
      }
      for (const pid of pids) {
        log(`port ${port} held by PID ${pid} — killing`);
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
        } catch {}
      }
    } else {
      const out = execSync(`lsof -ti tcp:${port}`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (out) {
        for (const pid of out.split(/\r?\n/)) {
          log(`port ${port} held by PID ${pid} — killing`);
          try {
            execSync(`kill -9 ${pid}`, { stdio: "ignore" });
          } catch {}
        }
      }
    }
  } catch {
    // Nobody on the port — that's fine.
  }
}

/** Poll /api/health until it returns 200, or timeout. */
function waitForHealthy() {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const req = http.get(
        { hostname: "127.0.0.1", port: PORT, path: HEALTH_PATH, timeout: 5_000 },
        (res) => {
          if (res.statusCode === 200) {
            log(`healthy at ${HEALTH_PATH} (${Math.round((Date.now() - startedAt) / 1000)}s)`);
            res.resume();
            return resolve(true);
          }
          res.resume();
          retry();
        }
      );
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - startedAt > HEALTH_TIMEOUT_MS) {
        err(`server didn't become healthy in ${HEALTH_TIMEOUT_MS / 1000}s — will restart`);
        return resolve(false);
      }
      setTimeout(tick, HEALTH_INTERVAL_MS);
    };
    tick();
  });
}

function spawnNext() {
  // Trim restart history outside the window
  const cutoff = Date.now() - RESTART_WINDOW_MS;
  while (restarts.length && restarts[0] < cutoff) restarts.shift();

  if (restarts.length >= MAX_RESTARTS) {
    err(`crashed ${restarts.length}× in ${RESTART_WINDOW_MS / 60_000} min — something's wrong.`);
    err(`don't auto-restart again. Read the output above and fix the real bug.`);
    process.exit(1);
  }
  restarts.push(Date.now());

  freePort(PORT);

  const nextBin = process.platform === "win32" ? "next.cmd" : "next";
  // Turbopack compiles routes on-demand DRAMATICALLY faster than webpack — the
  // reason dev navigation felt slow is that webpack recompiled each route on
  // its first visit (login, then dashboard, then every sidebar page). Turbopack
  // also uses far less Node heap, which is the very reason this wrapper exists.
  // Opt out with NO_TURBO=1 if a rare webpack-only loader ever isn't supported.
  const useTurbo = process.env.NO_TURBO !== "1";
  const devArgs = useTurbo ? ["dev", "--turbopack", "-p", String(PORT)] : ["dev", "-p", String(PORT)];
  log(`starting next dev (${useTurbo ? "turbopack" : "webpack"}, heap=${HEAP_MB}MB, port=${PORT}, restart #${restarts.length})`);

  const child = spawn(nextBin, devArgs, {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS ?? "", `--max-old-space-size=${HEAP_MB}`]
        .filter(Boolean)
        .join(" "),
      PORT: String(PORT),
    },
    shell: process.platform === "win32",
  });

  let killing = false;
  function forwardSignal(sig) {
    if (killing) {
      log(`got ${sig} again — force-killing`);
      try {
        process.kill(child.pid, "SIGKILL");
      } catch {}
      process.exit(1);
    }
    killing = true;
    log(`got ${sig} — forwarding to next dev (Ctrl-C again to force)`);
    try {
      child.kill(sig);
    } catch {}
  }
  process.once("SIGINT", () => forwardSignal("SIGINT"));
  process.once("SIGTERM", () => forwardSignal("SIGTERM"));

  child.on("exit", async (code, signal) => {
    if (killing) {
      process.exit(code ?? 0);
    }
    err(`next dev exited (code=${code} signal=${signal}) — restarting`);
    // Small backoff so we don't tight-loop on a parse error
    await new Promise((r) => setTimeout(r, 1_000));
    spawnNext();
  });

  // Background: health-check. A slow FIRST compile of a heavy route can blow
  // past the health window without the server being truly wedged — killing it
  // there just restarts the compile from scratch and loops forever. So we only
  // WARN on a slow health check. A process that actually crashed still restarts
  // via the `exit` handler above; this only stops us from murdering a
  // valid-but-still-compiling server.
  waitForHealthy().then((ok) => {
    if (!ok && !killing) {
      err(`still not healthy after ${HEALTH_TIMEOUT_MS / 1000}s — leaving it to finish compiling (no force-restart)`);
    }
  });
}

spawnNext();
