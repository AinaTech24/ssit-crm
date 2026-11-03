import { describe, expect, it } from "vitest";
import { isMailKey, normalisePrefix, uidForKey } from "@/lib/rta/ses-inbox";
import { parseInboundSource } from "@/lib/comms/imap";

describe("SES inbox — which files are mail", () => {
  it("normalises the folder to end with a slash, or none", () => {
    expect(normalisePrefix("rta-inbound")).toBe("rta-inbound/");
    expect(normalisePrefix("/rta-inbound/")).toBe("rta-inbound/");
    expect(normalisePrefix("")).toBe("");
  });

  it("takes real mail and skips the folder marker and SES's own setup note", () => {
    expect(isMailKey("rta-inbound/abc123", "rta-inbound/")).toBe(true);
    expect(isMailKey("rta-inbound/", "rta-inbound/")).toBe(false);
    expect(isMailKey("rta-inbound/AMAZON_SES_SETUP_NOTIFICATION", "rta-inbound/")).toBe(false);
    expect(isMailKey("elsewhere/abc123", "rta-inbound/")).toBe(false);
  });

  it("gives the same positive number for the same file every time", () => {
    expect(uidForKey("rta-inbound/abc123")).toBe(uidForKey("rta-inbound/abc123"));
    expect(uidForKey("rta-inbound/abc123")).toBeGreaterThan(0);
    expect(uidForKey("rta-inbound/abc123")).not.toBe(uidForKey("rta-inbound/abc124"));
  });
});

// What SES leaves in the bucket: a raw message, no envelope, and the address it
// was delivered to only in the Received header. This one is an auto-forward from
// Gmail, which stamps X-Forwarded-To / X-Forwarded-For.
const RAW = [
  "Return-Path: <firm@gmail.com>",
  "Received: from mail-wr1-f41.google.com (mail-wr1-f41.google.com [209.85.221.41])",
  "\tby inbound-smtp.ap-south-1.amazonaws.com with SMTP id abc",
  "\tfor rta-df7c91d070de@crm.equitywala.com;",
  "\tMon, 02 Nov 2026 05:00:00 +0000 (UTC)",
  "X-Forwarded-For: firm@gmail.com rta-df7c91d070de@crm.equitywala.com",
  "From: CAMS <donotreply@camsonline.com>",
  "To: Firm <firm@gmail.com>",
  "Subject: Mailback report",
  "Message-ID: <m1@camsonline.com>",
  "Date: Mon, 02 Nov 2026 10:30:00 +0530",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="B"',
  "",
  "--B",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Report attached.",
  "--B",
  'Content-Type: application/zip; name="WBR2_test.zip"',
  'Content-Disposition: attachment; filename="WBR2_test.zip"',
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from("PK-fake-zip-bytes").toString("base64"),
  "--B--",
  "",
].join("\r\n");

describe("a raw SES message becomes the shape the importer expects", () => {
  it("finds the firm's address in Received and the forward headers, and decodes the attachment", async () => {
    const msg = await parseInboundSource(Buffer.from(RAW), 7, { includeReceivedFor: true });
    expect(msg.recipients).toContain("rta-df7c91d070de@crm.equitywala.com");
    expect(msg.from).toBe("donotreply@camsonline.com");
    expect(msg.senderCandidates).toContain("firm@gmail.com");
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].filename).toBe("WBR2_test.zip");
    expect(msg.attachments[0].content.toString()).toBe("PK-fake-zip-bytes");
    expect(msg.messageId).toBe("<m1@camsonline.com>");
  });

  it("without the opt-in, the Received header is not used for routing (the IMAP path is unchanged)", async () => {
    const noFwd = RAW.replace(/^X-Forwarded-For:.*\r\n/m, "");
    const msg = await parseInboundSource(Buffer.from(noFwd), 7);
    expect(msg.recipients).not.toContain("rta-df7c91d070de@crm.equitywala.com");
    const withIt = await parseInboundSource(Buffer.from(noFwd), 7, { includeReceivedFor: true });
    expect(withIt.recipients).toContain("rta-df7c91d070de@crm.equitywala.com");
  });
});
