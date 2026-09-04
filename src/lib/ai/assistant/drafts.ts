/**
 * Equitywala Copilot — business-communication drafting (P4).
 *
 * Produces ready-to-send DRAFTS for the common MFD outreach scenarios across
 * email / WhatsApp / SMS. Strictly a drafting aid: the copilot never sends —
 * it hands the user polished, compliant text to copy into their channel. Every
 * money-adjacent draft carries the standard market-risk disclaimer, and none
 * promise returns or recommend a scheme (the compliance line the product holds).
 */

type Channel = "email" | "whatsapp" | "sms";
type Scenario =
  | "birthday" | "sip_reminder" | "review_invite" | "kyc_reminder"
  | "dormant" | "renewal" | "welcome" | "generic";

const DISCLAIMER = "Mutual fund investments are subject to market risks. Read all scheme related documents carefully.";

function detectChannel(q: string): Channel {
  if (/\b(whatsapp|wa\b|wapp)\b/i.test(q)) return "whatsapp";
  if (/\b(sms|text\s+message|text)\b/i.test(q)) return "sms";
  return "email"; // default
}

function detectScenario(q: string): Scenario {
  if (/\bbirthday|b'?day|wish\b/i.test(q)) return "birthday";
  if (/\bsip\b/i.test(q)) return "sip_reminder";
  if (/\b(review|meeting|catch.?up|annual\s+review)\b/i.test(q)) return "review_invite";
  if (/\bkyc\b/i.test(q)) return "kyc_reminder";
  if (/\b(dormant|inactive|re.?engage|win.?back|reconnect)\b/i.test(q)) return "dormant";
  if (/\b(renewal|premium|policy\s+due|insurance)\b/i.test(q)) return "renewal";
  if (/\b(welcome|onboard|new\s+client)\b/i.test(q)) return "welcome";
  return "generic";
}

/** Best-effort client name from "…to Rahul Sharma", "…for Priya". */
function extractName(q: string): string {
  const m = q.match(/\b(?:to|for|addressed to)\s+([A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){0,2})\s*$/);
  const name = m?.[1]?.trim();
  if (!name) return "[Client name]";
  // Avoid capturing trailing scenario words.
  if (/\b(birthday|sip|review|kyc|renewal|premium|welcome|email|whatsapp|sms|message|client|him|her|them)\b/i.test(name)) return "[Client name]";
  return name;
}

const NEEDS_DISCLAIMER: Record<Scenario, boolean> = {
  birthday: false, review_invite: false, kyc_reminder: false, renewal: false,
  sip_reminder: true, dormant: true, welcome: true, generic: true,
};

function body(scenario: Scenario, channel: Channel, name: string, firm: string, from: string): { subject?: string; text: string } {
  const S = (subject: string, text: string) => ({ subject, text });
  switch (scenario) {
    case "birthday":
      return channel === "email"
        ? S(`Happy Birthday, ${name}! 🎉`, `Dear ${name},\n\nWishing you a very happy birthday from all of us at ${firm}! 🎂 May the year ahead bring you good health, happiness and continued success.\n\nIt's a privilege to be part of your financial journey. Do reach out any time you'd like to review your plans.\n\nWarm regards,\n${from}\n${firm}`)
        : S(undefined as any, `Happy Birthday, ${name}! 🎂 Wishing you health, happiness and a wonderful year ahead — from all of us at ${firm}. 🎉`);
    case "sip_reminder":
      return channel === "email"
        ? S(`A quick note on your SIP`, `Dear ${name},\n\nThis is a gentle reminder regarding your Systematic Investment Plan. Please ensure sufficient balance is maintained in your registered bank account before the next instalment date so the SIP continues uninterrupted.\n\nStaying invested consistently is one of the simplest ways to work towards your long-term goals. If you'd like to review or adjust your SIP, we're happy to help.\n\nWarm regards,\n${from}\n${firm}\n\n${DISCLAIMER}`)
        : S(undefined as any, `Hi ${name}, a gentle reminder to keep sufficient balance for your upcoming SIP instalment so it continues smoothly. Reach out if you'd like to review it. — ${firm}. ${DISCLAIMER}`);
    case "review_invite":
      return channel === "email"
        ? S(`Time for your portfolio review`, `Dear ${name},\n\nIt's been a while since we last reviewed your portfolio together. A quick review helps ensure your investments stay aligned with your goals and life stage.\n\nWould you be open to a short call or meeting this week? Simply reply with a convenient day and time, and we'll set it up.\n\nWarm regards,\n${from}\n${firm}`)
        : S(undefined as any, `Hi ${name}, it's a good time for a quick portfolio review to make sure things stay on track. What day/time works for you this week? — ${from}, ${firm}`);
    case "kyc_reminder":
      return channel === "email"
        ? S(`Action needed: complete your KYC`, `Dear ${name},\n\nOur records show your KYC is pending or needs an update. A completed KYC is required to keep transacting smoothly without interruptions.\n\nIt only takes a few minutes — reply to this email or call us and we'll guide you through the steps.\n\nWarm regards,\n${from}\n${firm}`)
        : S(undefined as any, `Hi ${name}, your KYC is pending/needs an update — it's quick to complete and keeps your transactions smooth. Reply and we'll help you through it. — ${firm}`);
    case "dormant":
      return channel === "email"
        ? S(`We'd love to reconnect`, `Dear ${name},\n\nWe noticed it's been a while since your last activity with us. A lot can change in the markets and in life, and we'd genuinely like to understand how your priorities have evolved.\n\nCould we schedule a brief, no-obligation catch-up? We'll take stock of where things stand and see how we can add value.\n\nWarm regards,\n${from}\n${firm}\n\n${DISCLAIMER}`)
        : S(undefined as any, `Hi ${name}, it's been a while! We'd love a quick, no-obligation catch-up to see how your priorities have changed and how we can help. — ${from}, ${firm}. ${DISCLAIMER}`);
    case "renewal":
      return channel === "email"
        ? S(`Your insurance premium is due soon`, `Dear ${name},\n\nThis is a friendly reminder that a premium on your insurance policy is due shortly. Timely payment keeps your cover active and your family protected without any lapse.\n\nIf you'd like the policy details or help with the payment, just reply and we'll assist right away.\n\nWarm regards,\n${from}\n${firm}`)
        : S(undefined as any, `Hi ${name}, a reminder that your insurance premium is due soon — paying on time keeps your cover active. Reply if you'd like help. — ${firm}`);
    case "welcome":
      return channel === "email"
        ? S(`Welcome to ${firm}! 🙏`, `Dear ${name},\n\nA warm welcome to ${firm} — we're delighted to have you on board! Our goal is to make your investment journey simple, transparent and aligned with what matters most to you.\n\nYou'll hear from us with timely updates and reviews. Meanwhile, feel free to reach out with any questions at all.\n\nWarm regards,\n${from}\n${firm}\n\n${DISCLAIMER}`)
        : S(undefined as any, `Welcome to ${firm}, ${name}! 🙏 We're glad to have you on board and look forward to supporting your investment journey. Reach out any time. ${DISCLAIMER}`);
    default:
      return channel === "email"
        ? S(`A note from ${firm}`, `Dear ${name},\n\n[Write your message here.]\n\nWarm regards,\n${from}\n${firm}\n\n${DISCLAIMER}`)
        : S(undefined as any, `Hi ${name}, [write your message here]. — ${from}, ${firm}. ${DISCLAIMER}`);
  }
}

/** Build a copy-paste-ready draft. Always returns text (generic fallback). */
export function draftMessage(question: string, meta: { userName: string; firmName: string }): string {
  const channel = detectChannel(question);
  const scenario = detectScenario(question);
  const name = extractName(question);
  const out = body(scenario, channel, name, meta.firmName, meta.userName);
  const channelLabel = channel === "whatsapp" ? "WhatsApp" : channel === "sms" ? "SMS" : "Email";
  const smsNote = channel === "sms" ? `\n\n_SMS drafts should stay within your DLT-approved template — adapt the wording to match._` : "";

  const draftBlock =
    channel === "email"
      ? `**Subject:** ${out.subject}\n\n${out.text}`
      : out.text;

  return `Here's a **${channelLabel} draft** you can copy and personalise:\n\n---\n\n${draftBlock}\n\n---\n\n_Draft only — I don't send messages. Review, tweak the tone, and send it from your channel._${smsNote}`;
}
