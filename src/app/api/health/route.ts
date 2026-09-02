/**
 * GET /api/health
 *   Lightweight liveness + readiness probe. Used by:
 *     - scripts/dev-server.mjs to detect a hung server
 *     - load balancers / uptime monitors in production
 *     - the QA smoke-test script
 *
 *   Returns 200 if the process is responsive AND the DB is reachable.
 *   Returns 503 if the DB query fails.
 *
 *   Intentionally does NOT require a session — uptime probes are
 *   anonymous. RLS is not engaged (we use the raw pool, not withTenant)
 *   because the only query is a trivial `SELECT 1`.
 */

import { NextResponse } from "next/server";
import { pool } from "@/db/client";

export const dynamic = "force-dynamic";

// 3-second hard cap so a hung DB doesn't hold up the health check
const DB_TIMEOUT_MS = 3_000;

// Inlined by Next at build time from next.config's `env` block. Read via
// explicit property access so the replacement actually happens.
const BUILD_SHA = process.env.BUILD_SHA ?? "";
const BUILD_AT = process.env.BUILD_AT ?? "";

export async function GET() {
  const startedAt = Date.now();

  try {
    const dbResult = await withTimeout(
      pool.query("SELECT 1 AS ok").then((r) => r.rows[0]?.ok === 1),
      DB_TIMEOUT_MS,
      "db"
    );
    return NextResponse.json(
      {
        status: "ok",
        // Which build is actually serving. Baked in at build time (next.config)
        // so "has my fix reached production?" is answerable without SSH-ing in.
        build: BUILD_SHA || null,
        builtAt: BUILD_AT || null,
        uptimeSec: Math.round(process.uptime()),
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        db: dbResult ? "ok" : "weird",
        respondedInMs: Date.now() - startedAt,
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        status: "unhealthy",
        error: err?.message ?? String(err),
        respondedInMs: Date.now() - startedAt,
      },
      { status: 503 }
    );
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
    ),
  ]);
}
