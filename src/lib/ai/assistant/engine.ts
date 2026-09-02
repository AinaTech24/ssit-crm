/**
 * SSIT Assistant — LOCAL engine (no external AI).
 *
 * Answers the common questions entirely on our own server: it classifies the
 * message (greeting / metric / list / breakdown / period) and pulls the numbers
 * from the live firm snapshot or our read-only tools (tools.ts), then formats a
 * clean Markdown answer. Free, instant, private, always-on — and it can't fail
 * the way an external API can.
 *
 * It also handles MULTI-PART messages (asks separated by "·", ";", newlines) by
 * answering each part as its own section. When it genuinely can't parse a
 * question it returns { handled: false }, and the caller may hand off to the
 * optional external LLM.
 */

import type { FirmSnapshot } from "@/lib/ai/firm-snapshot";
import { runAssistantTool, type AssistantCtx } from "./tools";
import { classifyScope, REFUSAL_TEXT, ADVICE_TEXT } from "./scope";
import { draftMessage } from "./drafts";
import { isHowToQuestion, findHowTo, howToIndex } from "./howto";
import type { LogRow } from "./learning";

const inr = (n: any) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");

/** Pick a random variant so repeated small-talk doesn't read like a stuck macro. */
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** Embed a chart spec the Markdown renderer turns into an inline SVG chart. */
function chartFence(spec: { type: "bar" | "hbar" | "line" | "pie"; title?: string; data: { label: string; value: number }[]; format?: "inr" | "number" }): string {
  const data = spec.data.filter((d) => d && d.label != null && Number.isFinite(Number(d.value)));
  if (data.length < 2) return ""; // a chart of one bar isn't worth it
  return "```ssit-chart\n" + JSON.stringify({ ...spec, data }) + "\n```";
}

/** Parse an amount like "10,000", "10k", "1 lakh", "2 cr" → rupees. */
function parseAmount(raw: string, unit?: string): number {
  const base = Number(String(raw).replace(/[, ]/g, ""));
  if (!Number.isFinite(base)) return NaN;
  const u = (unit ?? "").toLowerCase();
  if (u === "k" || u === "thousand") return base * 1_000;
  if (u === "l" || u === "lakh" || u === "lac" || u === "lakhs") return base * 100_000;
  if (u === "cr" || u === "crore" || u === "crores") return base * 10_000_000;
  return base;
}

/** A minimum-threshold amount from phrases like "over ₹10,000", "above 5 lakh". */
function extractMin(q: string): number | null {
  const m = q.match(/(?:over|above|more than|greater than|at ?least|minimum|>=?)\s*₹?\s*([\d,]+(?:\.\d+)?)\s*(k|thousand|lakhs?|lac|l|cr|crores?|crore)?/i);
  if (!m) return null;
  const v = parseAmount(m[1], m[2]);
  return Number.isFinite(v) ? v : null;
}

/** "top 10" / "first 5" → 10 / 5; a bare "top" → def. */
function extractN(q: string, def = 10): number {
  const m = q.match(/\b(?:top|first|list|show)\s+(\d{1,3})/i) || q.match(/\b(\d{1,3})\s+clients?\b/i);
  const n = m ? Number(m[1]) : def;
  return Math.min(Math.max(1, n), 50);
}

const CITY_STOP = new Set(["the", "my", "with", "who", "having", "and", "a", "an", "this", "month", "week", "over", "above", "in"]);
function extractCity(q: string): string | null {
  const m = q.match(/\b(?:in|from|at)\s+([a-z][a-z]+)/i);
  if (!m) return null;
  const c = m[1].trim();
  return CITY_STOP.has(c.toLowerCase()) ? null : c;
}

const SEGMENTS: Record<string, string> = { hni: "HNI", affluent: "Affluent", retail: "Retail", nri: "NRI", corporate: "Corporate" };
function extractSegment(q: string): string | null {
  for (const k of Object.keys(SEGMENTS)) if (new RegExp(`\\b${k}\\b`, "i").test(q)) return SEGMENTS[k];
  return null;
}

function clientsTable(clients: any[]): string {
  if (!clients.length) return "_No matching clients._";
  const rows = clients
    .map((c) => `| ${c.name} | ${inr(c.aum_inr)} | ${c.monthly_sip_inr ? inr(c.monthly_sip_inr) : "—"} | ${c.segment ?? "—"} | ${c.kyc_status ?? "—"} |`)
    .join("\n");
  return `| Client | AUM | SIP/mo | Segment | KYC |\n| --- | ---: | ---: | --- | --- |\n${rows}`;
}

type Meta = { userName: string; firmName: string; snapshot: FirmSnapshot };

/** A matcher: given the (lower-cased) sub-question, either returns a Markdown
 *  answer or null (not my intent). Ordered most-specific first. */
type Matcher = (ctx: AssistantCtx, q: string, m: Meta) => Promise<string | null> | (string | null);

