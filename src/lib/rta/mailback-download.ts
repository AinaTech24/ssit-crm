/**
 * Fetch RTA mailback reports that arrive as a DOWNLOAD LINK rather than an
 * attachment.
 *
 * Both registrars switch to a link once the report exceeds some size — CAMS mail
 * carries a `DownloadURL` ending in `.zip` (and shows `Request Status: Link`),
 * KFintech hides it behind a "Click Here" anchor. The poller's original
 * assumption (every mailback carries its ZIP as an attachment) therefore misses
 * exactly the large daily feeds we care about most.
 *
 * SECURITY — this downloads a URL taken from an EMAIL BODY, which is attacker-
 * controllable input, so it is deliberately locked down:
 *   • https only, and the host must match the RTA allowlist below;
 *   • redirects are followed manually and re-checked against the allowlist on
 *     every hop, so an allowlisted host cannot bounce us to an arbitrary one;
 *   • a hard byte cap, streamed, so a hostile endpoint can't exhaust memory;
 *   • the result is only ever treated as DATA (unzipped by the existing import
 *     pipeline) — nothing is executed.
 * A URL that fails any check is skipped and reported, never fetched.
 */

/** Registrar domains we will fetch a report from. Suffix-matched on the host. */
const ALLOWED_HOSTS = ["camsonline.com", "kfintech.com", "karvy.com", "camsonline.in", "kfintech.in"];

/**
 * Cloud-storage buckets the registrars redirect their reports to, matched
 * EXACTLY — never by suffix.
 *
 * KFintech's report link hops
 *   scdelivery.kfintech.com → mfs.kfintech.com/…Req_allrptslink.aspx → S3
 * and only the last hop serves the actual ZIP. Suffix-matching `amazonaws.com`
 * would let ANY bucket through, and these URLs come out of email — i.e. from an
 * untrusted source — so a wildcard here is a server-side request forgery hole
 * that an attacker could open just by registering a bucket. Exact hosts only;
 * add a new one deliberately after tracing where it leads.
 */
const ALLOWED_EXACT_HOSTS = new Set(["kfintech-ac-dss-reports.s3.ap-south-1.amazonaws.com"]);

/** Reports run to tens of MB; well above that is not a report. */
const MAX_BYTES = 120 * 1024 * 1024;
/**
 * Smallest plausible report. Registrar endpoints answer a stale/consumed link
 * with a tiny plain-text body ("Invalid request") and HTTP 200 — which sailed
 * past the HTML guard, got stored, and produced either a bogus "unrecognised
 * format" failure or, worse, a silent 0-row "completed" import.
 */
const MIN_BYTES = 256;
/** A short body that is really an error message, not a report. */
const ERROR_BODY_RE = /^\s*(invalid|error|unauthor|forbidden|expired|access denied|not found|no data|session)/i;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 120_000;

export type RtaDownload = {
  url: string;
  filename: string;
  content: Buffer;
  size: number;
  contentType: string;
};

/** True when `host` is an allowlisted registrar domain, or an exact storage host. */
export function isAllowedRtaHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (ALLOWED_EXACT_HOSTS.has(h)) return true;
  return ALLOWED_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}

function safeUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    if (!isAllowedRtaHost(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

/**
 * Assets that are never the report, however download-y the URL looks.
 *
 * KFintech puts a link to its static fund-code master
 * (`downloads/FUNCODES-PRODCODE.xls`, ~4MB of 17,000 scheme codes) in EVERY
 * mailback mail. It downloads perfectly, so it was being fetched and stored as
 * though it were the requested report — producing bogus imports carrying no
 * client data at all. Anything matched here is never fetched.
 */
const NEVER_A_REPORT =
  /funcodes|prodcode|\.(png|jpe?g|gif|svg|css|js|ico)(\?|$)|\/images?\/|unsubscribe|privacy|contact|\/o\/\?p=/i;

/**
 * KFintech routes every link through a click-tracker,
 * `scdelivery.kfintech.com/c/?u=<dest>&p=…`, where `<dest>` is URL-encoded and
 * then shifted by ONE character (`iuuqt://ngt.lgjoufdi.dpn` → `https://mfs.kfintech.com`).
 *
 * Decoding it is what lets us judge where a link actually goes — otherwise every
 * tracker URL looks identical and the real report is indistinguishable from the
 * fund-code list or a logo.
 */
export function resolveTrackedUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const dest = u.searchParams.get("u");
    if (!dest || dest === "undefined") return raw;
    const decoded = decodeURIComponent(dest).replace(/./g, (c) => String.fromCharCode(c.charCodeAt(0) - 1));
    return /^https?:\/\//i.test(decoded) ? decoded : raw;
  } catch {
    return raw;
  }
}

/**
 * Pull candidate report URLs out of a mail body (plain text + HTML hrefs).
 *
 * Ordered best-first by where each link REALLY goes (after un-wrapping any
 * tracker): a direct file beats a download endpoint, which beats a portal page.
 * Known non-report assets and dead trackers are dropped entirely.
 */
