/**
 * Print every candidate download link in the most recent registrar mails, in the
 * order our extractor ranks them, so we can see which one it would pick and
 * which one is the actual report.
 *
 * Reads the catch-all mailbox directly (recent messages, seen or unseen) and
 * changes nothing — no flags are set, no mail is deleted.
 *
 *   npx tsx scripts/inspect-mailback-links.ts [kfintech|cams] [count]
 */
import "dotenv/config";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { loadRtaInboxConfig } from "@/lib/rta/inbox-config";
import { extractRtaDownloadLinks } from "@/lib/rta/mailback-download";

const NEEDLE = (process.argv[2] ?? "kfintech").toLowerCase();
const COUNT = Number(process.argv[3] ?? 4);

async function main() {
  const cfg = await loadRtaInboxConfig(true);
  if (!cfg.configured) throw new Error("inbox not configured");

  const client = new ImapFlow({
    host: cfg.host!,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user!, pass: cfg.pass! },
    logger: false,
  });
  client.on("error", () => {});
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const status = await client.status("INBOX", { messages: true });
      const total = status.messages ?? 0;
      const from = Math.max(1, total - 120); // scan the tail only
      let shown = 0;

      for await (const m of client.fetch(`${from}:*`, { source: true, envelope: true })) {
        if (shown >= COUNT || !m.source) continue;
        const parsed = await simpleParser(m.source as Buffer);
        const sender = String(parsed.from?.value?.[0]?.address ?? "").toLowerCase();
        if (!sender.includes(NEEDLE)) continue;

        shown++;
        console.log("=".repeat(78));
        console.log("from   :", sender);
        console.log("subject:", String(parsed.subject ?? "").slice(0, 90));
        console.log("date   :", parsed.date?.toISOString());
        console.log("attachments:", (parsed.attachments ?? []).length);

        const html = typeof parsed.html === "string" ? parsed.html : undefined;
        const ranked = extractRtaDownloadLinks(parsed.text, html);
        console.log(`links our extractor would try, best-first (${ranked.length}):`);
        ranked.forEach((u, i) => console.log(`   ${i === 0 ? "->" : "  "} [${i}] ${u.slice(0, 150)}`));

        // Every raw URL in the mail, so we can see what was filtered out.
        const raw = new Set<string>();
        for (const mm of (parsed.text ?? "").matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) raw.add(mm[0]);
        for (const mm of (html ?? "").matchAll(/href\s*=\s*["']([^"']+)["']/gi)) raw.add(mm[1]);
        const dropped = [...raw].filter((u) => !ranked.some((r) => r.startsWith(u.slice(0, 40))));
        if (dropped.length) {
          console.log("raw URLs NOT selected:");
          dropped.forEach((u) => console.log("      ", u.slice(0, 150)));
        }
      }
      if (!shown) console.log(`(no recent mail from a sender containing "${NEEDLE}")`);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(String(e?.message ?? e).slice(0, 300));
    process.exit(1);
  });
