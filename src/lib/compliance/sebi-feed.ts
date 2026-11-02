/**
 * Latest SEBI circulars → the Regulatory circular digest.
 *
 * SEBI publishes an RSS feed of everything it issues (circulars, master
 * circulars, press releases, and also enforcement orders and recovery notices,
 * which are of no use to a distributor). This keeps the circulars, master
 * circulars and press releases that concern mutual funds, distributors,
 * advisers, KYC or investors, and stores each as a digest entry that links to
 * the official page.
 *
 * What is stored is only what the feed actually says — title, date and link. The
 * summary is a fixed pointer, never invented text: the plain-English summary of a
 * circular comes from the "Summarise a circular with AI" box on the digest page,
 * which the user runs on the official text.
 */

import { db } from "@/db/client";
import { amfiCirculars } from "@/db/schema";

export const SEBI_FEED_URL = "https://www.sebi.gov.in/sebirss.xml";

export interface SebiFeedItem {
  title: string;
  link: string;
  published: Date | null;
}

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : null;
}

/** Items out of an RSS document. Tolerant: anything without a title and link is skipped. */
export function parseSebiRss(xml: string): SebiFeedItem[] {
  const out: SebiFeedItem[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const title = tag(m[1], "title");
    const link = tag(m[1], "link");
    if (!title || !link) continue;
    const raw = tag(m[1], "pubDate") ?? tag(m[1], "dc:date");
    const d = raw ? new Date(raw) : null;
    out.push({ title, link, published: d && !Number.isNaN(d.getTime()) ? d : null });
  }
  return out;
}

const KIND_BY_PATH: Array<[string, string]> = [
  ["/legal/master-circulars/", "Master circular"],
  ["/legal/circulars/", "Circular"],
  ["/media-and-notifications/press-releases/", "Press release"],
];

/** What the item is, or null for the kinds we do not carry (orders, recovery notices…). */
export function sebiKind(link: string): string | null {
  const hit = KIND_BY_PATH.find(([p]) => link.includes(p));
  return hit ? hit[1] : null;
}

/** Concerns mutual funds, distributors, advisers, KYC or investors in general. */
const RELEVANT =
  /mutual fund|\bAMC\b|asset management|distributor|investment advis|research analyst|portfolio manager|\bPMS\b|\bAIF\b|alternative investment|\bSIF\b|specialised investment|\bKYC\b|nominat|investor|\bSIP\b|\bELSS\b|\bNAV\b|scheme|depositor|\bRTA\b|registrar|transfer agent|demat|stock broker|grievance|\bSCORES\b|cyber|\bARN\b|\bAMFI\b|commission|\bTER\b|expense ratio/i;

export function isRelevantToMfd(item: SebiFeedItem): boolean {
  return sebiKind(item.link) !== null && RELEVANT.test(item.title);
}

const SUMMARY =
  "Latest from SEBI, fetched automatically from its official feed. Open the official source for the full text, " +
  "or paste it into “Summarise a circular with AI” above for a plain-English summary and the action for your firm.";

/** SEBI's own page id, e.g. …_105523.html → "SEBI-105523". Unique per item. */
export function circularNo(link: string): string | null {
  const m = link.match(/_(\d+)\.html/);
  return m ? `SEBI-${m[1]}` : null;
}

let lastAttemptAt = 0;
const MIN_GAP_MS = 6 * 60 * 60 * 1000;

/**
 * Pull the feed and store anything new. Throttled to one attempt per process per
 * six hours, never throws, and returns how many entries were added.
 */
export async function refreshSebiCirculars(opts?: { force?: boolean; fetchFn?: typeof fetch }): Promise<number> {
  if (!opts?.force && Date.now() - lastAttemptAt < MIN_GAP_MS) return 0;
  lastAttemptAt = Date.now();
  try {
    const res = await (opts?.fetchFn ?? fetch)(SEBI_FEED_URL, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; EquitywalaCRM/1.0)", accept: "application/rss+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return 0;
    const items = parseSebiRss(await res.text()).filter(isRelevantToMfd);
    let added = 0;
    for (const it of items) {
      const no = circularNo(it.link);
      if (!no) continue;
      const inserted = await db
        .insert(amfiCirculars)
        .values({
          circularNo: no,
          title: it.title.slice(0, 500),
          issuer: "SEBI",
          category: sebiKind(it.link),
          summary: SUMMARY,
          publishedOn: it.published ? it.published.toISOString().slice(0, 10) : null,
          sourceUrl: it.link,
          severity: "info",
          tags: ["sebi-feed"],
        })
        .onConflictDoNothing({ target: amfiCirculars.circularNo })
        .returning({ id: amfiCirculars.id });
      added += inserted.length;
    }
    return added;
  } catch (e) {
    console.error("[sebi-feed] refresh failed:", (e as Error).message);
    return 0;
  }
}