export function extractRtaDownloadLinks(text?: string, html?: string): string[] {
  const found = new Set<string>();

  // Plain-text URLs.
  for (const m of (text ?? "").matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) found.add(m[0]);
  // HTML hrefs (KFintech's "Click Here").
  for (const m of (html ?? "").matchAll(/href\s*=\s*["']([^"']+)["']/gi)) found.add(m[1]);
  // Bare URLs in HTML text nodes (CAMS renders the DownloadURL as visible text).
  for (const m of (html ?? "").matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) found.add(m[0]);

  const cleaned = [...found]
    .map((u) => u.replace(/&amp;/g, "&").replace(/[)\].,;'">]+$/, "").trim())
    .filter((u) => safeUrl(u) !== null)
    // A tracker with no destination (`u=undefined`) is broken by construction —
    // it answers 200 with a short "Invalid request" body.
    .filter((u) => !/[?&]u=undefined(&|$)/i.test(u))
    // Judge the DESTINATION, not the wrapper.
    .filter((u) => !NEVER_A_REPORT.test(resolveTrackedUrl(u)));

  const score = (u: string): number => {
    const s = resolveTrackedUrl(u).toLowerCase();
    if (/\.(zip|csv|txt|xls|xlsx|dbf)(\?|$)/.test(s)) return 0; // direct file
    if (/mailback|download|report|result|rqts|request/.test(s)) return 1; // download endpoint
    if (/\.(aspx|html?|php)(\?|$)/.test(s) || /^https?:\/\/[^/]+\/?$/.test(s)) return 3; // portal page / bare host
    return 2;
  };
  return [...new Set(cleaned)].sort((a, b) => score(a) - score(b));
}

/** Extension implied by the file's magic bytes — ZIP is the one that matters. */
function sniffExtension(buf: Buffer): string {
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07)) {
    return ".zip"; // "PK.." — includes empty/spanned archives
  }
  if (buf.length >= 8 && buf.toString("hex", 0, 8) === "d0cf11e0a1b11ae1") return ".xls"; // OLE2
  return ".csv"; // registrar text feeds are CSV/pipe-delimited
}

/**
 * Derive a filename from Content-Disposition, else the URL path.
 *
 * Always ensures an extension: KFintech's download path ends in an opaque token
 * ("tmcdehmdc") with none at all, and the import pipeline keys off the extension
 * to decide whether to unzip or parse directly — so an extensionless file was
 * handed straight to the parser and failed as "unrecognised format".
 */
function filenameFor(u: URL, contentDisposition: string | null, buf: Buffer): string {
  const cd = contentDisposition?.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i)?.[1];
  const base = cd
    ? decodeURIComponent(cd.trim()).replace(/[/\\]/g, "_")
    : decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
  const name = base || "rta-mailback-download";
  return /\.(zip|csv|txt|xls|xlsx|xlsb|xlsm|dbf)$/i.test(name) ? name : name + sniffExtension(buf);
}

/**
 * Download one report. Returns null (never throws) when the URL isn't allowed,
 * the response isn't a file, or it exceeds the cap — the caller logs the reason
 * and moves on rather than failing the whole message.
 */
export async function fetchRtaDownload(
  rawUrl: string
): Promise<{ ok: true; file: RtaDownload } | { ok: false; reason: string }> {
  let current = safeUrl(rawUrl);
  if (!current) return { ok: false, reason: "URL is not an https link on an approved CAMS/KFintech domain" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      res = await fetch(current.toString(), {
        redirect: "manual", // re-validate every hop against the allowlist
        signal: controller.signal,
        headers: { accept: "*/*", "user-agent": "SSITCRM-RTA-Mailback/1.0" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { ok: false, reason: `redirect ${res.status} without a Location header` };
        const next = safeUrl(new URL(loc, current).toString());
        if (!next) return { ok: false, reason: "redirected off the approved CAMS/KFintech domains — not followed" };
        current = next;
        continue;
      }
      break;
    }
    if (!res) return { ok: false, reason: "no response" };
    if (!res.ok) return { ok: false, reason: `download failed with HTTP ${res.status}` };

    const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
    // A login/portal page means the link needs an authenticated session — we
    // can't fetch it unattended, and saving the HTML would be worse than useless.
    if (/text\/html/.test(ctype)) {
      const dest = resolveTrackedUrl(current.toString());
      const portal = /\.aspx|login|signin/i.test(dest);
      return {
        ok: false,
        reason: portal
          ? "the report link opens a portal page that requires a login, so it cannot be fetched automatically — ask the registrar to deliver this report as an EMAIL ATTACHMENT instead of a download link"
          : "link returned a web page, not a file — download it manually and upload it",
      };
    }
    // Open-tracking pixels answer 200 with a tiny image. Never a report.
    if (/^image\//.test(ctype)) {
      return { ok: false, reason: "link returned an image (a tracking pixel), not a report" };
    }
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared && declared > MAX_BYTES) {
      return { ok: false, reason: `file is ${Math.round(declared / 1048576)}MB, over the ${MAX_BYTES / 1048576}MB cap` };
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) return { ok: false, reason: "file exceeded the size cap while downloading" };
    if (buf.length === 0) return { ok: false, reason: "downloaded file was empty" };

    // Registrars answer a stale or already-consumed link with HTTP 200 and a
    // few bytes of plain text. Storing that as a "report" is worse than failing:
    // it either fails downstream with a confusing parser error or imports zero
    // rows and reports success. Reject it here, where the reason is obvious.
    if (buf.length < MIN_BYTES) {
      const head = buf.toString("utf8", 0, Math.min(buf.length, 200)).trim();
      const why = ERROR_BODY_RE.test(head) ? `the server replied "${head.slice(0, 80)}"` : `only ${buf.length} bytes`;
      return {
        ok: false,
        reason: `link did not return a report — ${why}. The download link may be single-use or expired; fetch it manually and upload.`,
      };
    }

    const filename = filenameFor(current, res.headers.get("content-disposition"), buf);
    return {
      ok: true,
      file: {
        url: current.toString(),
        filename,
        content: buf,
        size: buf.length,
        contentType: ctype || "application/octet-stream",
      },
    };
  } catch (e) {
    const msg = (e as Error)?.name === "AbortError" ? "download timed out" : (e as Error)?.message;
    return { ok: false, reason: `download failed: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}
