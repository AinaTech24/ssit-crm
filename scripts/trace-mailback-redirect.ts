/**
 * Trace where a registrar report link actually leads: un-wrap the click tracker,
 * then follow redirects one hop at a time and report each host + content-type.
 *
 * Diagnostic only — it never writes the body anywhere. The point is to learn
 * whether a refused redirect lands on a legitimate registrar CDN (which we could
 * allowlist) or somewhere unrelated (which must stay refused).
 *
 *   npx tsx scripts/trace-mailback-redirect.ts [kfintech|cams] [count]
 */
import "dotenv/config";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { loadRtaInboxConfig } from "@/lib/rta/inbox-config";
import { extractRtaDownloadLinks, resolveTrackedUrl, isAllowedRtaHost } from "@/lib/rta/mailback-download";

const NEEDLE = (process.argv[2] ?? "kfintech").toLowerCase();
const COUNT = Number(process.argv[3] ?? 1);
const MAX_HOPS = 6;

async function trace(url: string) {
  let current = url;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let res: Response;
    try {
      res = await fetch(current, { redirect: "manual", headers: { accept: "*/*" } });
    } catch (e: any) {
      console.log(`      hop ${hop}: FETCH FAILED ${String(e?.message).slice(0, 60)}`);
      return;
    }
    const host = new URL(current).hostname;
    const allowed = isAllowedRtaHost(host) ? "ALLOWED" : "NOT-ALLOWED";
    const ctype = res.headers.get("content-type") ?? "?";
    const len = res.headers.get("content-length") ?? "?";
    console.log(`      hop ${hop}: ${res.status} ${host} [${allowed}] type=${ctype.slice(0, 40)} len=${len}`);
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString();
      console.log(`              -> ${current.slice(0, 130)}`);
      continue;
    }
    if (res.status === 200 && !/text\/html/i.test(ctype)) {
      console.log(`              *** FINAL: a FILE on ${host} — allowlisting this host would work ***`);
    } else if (res.status === 200) {
      console.log(`              (final: an HTML page — portal/login, not a file)`);
    }
    return;
  }
  console.log("      (too many redirects)");
}

async function main() {
  const cfg = await loadRtaInboxConfig(true);
  const client = new ImapFlow({
    host: cfg.host!, port: cfg.port, secure: cfg.secure,
    auth: { user: cfg.user!, pass: cfg.pass! }, logger: false,
  });
  client.on("error", () => {});
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const st = await client.status("INBOX", { messages: true });
      const total = st.messages ?? 0;
      let shown = 0;
      for await (const m of client.fetch(`${Math.max(1, total - 40)}:*`, { source: true })) {
        if (shown >= COUNT || !m.source) continue;
        const parsed = await simpleParser(m.source as Buffer);
        const sender = String(parsed.from?.value?.[0]?.address ?? "").toLowerCase();
        if (!sender.includes(NEEDLE)) continue;
        shown++;
        console.log("=".repeat(78));
        console.log("subject:", String(parsed.subject ?? "").slice(0, 80));
        const html = typeof parsed.html === "string" ? parsed.html : undefined;
        const links = extractRtaDownloadLinks(parsed.text, html);
        for (const l of links.slice(0, 2)) {
          const dest = resolveTrackedUrl(l);
          console.log(`  candidate: ${dest.slice(0, 120)}`);
          await trace(l);
        }
      }
      if (!shown) console.log(`(no recent mail from "${NEEDLE}")`);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(String(e?.message ?? e).slice(0, 300));
  process.exit(1);
});
