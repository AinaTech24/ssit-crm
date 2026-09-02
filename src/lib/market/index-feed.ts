/**
 * Market-index feed (NIFTY 50 day-change).
 *
 * The `market_volatility_broadcast` recipe wants to fire a "stay invested"
 * message when the market falls sharply — but nothing was emitting that
 * signal. This module is the feed: it reads the current index level + intraday
 * percentage change from a CONFIGURABLE source so the MFD can plug in whatever
 * market-data provider they license, and falls back to a stub for dev/demo.
 *
 * It is deliberately provider-agnostic. A free, no-auth NIFTY quote endpoint
 * that is reliable + ToS-clean does not exist; rather than hard-code a brittle
 * scrape, the owner points `MARKET_INDEX_URL` at their data feed (NSE licensed
 * feed, a broker API, Twelve Data, etc.) and tells us which JSON keys carry the
 * change% and level. The worker logic (threshold, throttle, per-investor fan-out
 * with consent gating) is the real, finished part.
 *
 * Env:
 *   MARKET_INDEX_URL              JSON endpoint returning the index quote.
 *   MARKET_INDEX_CHANGE_KEY       JSON key (dot-path) for the day %-change.   default "changePercent"
 *   MARKET_INDEX_LEVEL_KEY        JSON key (dot-path) for the index level.    default "lastPrice"
 *   MARKET_INDEX_NAME             label for logs/messages.                    default "NIFTY 50"
 *   MARKET_INDEX_STUB_CHANGE_PCT  dev/demo only — forces a change% with no URL.
 *   MARKET_DROP_THRESHOLD_PCT     fire when change% <= this (negative).       default -2
 */

export type IndexQuote = {
  /** Index name, e.g. "NIFTY 50". */
  name: string;
  /** Intraday % change vs previous close (negative = down). */
  changePct: number;
  /** Current index level, if available. */
  level: number | null;
  /** ISO timestamp the quote was read. */
  asOf: string;
};

export const MARKET_INDEX_NAME = process.env.MARKET_INDEX_NAME ?? "NIFTY 50";

export function dropThresholdPct(): number {
  const v = Number(process.env.MARKET_DROP_THRESHOLD_PCT);
  return isFinite(v) ? v : -2;
}

/** Read a dot-path (e.g. "data.0.pChange") out of a parsed JSON object. */
function readPath(obj: any, path: string): unknown {
  return path.split(".").reduce((cur, seg) => (cur == null ? cur : cur[seg]), obj);
}

/**
 * Parse a provider JSON body into an IndexQuote using the configured keys.
 * Pure + synchronous so it's unit-testable without a network call. Returns
 * null when the change% can't be read as a finite number.
 */
export function parseIndexQuote(
  body: any,
  opts?: { changeKey?: string; levelKey?: string; name?: string; asOf?: string }
): IndexQuote | null {
  const changeKey = opts?.changeKey ?? process.env.MARKET_INDEX_CHANGE_KEY ?? "changePercent";
  const levelKey = opts?.levelKey ?? process.env.MARKET_INDEX_LEVEL_KEY ?? "lastPrice";
  const rawChange = readPath(body, changeKey);
  const changePct = Number(rawChange);
  if (!isFinite(changePct)) return null;
  const rawLevel = readPath(body, levelKey);
  const level = isFinite(Number(rawLevel)) ? Number(rawLevel) : null;
  return {
    name: opts?.name ?? MARKET_INDEX_NAME,
    changePct,
    level,
    asOf: opts?.asOf ?? new Date().toISOString(),
  };
}

/**
 * Fetch the current index quote. Live when MARKET_INDEX_URL is set; otherwise a
 * stub (MARKET_INDEX_STUB_CHANGE_PCT) for dev/demo. Returns null when no source
 * is configured — the worker then no-ops (never invents a market move).
 *
 * The `asOf` for the stub is injectable so callers (tests, the worker) stay
 * deterministic; argless `new Date()` is avoided here for that reason.
 */
export async function fetchIndexQuote(asOf: string): Promise<IndexQuote | null> {
  const url = process.env.MARKET_INDEX_URL;
  if (url) {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      // index data is fast-moving — never serve a cached body
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`market-index feed HTTP ${res.status}`);
    }
    const json = await res.json();
    return parseIndexQuote(json, { asOf });
  }

  const stub = process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_PROVIDERS !== "1"
    ? undefined
    : process.env.MARKET_INDEX_STUB_CHANGE_PCT;
  if (stub != null && stub !== "") {
    const changePct = Number(stub);
    if (isFinite(changePct)) {
      return { name: MARKET_INDEX_NAME, changePct, level: null, asOf };
    }
  }
  return null;
}