const MATCHERS: Matcher[] = [
  // Greeting / small talk — no data. Varied replies so it feels like a chat,
  // not a macro that repeats the same block every time.
  (_ctx, q, m) => {
    const isGreeting = /^(hi+|hey+|hello+|yo+|hii+|heya|namaste|hola|good\s+(morning|afternoon|evening|day)|greetings)\b/i.test(q);
    const isHowAreYou = /\b(how\s+are\s+(you|u|things)|how'?s\s+it\s+going|how\s+do\s+you\s+do|what'?s\s+up|whats\s+up|sup|you\s+there|are\s+you\s+there)\b/i.test(q);
    if (!isGreeting && !isHowAreYou) return null;
    if (isHowAreYou && !isGreeting) {
      return pick([
        `Doing great, ${m.userName} — ready to dig into your book! What would you like to see?`,
        `All good here! 😊 Ask me anything about **${m.firmName}** — AUM, clients, SIPs, tasks, business.`,
        `I'm good, thanks for asking! What can I pull up for you?`,
        `Running smoothly! 🙌 Want me to look at clients, business, or something else?`,
      ]);
    }
    const hi = pick([`Hey ${m.userName}!`, `Hi ${m.userName}!`, `Hello ${m.userName}!`, `Hey there, ${m.userName}!`]);
    const tail = pick([
      `👋 What would you like to look at — clients, AUM, SIPs, tasks or business?`,
      `😊 Ask me anything about **${m.firmName}** — e.g. *"top 10 clients by AUM"* or *"net business this month"*.`,
      `👋 I'm here. Try *"AUM by segment"*, *"renewals due in 30 days"*, or *"how many KYC-pending?"*.`,
      `Ready when you are — clients, leads, tasks, insurance, business? Just ask.`,
    ]);
    return `${hi} ${tail}`;
  },
  // Thanks + acknowledgements ("ok", "cool", "got it", "nice").
  (_ctx, q, m) => {
    const isThanks = /\b(thank|thanks|thx|thankyou|much\s+appreciated|appreciate\s+it)\b/i.test(q);
    const isAck = /^(ok(ay|ie)?|k|cool|nice|great|awesome|perfect|got\s+it|good|sure|alright|fine|yep|yup|yeah|yea|ya|yes|hmm+|haan|👍)\b/i.test(q.trim());
    if ((!isThanks && !isAck) || q.length > 40) return null;
    if (isThanks) {
      return pick([
        `Anytime, ${m.userName}! 🙌`,
        `You're welcome! Anything else about your clients, AUM or business?`,
        `Happy to help, ${m.userName}! What's next?`,
        `Glad that helped! 😊 Ask me whenever you need.`,
      ]);
    }
    return pick([
      `👍 What else can I get you?`,
      `Anytime! Ask me anything about your clients or business.`,
      `Cool — want me to pull up something else?`,
      `Got it! 😊 I'm here if you need more.`,
    ]);
  },
  (_ctx, q, m) => {
    if (!/\b(who\s+are\s+you|what\s+are\s+you|what\s+can\s+you\s+do|what\s+do\s+you\s+do|help\b|what\s+do\s+you\s+know|how\s+do\s+you\s+work|capabilities)\b/i.test(q)) return null;
    return `I'm **SSIT CRM Copilot**, the copilot for **${m.firmName}**. Two things I do:\n\n**1. Answer from your live CRM data**\n- **Clients** — filter by segment, city, KYC, SIP, AUM, dormancy; top clients; breakdowns by segment / RM / city\n- **Business** — booked business by period, month-by-month trend\n- **Ops** — leads, tasks, review meetings, insurance renewals, client birthdays\n- **Data quality** — missing KYC / nominee / RM / city, dormant clients\n\n**2. Explain how SSIT CRM works** — *"how do I convert a lead to a client?"*, *"how do I import from CAMS?"*, *"how do I set up an automation?"*\n\nI can also **draft** a client email / WhatsApp / SMS. Try *"top 10 clients by AUM"*, *"business trend last 6 months"*, or *"how do I risk-profile a client?"*.`;
  },

  // ---- HOW-TO / process questions — must beat every data matcher, otherwise
  // "how do I convert a lead?" gets answered with a lead COUNT. ----
  (_ctx, q) => {
    if (!isHowToQuestion(q)) return null;
    const guide = findHowTo(q);
    return guide ? guide.body : howToIndex();
  },

  // ---- Client 360 (single client, by name) — before the list matcher ----
  async (ctx, q) => {
    let name: string | null = null;
    const m1 = q.match(/\b(?:tell me about|profile of|profile for|360 (?:of|for|on)|everything about|details? (?:on|about|of)|summary (?:of|for)|snapshot (?:of|for)|overview (?:of|for))\s+(.+)$/i);
    if (m1) name = m1[1];
    if (!name) { const m2 = q.match(/^(.+?)(?:['’]s)?\s+(?:360|portfolio|full profile|full view)\b/i); if (m2) name = m2[1]; }
    if (!name) return null;
    name = name.replace(/['’]s\b/gi, "").replace(/\b(portfolio|profile|account|details?|summary|360|overview|snapshot|please|full view)\b/gi, "").replace(/[?.!]+$/, "").trim();
    if (!name || name.length < 2) return null;
    // A metric/entity word means it's not a person's name — defer.
    if (/\b(aum|sip|clients?|investors?|business|kyc|leads?|tasks?|insurance|policy|policies|meetings?|segment|city|rm|firm|dormant|nominee|renewals?|birthdays?|trend|report|data|everything|my)\b/i.test(name)) return null;
    const out = await runAssistantTool(ctx, "get_customer_360", { name });
    if (out?.error) return null;
    if (out?.not_found) return `I couldn't find a client matching "**${name}**". Check the spelling, or open [Clients](/dashboard/investors).`;
    const row = (label: string, val: any) => (val == null || val === "" ? null : `| ${label} | ${val} |`);
    const rows = [
      row("AUM", inr(out.aum_inr)),
      row("Monthly SIP", out.monthly_sip_inr ? inr(out.monthly_sip_inr) : "—"),
      row("Segment", out.segment),
      row("Service tier", out.tier),
      row("KYC", out.kyc_status),
      row("RM", out.rm),
      row("City", out.city),
      row("Nominee", out.nominee ?? "— none on file —"),
      row("Last transaction", out.last_transaction),
      row("Insurance", out.active_policies ? `${out.active_policies} active · ${inr(out.insurance_annual_premium_inr)}/yr` : "—"),
      row("Open tasks", String(out.open_tasks ?? 0)),
      row("Next meeting", out.next_meeting ? new Date(out.next_meeting).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "—"),
    ].filter(Boolean).join("\n");
    return `**${out.name} — client 360**\n\n| Field | Value |\n| --- | --- |\n${rows}\n\n[Open Clients](/dashboard/investors)`;
  },

  // ---- Client LISTS (filters) — must beat the generic AUM/SIP matchers ----
  async (ctx, q) => {
    // "AUM by segment" / "which RM has the most…" are breakdowns — defer them.
    if (/\b(by|per|which|each)\b/i.test(q) && /\b(rm|manager|segment|city|tier|kyc)\b/i.test(q)) return null;
    const wantsList = /\b(clients?|investors?|customers?|list|show|who)\b/i.test(q);
    const segment = extractSegment(q);
    const city = extractCity(q);
    const minSip = /\bsip\b/i.test(q) ? extractMin(q) : null;
    const minAum = /\baum\b/i.test(q) && !minSip ? extractMin(q) : null;
    const dormant = /\bdormant|inactive|no\s+(txn|transaction)/i.test(q);
    const noNominee = /\bno\s+nominee|nominee\s+missing|missing\s+nominee|without\s+nominee/i.test(q);
    const kycPending = /\bkyc[- ]?pending|pending\s+kyc|not\s+kyc/i.test(q);
    const anyFilter = segment || city || minSip != null || minAum != null || dormant || noNominee || kycPending;
    // Only treat as a list when there's a filter OR an explicit "top/list" ask.
    const topAsk = /\b(top|biggest|largest|highest|first)\b/i.test(q);
    if (!wantsList && !topAsk) return null;
    if (!anyFilter && !topAsk) return null;

    const args: any = { limit: extractN(q, topAsk && !anyFilter ? 10 : 15) };
    if (segment) args.segment = segment;
    if (city) args.city = city;
    if (minSip != null) { args.min_sip = minSip; args.sort_by = "sip"; }
    if (minAum != null) args.min_aum = minAum;
    if (dormant) args.dormant = true;
    if (noNominee) args.no_nominee = true;
    if (kycPending) args.kyc_pending = true;

    const out = await runAssistantTool(ctx, "search_clients", args);
    if (out?.error) return null;
    const filters = [
      segment && `segment ${segment}`,
      city && `in ${city}`,
      minSip != null && `SIP ≥ ${inr(minSip)}`,
      minAum != null && `AUM ≥ ${inr(minAum)}`,
      dormant && "dormant",
      noNominee && "no nominee",
      kycPending && "KYC-pending",
    ].filter(Boolean).join(", ");
    const head = filters ? `Clients (${filters}) — ${out.count} found` : `Top ${out.clients.length} clients by AUM`;
    // A top-by-AUM ranking is worth a bar chart; a plain filtered lookup isn't.
    const chart = topAsk && minSip == null
      ? chartFence({ type: "hbar", title: "Top clients by AUM", format: "inr", data: out.clients.map((c: any) => ({ label: String(c.name), value: c.aum_inr })) })
      : "";
    return `**${head}**\n\n${clientsTable(out.clients)}${chart ? `\n\n${chart}` : ""}\n\n[Open Clients](/dashboard/investors)`;
  },

  // ---- Breakdowns / grouping ----
  async (ctx, q) => {
    if (!/\b(by|per|breakdown|group|which|each)\b/i.test(q)) return null;
    const dim =
      /\bsegment/i.test(q) ? "segment"
      : /\bcity|location|region/i.test(q) ? "city"
      : /\btier|service\s*tier/i.test(q) ? "service_tier"
      : /\bkyc/i.test(q) ? "kyc_status"
      : /\brm|manager|relationship/i.test(q) ? "rm"
      : null;
    if (!dim) return null;
    const args: any = { dimension: dim };
    if (/\bdormant|inactive/i.test(q)) args.dormant = true;
    if (/\bkyc[- ]?pending/i.test(q)) args.kyc_pending = true;
    const out = await runAssistantTool(ctx, "group_clients", args);
    if (out?.error || !out?.groups?.length) return null;
    const rows = out.groups.map((g: any) => `| ${g.group} | ${g.clients} | ${inr(g.total_aum_inr)} | ${g.total_monthly_sip_inr ? inr(g.total_monthly_sip_inr) : "—"} |`).join("\n");
    const label = { segment: "segment", city: "city", service_tier: "tier", kyc_status: "KYC status", rm: "RM" }[dim];
    // Chart the metric the user actually asked about (AUM vs client count).
    const byAum = /\b(aum|assets|value|corpus)\b/i.test(q);
    const chart = chartFence({
      type: dim === "rm" || dim === "city" ? "hbar" : "bar",
      title: byAum ? `AUM by ${label}` : `Clients by ${label}`,
      format: byAum ? "inr" : "number",
      data: out.groups.map((g: any) => ({ label: String(g.group), value: byAum ? g.total_aum_inr : g.clients })),
    });
    const table = `| ${label![0].toUpperCase() + label!.slice(1)} | Clients | AUM | SIP/mo |\n| --- | ---: | ---: | ---: |\n${rows}`;
    return `**${byAum ? "AUM" : "Clients"} by ${label}**\n\n${table}${chart ? `\n\n${chart}` : ""}`;
  },

  // ---- Business (period, comparisons) ----
  async (ctx, q) => {
    if (!/\b(business|booked|net\s+sales|lumpsum|redemption|inflow)\b/i.test(q)) return null;
    // A month-by-month / "last N months" ask is a trend — defer to the trend matcher.
    if (/\b(trend|monthly|month[- ]by[- ]month|over\s+(the\s+)?(last|past)|last\s+\d+\s+months?|graph|chart)\b/i.test(q)) return null;
    const compare = /\b(compare|vs|versus|against|last\s+month)\b/i.test(q);
    const periodOf = (s: string) => (/\blast\s+month|previous\s+month/i.test(s) ? "lm" : /\bquarter|qtd/i.test(s) ? "qtd" : /\byear|fy|fytd/i.test(s) ? "fytd" : "mtd");
    if (compare && /this\s+month|net\s+business/i.test(q)) {
      const [a, b] = await Promise.all([
        runAssistantTool(ctx, "get_business_summary", { period: "mtd" }),
        runAssistantTool(ctx, "get_business_summary", { period: "lm" }),
      ]);
      if (a?.error || b?.error) return null;
      const delta = a.net_business_inr - b.net_business_inr;
      return `**Business — this month vs last month**\n\n| Metric | This month | Last month |\n| --- | ---: | ---: |\n| SIP added | ${inr(a.sip_added_inr)} | ${inr(b.sip_added_inr)} |\n| Lumpsum | ${inr(a.lumpsum_inr)} | ${inr(b.lumpsum_inr)} |\n| Redemption | ${inr(a.redemption_inr)} | ${inr(b.redemption_inr)} |\n| **Net business** | **${inr(a.net_business_inr)}** | **${inr(b.net_business_inr)}** |\n\nNet business is ${delta >= 0 ? "**up**" : "**down**"} ${inr(Math.abs(delta))} vs last month. [Open Reports](/dashboard/reports)`;
    }
    const out = await runAssistantTool(ctx, "get_business_summary", { period: periodOf(q) });
    if (out?.error) return null;
    const pl = { mtd: "this month", lm: "last month", qtd: "this quarter", fytd: "this financial year" }[out.period as string];
    return `**Business — ${pl}**\n\n| Metric | Value |\n| --- | ---: |\n| SIP added | ${inr(out.sip_added_inr)} |\n| Lumpsum | ${inr(out.lumpsum_inr)} |\n| Redemption | ${inr(out.redemption_inr)} |\n| **Net business** | **${inr(out.net_business_inr)}** |\n\n[Open Reports](/dashboard/reports)`;
  },

  // ---- Client birthdays ----
  async (ctx, q) => {
    if (!/\b(birthday|birthdays|b'?day|turning|born\s+today|dob)\b/i.test(q)) return null;
    const within = /\b(this\s+week|week|7\s*days)\b/i.test(q) ? 7 : /\b(month|30\s*days)\b/i.test(q) ? 30 : /\b(upcoming|soon|coming|next)\b/i.test(q) ? 14 : 0;
    const out = await runAssistantTool(ctx, "get_birthdays", { within_days: within, limit: 25 });
    if (out?.error) return null;
    const when = within ? `in the next ${within} days` : "today";
    if (!out.count) return `No client birthdays ${when}. 🎂 [Open Clients](/dashboard/investors)`;
    const rows = out.clients.map((c: any) => `| ${c.name} | ${c.birthday} |`).join("\n");
    return `**${out.count} client ${out.count === 1 ? "birthday" : "birthdays"} ${when}** 🎂\n\n| Client | Birthday |\n| --- | --- |\n${rows}\n\n[Open Clients](/dashboard/investors)`;
  },

  // ---- Insurance renewals due ----
  async (ctx, q) => {
    if (!/\b(renewal|renewals|premium\s+due|due\s+for\s+renewal|expiring|policies?\s+due)\b/i.test(q)) return null;
    const dm = q.match(/\b(\d{1,3})\s*days?\b/i);
    const days = dm ? Math.min(Number(dm[1]), 365) : /\bquarter\b/i.test(q) ? 90 : /\bmonth\b/i.test(q) ? 30 : 30;
    const out = await runAssistantTool(ctx, "get_upcoming_renewals", { days, limit: 20 });
    if (out?.error) return null;
    if (!out.count) return `No insurance premiums are due in the next ${out.window_days} days. [Open Insurance](/dashboard/insurance)`;
    const rows = out.policies
      .map((p: any) => `| ${p.client} | ${p.insurer ?? "—"} | ${p.plan ?? "—"} | ${inr(p.annual_premium_inr)} | ${p.due_date ?? "—"} |`)
      .join("\n");
    return `**${out.count} ${out.count === 1 ? "policy" : "policies"} due for renewal in the next ${out.window_days} days**\n\n| Client | Insurer | Plan | Premium | Due |\n| --- | --- | --- | ---: | --- |\n${rows}\n\n[Open Insurance](/dashboard/insurance)`;
  },

  // ---- Review meetings (windowed list) ----
  async (ctx, q) => {
    if (!/\b(meeting|meetings|review\s+meeting|reviews?)\b/i.test(q)) return null;
    // Only claim when a window/list is implied; a plain count is left to the snapshot.
    if (!/\b(today|this\s+week|week|upcoming|overdue|missed|next|scheduled|list|show|due)\b/i.test(q)) return null;
    const w = /\b(overdue|missed|past)\b/i.test(q) ? "overdue" : /\btoday\b/i.test(q) ? "today" : /\bweek\b/i.test(q) ? "this_week" : "upcoming";
    const out = await runAssistantTool(ctx, "get_review_meetings", { window: w, limit: 20 });
    if (out?.error) return null;
    const label = { today: "today", this_week: "this week", upcoming: "in the next 30 days", overdue: "overdue" }[w];
    if (!out.count) return `No ${w === "overdue" ? "overdue " : ""}review meetings ${label}. [Open Meetings](/dashboard/review-meetings)`;
    const fmtAt = (at: string) => {
      try { return new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
      catch { return String(at); }
    };
    const rows = out.meetings.map((mt: any) => `| ${mt.client} | ${fmtAt(mt.at)} | ${mt.status} |`).join("\n");
    return `**${out.count} review ${out.count === 1 ? "meeting" : "meetings"} ${label}**\n\n| Client | When | Status |\n| --- | --- | --- |\n${rows}\n\n[Open Meetings](/dashboard/review-meetings)`;
  },

  // ---- Data-quality summary ----
  async (ctx, q) => {
    if (!/\b(data\s*quality|data\s*health|incomplete|what.?s\s+missing|missing\s+(data|info|information|fields|details)|data\s*clean|clean\s*up)\b/i.test(q)) return null;
    const out = await runAssistantTool(ctx, "get_data_quality_summary", {});
    if (out?.error) return null;
    const chart = chartFence({
      type: "bar", title: "Client data gaps", format: "number",
      data: [
        { label: "KYC", value: out.missing_kyc },
        { label: "Nominee", value: out.missing_nominee },
        { label: "RM", value: out.missing_rm },
        { label: "City", value: out.missing_city },
        { label: "Dormant", value: out.dormant },
      ],
    });
    return `**Data quality — ${out.total_clients} active clients**\n\n| Gap | Clients |\n| --- | ---: |\n| Missing / pending KYC | ${out.missing_kyc} |\n| No nominee | ${out.missing_nominee} |\n| No RM assigned | ${out.missing_rm} |\n| No city on file | ${out.missing_city} |\n| Dormant (180+ days) | ${out.dormant} |${chart ? `\n\n${chart}` : ""}\n\n[Open Clients](/dashboard/investors)`;
  },

  // ---- Business trend (month by month) ----
  async (ctx, q) => {
    if (!/\b(trend|monthly|month[- ]by[- ]month|over\s+(the\s+)?(last|past)|last\s+\d+\s+months?|graph|chart)\b/i.test(q)) return null;
    if (!/\b(business|sales|net|booked|inflow|lumpsum|redemption)\b/i.test(q)) return null; // business trend only (AUM/SIP history TBD)
    const mm = q.match(/\b(\d{1,2})\s*months?\b/i);
    const months = mm ? Math.min(Number(mm[1]), 24) : /\b(year|12\s*months|annual)\b/i.test(q) ? 12 : 6;
    const out = await runAssistantTool(ctx, "get_business_trend", { months });
    if (out?.error || !out?.months?.length) return null;
    const rows = out.months
      .map((r: any) => `| ${r.label} | ${inr(r.sip_added_inr)} | ${inr(r.lumpsum_inr)} | ${inr(r.redemption_inr)} | ${inr(r.net_business_inr)} |`)
      .join("\n");
    const chart = chartFence({
      type: "line", title: "Net business by month", format: "inr",
      data: out.months.map((r: any) => ({ label: String(r.label).replace(/ \d{4}$/, ""), value: r.net_business_inr })),
    });
    return `**Business trend — last ${out.months.length} months**\n\n| Month | SIP added | Lumpsum | Redemption | Net |\n| --- | ---: | ---: | ---: | ---: |\n${rows}${chart ? `\n\n${chart}` : ""}\n\n[Open Reports](/dashboard/reports)`;
  },

  // ---- AUM / SIP-book trend over time (from daily snapshots) ----
  async (ctx, q) => {
    if (!/\b(aum|assets|sip\s*book|corpus)\b/i.test(q)) return null;
    if (!/\b(trend|over\s+(the\s+)?(time|last|past|months?)|history|grow(th|n|ing)?|month[- ]by[- ]month|monthly|graph|chart|last\s+\d+\s+months?)\b/i.test(q)) return null;
    const mm = q.match(/\b(\d{1,2})\s*months?\b/i);
    const months = mm ? Math.min(Number(mm[1]), 24) : /\b(year|12\s*months|annual)\b/i.test(q) ? 12 : 6;
    const out = await runAssistantTool(ctx, "get_aum_trend", { months });
    if (out?.error) return null;
    const wantsSip = /\bsip\b/i.test(q);
    if (!out.months?.length || out.months.length < 2) {
      return `I'm still building your ${wantsSip ? "SIP-book" : "AUM"} history — snapshots record daily, so the trend needs a few days to fill in (currently ${out.days_recorded ?? 0} recorded). Meanwhile, your live figures are in the top cards on the dashboard. [Open Reports](/dashboard/reports)`;
    }
    const rows = out.months.map((r: any) => `| ${r.label} | ${inr(r.aum_inr)} | ${inr(r.monthly_sip_inr)} |`).join("\n");
    const chart = chartFence({
      type: "line",
      title: wantsSip ? "Monthly SIP book over time" : "AUM over time",
      format: "inr",
      data: out.months.map((r: any) => ({ label: String(r.label).replace(/ \d{4}$/, ""), value: wantsSip ? r.monthly_sip_inr : r.aum_inr })),
    });
    return `**${wantsSip ? "SIP book" : "AUM"} trend — last ${out.months.length} months**\n\n| Month | AUM | SIP/mo |\n| --- | ---: | ---: |\n${rows}${chart ? `\n\n${chart}` : ""}\n\n[Open Reports](/dashboard/reports)`;
  },

  // ---- RM performance scorecard ----
  async (ctx, q) => {
    if (!/\b(rm|relationship\s+manager|advisor|team)\b/i.test(q)) return null;
    if (!/\b(performance|scorecard|productivity|compare|comparison|ranking|leaderboard|how\s+are\s+my|book)\b/i.test(q)) return null;
    const out = await runAssistantTool(ctx, "get_rm_performance", {});
    if (out?.error || !out?.rms?.length) return null;
    const rows = out.rms.map((r: any) => `| ${r.rm} | ${r.clients} | ${inr(r.aum_inr)} | ${r.monthly_sip_inr ? inr(r.monthly_sip_inr) : "—"} | ${r.dormant} | ${r.kyc_pending} |`).join("\n");
    const chart = chartFence({ type: "hbar", title: "AUM by RM", format: "inr", data: out.rms.map((r: any) => ({ label: String(r.rm), value: r.aum_inr })) });
    return `**RM performance**\n\n| RM | Clients | AUM | SIP/mo | Dormant | KYC pending |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${rows}${chart ? `\n\n${chart}` : ""}\n\n[Open Business MIS](/dashboard/reports/business-mis)`;
  },

  // ---- Draft a customer message (email / WhatsApp / SMS) — read-only, never sends ----
  (_ctx, q, m) => {
    const verb = /\b(draft|write|compose|create|prepare)\b/i.test(q);
    const channelOrMsg = /\b(email|e-mail|mail|whatsapp|wa\b|sms|text|message|msg|note|reply|greeting|wish)\b/i.test(q);
    if (!verb || !channelOrMsg) return null;
    return draftMessage(q, { userName: m.userName, firmName: m.firmName });
  },

  // ---- Snapshot-backed metric answers (instant, no tool call) ----
  (_ctx, q, m) => {
    const s = m.snapshot as any;
    // AUM total
    if (/\b(aum|assets under)\b/i.test(q) && !/\bby|per\b/i.test(q))
      return `Your total **AUM is ${inr(s.total_aum_inr)}** across **${s.active_clients}** active clients (avg ${inr(s.avg_aum_per_client_inr)} per client). [Open Clients](/dashboard/investors)`;
    // Top clients (no filter) — handled by list matcher, but keep a snapshot shortcut
    if (/\b(top|biggest|largest)\b/i.test(q) && /\bclients?\b/i.test(q) && (s.top_clients_by_aum?.length)) {
      const top = s.top_clients_by_aum.slice(0, extractN(q));
      const rows = top.map((t: any, i: number) => `| ${i + 1} | ${t.name} | ${inr(t.aum_inr)} |`).join("\n");
      const chart = chartFence({ type: "hbar", title: "Top clients by AUM", format: "inr", data: top.map((t: any) => ({ label: String(t.name), value: t.aum_inr })) });
      return `**Top clients by AUM**\n\n| # | Client | AUM |\n| ---: | --- | ---: |\n${rows}${chart ? `\n\n${chart}` : ""}\n\n[Open Clients](/dashboard/investors)`;
    }
    if (/\bkyc\b/i.test(q)) {
      const rows = (s.kyc_status_breakdown ?? []).map((k: any) => `| ${k.status} | ${k.clients} |`).join("\n");
      return `**${s.kyc_pending_clients}** clients are KYC-pending.\n\n| KYC status | Clients |\n| --- | ---: |\n${rows}\n\n[KYC tracker](/dashboard/reports/kyc-tracker)`;
    }
    if (/\bnominee\b/i.test(q)) return `**${s.clients_without_nominee}** clients have no nominee on file — a transmission risk. [Open Clients](/dashboard/investors)`;
    if (/\bdormant|inactive\b/i.test(q)) return `**${s.dormant_clients}** clients are dormant (no transaction in ${s.dormancy_window_days} days). [Churn-risk radar](/dashboard/reports/churn-risk)`;
    if (/\bsip\b/i.test(q)) return `You have **${s.active_sips}** active SIPs — a monthly SIP book of **${inr(s.monthly_sip_book_inr)}**. [Open SIPs](/dashboard/sips)`;
    if (/\blead/i.test(q)) return `**${s.open_leads}** open leads in your pipeline. [Open Leads](/dashboard/leads)`;
    if (/\btask/i.test(q)) return `**${s.open_tasks}** open tasks (**${s.overdue_tasks}** overdue). [Open Tasks](/dashboard/tasks)`;
    if (/\binsurance|policy|policies|premium\b/i.test(q)) return `**${s.active_insurance_policies}** active policies — ${inr(s.active_insurance_annual_premium_inr)} annual premium. [Open Insurance](/dashboard/insurance)`;
    if (/\bmeeting|review\b/i.test(q)) return `**${s.upcoming_meetings}** upcoming meetings scheduled. [Open Meetings](/dashboard/review-meetings)`;
    if (/\bnew\s+clients?|onboard/i.test(q)) return `**${s.new_clients_this_month}** new clients this month (${s.new_clients_last_30d} in the last 30 days). [Open Clients](/dashboard/investors)`;
    if (/\bhni\b/i.test(q)) return `You have **${s.hni_clients}** HNI clients. [Open Clients](/dashboard/investors)`;
    if (/\b(how many|total|count)\b.*\bclients?\b/i.test(q) || /\bclients?\b.*\b(count|total)\b/i.test(q))
      return `You have **${s.active_clients}** active clients, holding **${inr(s.total_aum_inr)}** AUM. [Open Clients](/dashboard/investors)`;
    return null;
  },
];

// Intent name per matcher (SAME ORDER) — used for the learning log + learned routing.
const INTENT_NAMES = ["greeting", "thanks", "help", "howto", "customer_360", "client_list", "breakdown", "business", "birthdays", "renewals", "meetings", "data_quality", "trend", "aum_trend", "rm_performance", "draft", "metric"];
const BY_INTENT = new Map<string, Matcher>(MATCHERS.map((fn, i) => [INTENT_NAMES[i], fn]));

// Intents that should NEVER become a chat title (greetings, refusals, help).
const NON_TITLE_INTENTS = new Set(["greeting", "thanks", "help", "refusal"]);

/**
 * A clean chat title from a substantive question. Returns null for greetings,
 * refusals and other non-topical parts — so a chat that opens with "hi" keeps
 * "New chat" until the first real question, and titles never read as "hi".
 */
export function suggestTitle(question: string, intent: string | null): string | null {
  if (intent && NON_TITLE_INTENTS.has(intent)) return null;
  let s = question.trim().replace(/\s+/g, " ").replace(/[?!.\s]+$/, "");
  if (s.length < 2) return null;
  // Pure greeting / filler even if the matcher didn't tag it.
  if (/^(hi+|hey+|hello+|yo+|hii+|namaste|hola|thanks?|thank\s*you|ok(ay)?|cool|nice|great|sup|yes|no)\b/i.test(s) && s.length < 24) return null;
  if (s.length > 52) s = s.slice(0, 52).trim() + "…";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Split a message into independent asks ("A · B · C" / newlines / semicolons). */
function splitParts(q: string): string[] {
  return q
    .split(/\s*[·•;\n]+\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length > 1);
}

async function answerOne(ctx: AssistantCtx, part: string, meta: Meta): Promise<{ text: string; intent: string } | null> {
  // Scope gate FIRST: off-topic asks are refused (never tooled, never learned);
  // investment-advice asks get the compliant "authorised advisor" decline. Any
  // CRM/business signal keeps the request in scope for the matchers below.
  const scope = classifyScope(part);
  if (scope === "out_of_scope") return { text: REFUSAL_TEXT, intent: "refusal" };
  if (scope === "investment_advice") return { text: ADVICE_TEXT, intent: "refusal" };

  const q = part.toLowerCase();
  for (let i = 0; i < MATCHERS.length; i++) {
    const r = await MATCHERS[i](ctx, q, meta);
    if (r) return { text: r, intent: INTENT_NAMES[i] };
  }
  return null;
}

/**
 * Answer entirely locally. `handled` is true when every part was answered (safe
 * to skip the LLM); false means at least one part fell through. `log` records
 * each part's outcome for the learning loop. `learnedIntent` (optional) lets a
 * new phrasing the fixed rules miss borrow the intent of a similar past question
 * — the copilot's memory-based learning.
 */
export async function answerLocally(
  ctx: AssistantCtx,
  opts: {
    question: string;
    userName: string;
    firmName: string;
    snapshot: FirmSnapshot;
    learnedIntent?: (part: string) => Promise<string | null>;
  }
): Promise<{ text: string; handled: boolean; log: LogRow[]; title: string | null }> {
  const meta: Meta = { userName: opts.userName, firmName: opts.firmName, snapshot: opts.snapshot };
  const parts = splitParts(opts.question);
  const sections: string[] = [];
  const log: LogRow[] = [];
  let missed = false;
  let title: string | null = null;

  for (const part of parts) {
    let res = await answerOne(ctx, part, meta);
    let source = "engine";
    // Learned routing: the fixed rules missed, but a similar past question was
    // handled — reuse its intent (and re-extract entities from THIS wording).
    if (!res && opts.learnedIntent) {
      const learned = await opts.learnedIntent(part);
      const fn = learned ? BY_INTENT.get(learned) : undefined;
      if (fn) {
        const text = await fn(ctx, part.toLowerCase(), meta);
        if (text) {
          res = { text, intent: learned! };
          source = "engine_learned";
        }
      }
    }
    if (res) {
      sections.push(res.text);
      if (title === null) title = suggestTitle(part, res.intent);
      log.push({ question: part, handled: true, intent: res.intent, source });
    } else {
      missed = true;
      log.push({ question: part, handled: false, intent: null, source: "miss" });
    }
  }

  if (title === null) title = suggestTitle(opts.question, null);

  if (sections.length === 0) {
    const text = pick([
      `Hmm, I couldn't pull that from your CRM yet, ${opts.userName}. I'm best with things like *"top 10 clients by AUM"*, *"AUM by segment"*, or *"renewals due in 30 days"* — want to try one of those?`,
      `I didn't quite catch that one, ${opts.userName}. Try asking about clients, AUM, SIPs, KYC, tasks, insurance, meetings or business — e.g. *"dormant clients"* or *"net business this month"*.`,
      `That's a bit outside what I can pull right now, ${opts.userName}. I can help with clients, business, tasks, leads, insurance and reports — for example *"HNI clients with SIP over ₹10,000"* or *"business trend last 6 months"*.`,
    ]);
    return { text, handled: false, log, title };
  }

  return { text: sections.join("\n\n---\n\n"), handled: !missed, log, title };
}
