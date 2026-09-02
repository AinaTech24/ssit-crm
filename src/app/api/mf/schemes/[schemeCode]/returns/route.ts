import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/mf/schemes/[schemeCode]/returns
 *
 * Trailing point-to-point returns for a scheme, computed live from the full
 * mfapi.in NAV history. Periods < 1y are absolute; ≥ 1y are annualised (CAGR).
 * Used to auto-fill the Review of Investments calculator from a picked scheme.
 *
 *   → { schemeCode, schemeName, amc, latestNav, navDate,
 *       returns: { m1, m3, m6, y1, y3, y5, si } }   // % or null
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { fetchMfApiScheme, parseMfApiDate } from "@/lib/finance/mfapi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Pt = { t: number; nav: number }; // t = epoch ms

const DAY = 86400000;

/** NAV at the point on or immediately before `targetMs` (closest older). */
function navAtOrBefore(points: Pt[], targetMs: number): number | null {
  // points sorted ascending by time
  let best: Pt | null = null;
  for (const p of points) {
    if (p.t <= targetMs) best = p;
    else break;
  }
  // If target is older than the earliest point, no value.
  return best ? best.nav : null;
}

function trailing(points: Pt[], latest: Pt, days: number): number | null {
  const past = navAtOrBefore(points, latest.t - days * DAY);
  if (past == null || past <= 0) return null;
  const growth = latest.nav / past;
  const years = days / 365;
  const ret = years >= 1 ? Math.pow(growth, 1 / years) - 1 : growth - 1;
  return ret * 100;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ schemeCode: string }> }) {
  const { schemeCode } = await params;
  try {
    await requireSession();
    const code = String(schemeCode).replace(/[^0-9A-Za-z]/g, "").slice(0, 20);
    if (!code) return NextResponse.json({ error: "invalid scheme code" }, { status: 400 });

    const s = await fetchMfApiScheme(code).catch(() => null);
    if (!s || !Array.isArray(s.data) || s.data.length === 0) {
      return NextResponse.json({ error: "no NAV history" }, { status: 404 });
    }

    const points: Pt[] = s.data
      .map((p) => {
        const iso = parseMfApiDate(p.date);
        const nav = Number(p.nav);
        return iso && Number.isFinite(nav) ? { t: new Date(iso).getTime(), nav } : null;
      })
      .filter((p): p is Pt => !!p)
      .sort((a, b) => a.t - b.t);

    if (points.length < 2) return NextResponse.json({ error: "insufficient history" }, { status: 404 });

    const latest = points[points.length - 1];
    const earliest = points[0];
    const siYears = (latest.t - earliest.t) / (365 * DAY);
    const siReturn = earliest.nav > 0 && siYears > 0
      ? (Math.pow(latest.nav / earliest.nav, 1 / siYears) - 1) * 100
      : null;

    return NextResponse.json({
      schemeCode: code,
      schemeName: s.meta?.scheme_name ?? code,
      amc: s.meta?.fund_house ?? null,
      category: s.meta?.scheme_category ?? null,
      latestNav: latest.nav,
      navDate: new Date(latest.t).toISOString().slice(0, 10),
      returns: {
        m1: trailing(points, latest, 30),
        m3: trailing(points, latest, 91),
        m6: trailing(points, latest, 182),
        y1: trailing(points, latest, 365),
        y3: trailing(points, latest, 1095),
        y5: trailing(points, latest, 1825),
        si: siReturn,
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
