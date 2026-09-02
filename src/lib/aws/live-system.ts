/**
 * Live host system metrics — read straight from /proc (which, in standard
 * Docker, reflects the HOST), so the dashboard can refresh every second with
 * REAL-TIME numbers. CloudWatch is 1–5 min granularity and can't do this.
 *
 * CPU% and network rate are sampled over a ~250ms window per request.
 */
import * as fs from "fs";
import os from "os";

const readFileSync = fs.readFileSync;

function readCpuSnapshot(): { idle: number; total: number } {
  const first = readFileSync("/proc/stat", "utf8").split("\n")[0];
  const nums = first.trim().split(/\s+/).slice(1).map(Number); // user nice system idle iowait irq softirq steal …
  const idle = (nums[3] || 0) + (nums[4] || 0); // idle + iowait
  const total = nums.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  return { idle, total };
}

function readNetTotals(): { rx: number; tx: number } {
  try {
    const lines = readFileSync("/proc/net/dev", "utf8").split("\n").slice(2);
    let rx = 0, tx = 0;
    for (const ln of lines) {
      const [iface, rest] = ln.split(":");
      if (!rest || /\blo\b/.test(iface)) continue; // skip loopback
      const f = rest.trim().split(/\s+/).map(Number);
      rx += f[0] || 0; // bytes received
      tx += f[8] || 0; // bytes transmitted
    }
    return { rx, tx };
  } catch {
    return { rx: 0, tx: 0 };
  }
}

function parseMeminfo(): Record<string, number> {
  const out: Record<string, number> = {};
  try {
    for (const ln of readFileSync("/proc/meminfo", "utf8").split("\n")) {
      const m = ln.match(/^(\w+):\s+(\d+)/);
      if (m) out[m[1]] = Number(m[2]) * 1024; // kB → bytes
    }
  } catch {
    /* leave empty */
  }
  return out;
}

export type LiveSystem = {
  t: number;
  hostname: string;
  cpu: { pct: number | null; cores: number };
  load: { l1: number; l5: number; l15: number } | null;
  mem: { total: number; used: number; available: number; free: number; usedPct: number } | null;
  swap: { total: number; used: number; usedPct: number } | null;
  disk: { total: number; used: number; free: number; usedPct: number } | null;
  net: { rxBytesPerSec: number; txBytesPerSec: number } | null;
  uptimeSec: number | null;
  procs: number | null;
};

export async function getLiveSystem(): Promise<LiveSystem> {
  // Sample CPU + network across a short window.
  const c1 = readCpuSnapshot();
  const n1 = readNetTotals();
  const startedAt = Date.now();
  await new Promise((r) => setTimeout(r, 250));
  const c2 = readCpuSnapshot();
  const n2 = readNetTotals();
  const elapsed = (Date.now() - startedAt) / 1000;

  const dTotal = c2.total - c1.total;
  const dIdle = c2.idle - c1.idle;
  const cpuPct = dTotal > 0 ? Math.max(0, Math.min(100, (1 - dIdle / dTotal) * 100)) : null;

  const mi = parseMeminfo();
  const memTotal = mi.MemTotal || 0;
  const memAvail = mi.MemAvailable ?? mi.MemFree ?? 0;
  const mem = memTotal
    ? { total: memTotal, used: memTotal - memAvail, available: memAvail, free: mi.MemFree || 0, usedPct: Math.round(((memTotal - memAvail) / memTotal) * 100) }
    : null;
  const swapTotal = mi.SwapTotal || 0;
  const swapFree = mi.SwapFree || 0;
  const swap = swapTotal ? { total: swapTotal, used: swapTotal - swapFree, usedPct: Math.round(((swapTotal - swapFree) / swapTotal) * 100) } : null;

  let load: LiveSystem["load"] = null;
  let procs: number | null = null;
  try {
    const la = readFileSync("/proc/loadavg", "utf8").trim().split(/\s+/);
    load = { l1: Number(la[0]), l5: Number(la[1]), l15: Number(la[2]) };
    const pr = la[3]?.split("/"); // running/total
    procs = pr && pr[1] ? Number(pr[1]) : null;
  } catch {
    /* leave null */
  }

  let uptimeSec: number | null = null;
  try {
    uptimeSec = Math.round(Number(readFileSync("/proc/uptime", "utf8").split(/\s+/)[0]));
  } catch {
    /* leave null */
  }

  let disk: LiveSystem["disk"] = null;
  try {
    const statfs = (fs as any).statfsSync as undefined | ((p: string) => any);
    if (statfs) {
      const s = statfs("/");
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      const used = total - s.bfree * s.bsize;
      disk = { total, free, used, usedPct: total ? Math.round((used / total) * 100) : 0 };
    }
  } catch {
    /* statfs unavailable */
  }

  const net = elapsed > 0 ? { rxBytesPerSec: Math.max(0, (n2.rx - n1.rx) / elapsed), txBytesPerSec: Math.max(0, (n2.tx - n1.tx) / elapsed) } : null;

  return {
    t: Date.now(),
    hostname: os.hostname(),
    cpu: { pct: cpuPct, cores: os.cpus().length },
    load,
    mem,
    swap,
    disk,
    net,
    uptimeSec,
    procs,
  };
}
