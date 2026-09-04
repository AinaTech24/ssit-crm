/**
 * AI Assistant — Tier 1 (smart search + draft assist).
 *
 * Two capabilities:
 *   1. NL → FilterAST: "Show me HNI clients in Mumbai with no contact in
 *      60 days" → produces a valid FilterAST that compiles against the
 *      catalog. The compiler is the safety net — anything the model
 *      hallucinates that isn't in the catalog gets rejected.
 *
 *   2. Draft assist: in template designer, "make this warmer" or "add a
 *      mandate-failure CTA" returns updated text. Output passes through the
 *      same compliance gate before showing — model never bypasses rules.
 */

import { aiMessagesClient, isAiConfigured } from "@/lib/ai/provider";
import { FilterASTSchema, type FilterAST } from "@/lib/filter/ast";
import { CATALOGS } from "@/lib/filter/catalog";
import { POLICY_TYPES, PREMIUM_FREQUENCIES } from "@/db/schema/insurance";

// Model TIERS, not concrete names — the active provider (Anthropic / Gemini,
// switchable from Equitywala Admin) maps each tier to its configured model.
const FAST_MODEL = "fast";
const REASONING_MODEL = "reasoning";

// Provider-agnostic client. `.messages.create({ model: FAST_MODEL|REASONING_MODEL, … })`
// returns the Anthropic-shaped `{ content: [{ type:'text', text }] }`, so every
// call site below is unchanged regardless of which provider is active.
function client() {
  return aiMessagesClient();
}

/**
 * Robustly parse a JSON object/array out of an LLM response. Tolerates code
 * fences, leading/trailing prose, and (best-effort) a truncated tail by
 * balancing open brackets/strings. Throws a clean, user-facing message — never
 * a raw "Unterminated string in JSON…" / "Unexpected token…" SyntaxError, and
 * never a cryptic "Cannot read properties of undefined" downstream.
 *
 * Pair this with `responseFormat: "json"` on the create() call so the provider
 * emits a single well-formed JSON value in the first place; this is the safety
 * net for the rare truncated/garbled response.
 */
function parseAiJson<T = any>(raw: string): T {
  if (!raw || !raw.trim()) {
    throw new Error("The AI returned an empty response. Please try again.");
  }
  // Strip a leading ```json / ``` fence and a trailing ``` fence if present.
  let s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  // Slice from the first { or [ (drop any preamble the model added).
  const start = s.search(/[[{]/);
  if (start > 0) s = s.slice(start);
  try {
    return JSON.parse(s) as T;
  } catch {
    /* fall through to repair */
  }
  try {
    return JSON.parse(repairTruncatedJson(s)) as T;
  } catch {
    throw new Error("The AI returned an incomplete response. Please try again.");
  }
}

/** Best-effort close of a JSON value truncated mid-stream (open string + brackets). */
function repairTruncatedJson(s: string): string {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") stack.pop();
  }
  let out = s;
  if (inStr) out += '"'; // close a dangling string value
  out = out.replace(/\\+$/, ""); // drop a trailing escape
  out = out.replace(/,\s*$/, ""); // drop a dangling comma
  out = out.replace(/:\s*$/, ": null"); // dangling "key": → give it a value
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === "{" ? "}" : "]";
  return out;
}

/* ============================================================================
 * Insurance policy document → structured auto-fill
 * ============================================================================
 * Reads an uploaded policy PDF / image and extracts the fields our insurance
 * form needs, mapped to our own schema (policy-type enum, premium frequency,
 * ISO dates). Advisory only — the route persists nothing; the RM reviews every
 * field (low-confidence ones are flagged) before saving. Mirrors the Sanchay
 * "Upload Policy Document → Auto-Fills in ~15s" flow but lands in our model.
 */

export type InsuranceCategory = "life" | "health" | "motor" | "general";

export type InsuranceExtraction = {
  insurer: string | null;
  planName: string | null;
  policyNumber: string | null;
  policyType: (typeof POLICY_TYPES)[number] | null;
  category: InsuranceCategory | null;
  sumAssured: number | null;
  annualPremium: number | null;
  premiumFrequency: (typeof PREMIUM_FREQUENCIES)[number] | null;
  premiumPayingTermYears: number | null;
  policyTermYears: number | null;
  policyStartDate: string | null;
  maturityDate: string | null;
  nextPremiumDueDate: string | null;
  livesCovered: number | null;
  nomineeName: string | null;
  nomineeRelation: string | null;
  businessType: "new" | "renewal" | "portability" | null;
  proposerName: string | null;
  proposerPan: string | null;
  /** Category-specific extras (motor IDV/NCB, health co-pay/room-rent, etc.). */
  details: Record<string, unknown>;
  /** Per-field 0..1 confidence so the UI can highlight what to double-check. */
  fieldConfidence: Record<string, number>;
  overallConfidence: number;
  warnings: string[];
};

const CATEGORY_BY_POLICY_TYPE: Record<string, InsuranceCategory> = {
  term: "life",
  ulip: "life",
  endowment: "life",
  money_back: "life",
  life_other: "life",
  health: "health",
  critical_illness: "health",
  personal_accident: "general",
  motor: "motor",
  travel: "general",
  home: "general",
  general_other: "general",
};

/** Best-effort normalise a date string to ISO yyyy-mm-dd, else null. */
function toIsoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // dd/mm/yyyy or dd-mm-yyyy
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export async function extractInsurancePolicy(params: {
  base64: string;
  mediaType: "application/pdf" | "image/jpeg" | "image/png";
}): Promise<InsuranceExtraction | { error: string }> {
  const typeList = POLICY_TYPES.join(" | ");
  const freqList = PREMIUM_FREQUENCIES.join(" | ");

  const system = `You read an Indian insurance policy document (life / health / motor / general) and
extract its key fields for a Mutual Fund Distributor's CRM. Output a SINGLE JSON object — no markdown, no preamble.

Exact shape:
{
  "insurer": string|null,                 // insurance company, e.g. "HDFC Life", "Star Health"
  "planName": string|null,                // product/plan name, e.g. "Click 2 Protect Super"
  "policyNumber": string|null,
  "policyType": ${typeList} | null,       // map to the CLOSEST of these exact values
  "category": "life" | "health" | "motor" | "general" | null,
  "sumAssured": number|null,              // in rupees (for motor, use IDV); digits only
  "annualPremium": number|null,           // annualised premium in rupees, digits only
  "premiumFrequency": ${freqList} | null,
  "premiumPayingTermYears": number|null,
  "policyTermYears": number|null,
  "policyStartDate": "YYYY-MM-DD"|null,
  "maturityDate": "YYYY-MM-DD"|null,      // null for pure-protection/health/motor
  "nextPremiumDueDate": "YYYY-MM-DD"|null,
  "livesCovered": number|null,            // family-floater members; 1 for individual
  "nomineeName": string|null,
  "nomineeRelation": string|null,
  "businessType": "new" | "renewal" | "portability" | null,
  "proposerName": string|null,            // only if proposer differs from the life assured / holder
  "proposerPan": string|null,
  "details": { ... },                     // category-specific extras, see below
  "fieldConfidence": { "<field>": 0..1 }, // your confidence per field you filled
  "overallConfidence": 0..1,
  "warnings": [ "short notes about anything ambiguous or unreadable" ]
}

category-specific "details" keys:
  motor   → { "vehicleRegNo": string, "makeModel": string, "idv": number, "ncbPercent": number, "coverType": "comprehensive"|"third_party"|"od_only" }
  health  → { "roomRentCapInr": number, "coPayPercent": number, "preExistingWaitingMonths": number, "familyFloater": boolean }
  general → { "coverageNotes": string }
  life    → {} (the top-level fields cover it)

ALWAYS also fill these in "details" (any policy type) when present in the document — use null/omit if absent, NEVER guess:
  "holderName": string,            // policyholder / insured name
  "customerId": string,            // customer / client id
  "uin": string,                   // IRDAI UIN (e.g. BAJHLIP23143V012223)
  "email": string, "mobile": string,
  "addressLine1": string, "city": string, "state": string, "postalCode": string, "country": string,  // policyholder address; country "India" if Indian
  "proposerCustomerId": string, "proposerPhone": string, "proposerEmail": string,
  "proposerAddressLine1": string, "proposerCity": string, "proposerState": string, "proposerPostalCode": string,
  "proposerSameAddress": boolean,  // true if proposer address equals policyholder address
  "agencyCode": string, "agencyName": string, "agencyContact": string, "agencyEmail": string,
  "receiptNo": string, "receiptDate": "YYYY-MM-DD", "businessChannel": string, "paymentDetails": string,
  "taxInvoiceNo": string, "taxInvoiceDate": "YYYY-MM-DD", "gstin": string,
  "financialYear": string,         // e.g. "2025-2026"
  "eightyDAmount": number, "grossPremium": number,   // rupees, digits only

ALSO extract these TABLES into "details" as arrays of objects (empty array if not present) — one object per row, copy values EXACTLY as printed:
  "insuredMembers": [ { "name": string, "customerId": string, "planOpted": string, "gender": string, "dob": "YYYY-MM-DD", "age": string, "relation": string, "nominee": string } ],
  "sumInsuredCovers": [ { "memberName": string, "cover": string, "sumInsured": string, "limit": string } ],
  "optionalCovers": [ { "cover": string, "memberName": string, "sumInsured": string, "notes": string } ],
  "premiumBreakdown": [ { "description": string, "amount": string } ],
  "exclusions": [ { "memberName": string, "exclusion": string } ]

Rules:
- Use ONLY the listed enum values for policyType / premiumFrequency / businessType / coverType. If unsure, pick the closest and lower its confidence.
- Derive "category" from the policy type.
- Money: digits only (strip ₹ and commas). Dates: ISO yyyy-mm-dd.
- NEVER invent a value that isn't in the document — use null and add a warning instead.
- If the file is not an insurance policy, return all nulls, overallConfidence 0, and a warning saying so.
- Output ONLY the JSON object.`;

  const docBlock =
    params.mediaType === "application/pdf"
      ? {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: params.base64 },
        }
      : {
          type: "image",
          source: { type: "base64", media_type: params.mediaType, data: params.base64 },
        };

  try {
    const res = await client().messages.create({
      model: REASONING_MODEL,
      max_tokens: 4000,
      system,
      messages: [
        {
          role: "user",
          content: [docBlock as any, { type: "text", text: "Extract this policy into the JSON schema." }],
        },
      ],
    });
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    const json = text.replace(/^```(?:json)?\n?/, "").replace(/```$/, "").trim();
    const p = JSON.parse(json);

    const policyType = (POLICY_TYPES as readonly string[]).includes(p.policyType)
      ? (p.policyType as (typeof POLICY_TYPES)[number])
      : null;
    const category: InsuranceCategory | null =
      p.category === "life" || p.category === "health" || p.category === "motor" || p.category === "general"
        ? p.category
        : policyType
          ? CATEGORY_BY_POLICY_TYPE[policyType]
          : null;
    const premiumFrequency = (PREMIUM_FREQUENCIES as readonly string[]).includes(p.premiumFrequency)
      ? (p.premiumFrequency as (typeof PREMIUM_FREQUENCIES)[number])
      : null;
    const businessType =
      p.businessType === "new" || p.businessType === "renewal" || p.businessType === "portability"
        ? p.businessType
        : null;

    const conf: Record<string, number> = {};
    if (p.fieldConfidence && typeof p.fieldConfidence === "object") {
      for (const [k, v] of Object.entries(p.fieldConfidence)) {
        const n = Number(v);
        if (Number.isFinite(n)) conf[k] = Math.max(0, Math.min(1, n));
      }
    }

    return {
      insurer: p.insurer ? String(p.insurer).slice(0, 120) : null,
      planName: p.planName ? String(p.planName).slice(0, 200) : null,
      policyNumber: p.policyNumber ? String(p.policyNumber).slice(0, 60) : null,
      policyType,
      category,
      sumAssured: num(p.sumAssured),
      annualPremium: num(p.annualPremium),
      premiumFrequency,
      premiumPayingTermYears: num(p.premiumPayingTermYears),
      policyTermYears: num(p.policyTermYears),
      policyStartDate: toIsoDate(p.policyStartDate),
      maturityDate: toIsoDate(p.maturityDate),
      nextPremiumDueDate: toIsoDate(p.nextPremiumDueDate),
      livesCovered: num(p.livesCovered),
      nomineeName: p.nomineeName ? String(p.nomineeName).slice(0, 120) : null,
      nomineeRelation: p.nomineeRelation ? String(p.nomineeRelation).slice(0, 40) : null,
      businessType,
      proposerName: p.proposerName ? String(p.proposerName).slice(0, 120) : null,
      proposerPan: p.proposerPan ? String(p.proposerPan).slice(0, 10).toUpperCase() : null,
      details: p.details && typeof p.details === "object" ? p.details : {},
      fieldConfidence: conf,
      overallConfidence: Math.max(0, Math.min(1, Number(p.overallConfidence) || 0)),
      warnings: Array.isArray(p.warnings) ? p.warnings.map(String).slice(0, 8) : [],
    };
  } catch (err: any) {
    return { error: err?.message ?? "AI extraction error" };
  }
}

/**
 * Convert a natural-language query into a FilterAST.
 */
export async function nlToFilterAst(
  query: string,
  subject: "investor" | "lead" | "task",
  opts?: {
    /**
     * When true, ask the model for `{ ast, explanation }` (one plain-English
     * sentence) instead of a bare AST. Used by "Ask your book" so the advisor
     * sees how their question was interpreted. Default false — existing
     * callers (filter builder, smart search) are unchanged.
     */
    explain?: boolean;
  }
): Promise<{ ast: FilterAST; explanation: string } | { error: string }> {
  const catalog = CATALOGS[subject];
  // Give the model the full per-field context — enum values + the exact
  // operators each field allows — so it picks valid fields, ops and values
  // instead of guessing (which is what made "review due" return 0 rows).
  const fieldSummary = catalog.fields
    .map((f) => {
      const ev = f.enumValues?.length ? `; values: ${f.enumValues.join(" | ")}` : "";
      const ops = f.ops?.length ? `; ops: ${f.ops.join(", ")}` : "";
      return `  - "${f.key}" (${f.type}) — ${f.label}${ev}${ops}`;
    })
    .join("\n");
  const today = new Date().toISOString().slice(0, 10);

  const outputRule = opts?.explain
    ? `CRITICAL: use only field keys from the Fields list above. Output ONLY a JSON object of the exact shape { "ast": <the FilterAST>, "explanation": "<one plain-English sentence describing who this filter selects>" } — no markdown, no prose outside the JSON. (The examples above show the "ast" value only.)`
    : `CRITICAL: use only field keys from the Fields list above. Output ONLY the JSON AST — no markdown, no prose.`;

  const systemPrompt = `You translate a natural-language question about ${subject}s in an Indian Mutual-Fund-Distributor CRM into a JSON FilterAST that SELECTS the matching ${subject}s. Today's date is ${today}.

AST shape:
  { "type": "group", "op": "AND" | "OR", "not"?: boolean, "children": [ ...predicates or nested groups ] }
Predicate:
  { "type": "predicate", "field": { "kind": "attr", "path": "<field_key>" }, "op": "<operator>", "value": <value>, "duration"?: { "amount": <number>, "unit": "day"|"week"|"month"|"year" } }

For date_within / date_in_next / date_in_last provide a "duration". For enum fields use ONLY a value from that field's "values:" list. Use only an operator listed for that field.

Fields on ${subject} — use ONLY these keys (with their listed ops + enum values):
${fieldSummary}

Read business language into the right field (only use a field that appears in the list above for THIS subject):
- "review due / reviews pending / overdue for review / due for review" → days_to_review lte 0 (0 or negative = the review date has arrived/passed).
- "no contact / not contacted in N days" → days_since_last_contact gte N. "no transaction in N days" → days_since_last_transaction gte N.
- "HNI / high net worth" → aum gte 10000000 (₹1 crore); "ultra HNI" → aum gte 50000000.
- "dormant / inactive / lapsed / closed / at-risk" → the matching value of the status / health field.
- "in <city>" → city eq "<City>". "birthday / anniversary this month" → date_is_anniversary on the date-of-birth field.
- A "how many / count / number of X" question STILL means "select the X" — build the filter that selects them; the app counts the rows. Never return an error just because it says "how many".
- If there is no real condition (e.g. "all clients", "everyone"), return { "type": "group", "op": "AND", "children": [] }.

Examples:
Q: "how many clients have a review due"
A: {"type":"group","op":"AND","children":[{"type":"predicate","field":{"kind":"attr","path":"days_to_review"},"op":"lte","value":0}]}
Q: "HNI clients in Mumbai with no contact in 60 days"
A: {"type":"group","op":"AND","children":[{"type":"predicate","field":{"kind":"attr","path":"aum"},"op":"gte","value":10000000},{"type":"predicate","field":{"kind":"attr","path":"city"},"op":"eq","value":"Mumbai"},{"type":"predicate","field":{"kind":"attr","path":"days_since_last_contact"},"op":"gte","value":60}]}

${outputRule}`;

  if (!(await isAiConfigured())) {
    return { error: "AI isn't set up yet. Ask your admin to configure the AI provider + model under Settings → AI & Models." };
  }

  try {
    const result = await client().messages.create({
      model: FAST_MODEL,
      max_tokens: 3072,
      system: systemPrompt,
      responseFormat: "json",
      messages: [{ role: "user", content: query }],
    });
    const text = ((result as any)?.content ?? [])
      .filter((b: any) => b && b.type === "text")
      .map((b: any) => b.text ?? "")
      .join("\n")
      .trim();
    if (!text) {
      return {
        error:
          'The AI couldn\'t build a filter for that. Try rephrasing — e.g. "HNI clients in Mumbai with no contact in 60 days".',
      };
    }

    const parsed = parseAiJson<any>(text);
    // In explain mode the model wraps the AST as { ast, explanation }; tolerate
    // a bare AST (and vice-versa) so a shape mix-up never breaks parsing.
    const rawAst =
      parsed && typeof parsed === "object" && !Array.isArray(parsed) && "ast" in parsed ? parsed.ast : parsed;
    const ast = FilterASTSchema.safeParse(rawAst);
    if (!ast.success) {
      return { error: `Generated AST failed schema validation: ${ast.error.issues.map((i) => i.message).join("; ")}` };
    }
    const explanation =
      opts?.explain && typeof parsed?.explanation === "string" && parsed.explanation.trim()
        ? parsed.explanation.trim().slice(0, 300)
        : `Translated to ${subject} filter.`;
    return { ast: ast.data, explanation };
  } catch (err: any) {
    // Log the real error+stack so a recurring failure is diagnosable in prod
    // logs, but never surface a cryptic "Cannot read properties of undefined
    // (reading 'type')" to the user — turn it into something actionable.
    console.error("[ai] nlToFilterAst failed:", err?.stack || err?.message || err);
    const raw = String(err?.message ?? "AI error");
    const cryptic = /cannot read propert|undefined|null|is not a function/i.test(raw);
    return {
      error: cryptic
        ? "The AI returned an unexpected response. Please try again — if it keeps failing, check the AI provider + model under Settings → AI & Models."
        : raw,
    };
  }
}

/**
 * Draft a message in template designer.
 * Returns text — caller is responsible for running compliance gate before showing.
 */
export async function draftMessage(params: {
  channel: "whatsapp" | "email" | "sms";
  intent: string;
  audienceContext?: string;
  variables?: string[];
  /** Optional tone/theme for the message voice (Smart-search drafter dropdown). */
  theme?: string;
}): Promise<{ text: string } | { error: string }> {
  const variableHint = params.variables?.length
    ? `Use these variables as {{key}}: ${params.variables.join(", ")}`
    : "Use {{name}} for the recipient name.";

  // Map the chosen theme to a concrete tone instruction for the model.
  const THEME_TONE: Record<string, string> = {
    professional: "Tone: professional and clear.",
    friendly: "Tone: friendly and conversational, like a trusted advisor.",
    concise: "Tone: crisp and concise — keep it short and to the point.",
    warm: "Tone: warm and reassuring; acknowledge the client's situation.",
    festive: "Tone: festive and celebratory (suitable for a greeting / festival wish).",
    urgent: "Tone: clear and action-oriented, conveying that prompt action is needed (without alarmist or pressuring language).",
    educational: "Tone: educational and explanatory; teach the concept simply.",
  };
  const toneLine = params.theme && THEME_TONE[params.theme] ? `\n${THEME_TONE[params.theme]}` : "";

  const systemPrompt = `You draft compliance-safe ${params.channel} messages for Indian Mutual Fund Distributors.

Rules:
- NEVER promise returns ("guaranteed", "assured", "X% returns")
- NEVER recommend a specific scheme (AMFI Code of Conduct 4(k))
- DO end with the mandatory line: "Mutual fund investments are subject to market risks. Read all scheme related documents carefully."
- DO mention "ARN-{{arn_no}}" and the firm name
- Keep it warm but professional. Indian context.${toneLine}

${variableHint}

Output ONLY the message text — no explanations.`;

  try {
    const result = await client().messages.create({
      model: REASONING_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: params.intent }],
    });
    const text = result.content
      .filter((b) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    return { text };
  } catch (err: any) {
    return { error: err.message ?? "AI error" };
  }
}

/* ============================================================================
 * Sprint 2 — AI quick wins
 * ============================================================================
 * Five MFD-specific helpers that wrap Claude with carefully constrained
 * prompts. Each returns either a structured payload or { error }. None of
 * them write to the DB — callers persist the result if the RM accepts it.
 * That keeps AI advisory (not authoritative) and avoids audit-trail blur.
 */

/**
 * Summarise a review meeting from raw RM notes.
 * Returns key points / decisions / action items / next steps.
 */
export async function summariseMeeting(params: {
  notes: string;
  agenda?: string;
  meetingType?: string;
  durationMinutes?: number;
  clientName?: string;
}): Promise<
  | {
      summary: string;
      keyPoints: string[];
      decisions: string[];
      actionItems: Array<{ title: string; owner?: string; dueHint?: string }>;
      nextSteps: string[];
    }
  | { error: string }
> {
  const ctx = [
    params.clientName ? `Client: ${params.clientName}` : null,
    params.meetingType ? `Type: ${params.meetingType}` : null,
    params.durationMinutes ? `Duration: ${params.durationMinutes} min` : null,
    params.agenda ? `Pre-meeting agenda:\n${params.agenda}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const system = `You summarise client review meetings for Indian Mutual Fund Distributors.

Output a JSON object with this exact shape:
{
  "summary": "2-3 sentence executive summary",
  "keyPoints": ["bullet…", "bullet…"],
  "decisions": ["client agreed to X", …],
  "actionItems": [{ "title": "…", "owner": "RM|Client|Ops", "dueHint": "this week|next month|…" }],
  "nextSteps": ["follow up in 30 days on Y", …]
}

Rules:
- NEVER invent facts the notes don't support.
- NEVER recommend a specific scheme (AMFI 4(k)).
- Keep each bullet under 18 words.
- If the notes are too thin to extract a section, return an empty array for it.
- Output ONLY the JSON object — no markdown, no preamble.`;

  try {
    const res = await client().messages.create({
      model: REASONING_MODEL,
      max_tokens: 1500,
      system,
      messages: [
        {
          role: "user",
          content: `${ctx}\n\nMeeting notes:\n${params.notes}`,
        },
      ],
    });
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    const json = text.replace(/^```(?:json)?\n?/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(json);
    // Light defensive coercion
    return {
      summary: String(parsed.summary ?? ""),
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.map(String) : [],
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions.map(String) : [],
      actionItems: Array.isArray(parsed.actionItems)
        ? parsed.actionItems
            .filter((a: any) => a && typeof a === "object" && a.title)
            .map((a: any) => ({
              title: String(a.title),
              owner: a.owner ? String(a.owner) : undefined,
              dueHint: a.dueHint ? String(a.dueHint) : undefined,
            }))
        : [],
      nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps.map(String) : [],
    };
  } catch (err: any) {
    return { error: err?.message ?? "AI error" };
  }
}

/**
 * Score a lead 0-100 based on observed engagement + profile signals.
 * Returns score + hot/warm/cold band + 1-2 sentence reasoning + suggested
 * next action. Deterministic in that we instruct the model to be
 * conservative — bandable signal beats a confident hunch.
 */
export async function scoreLead(params: {
  name: string;
  source?: string;
  stage?: string;
  ageInStageDays?: number;
  lastTouchDaysAgo?: number;
  callsCount?: number;
  meetingsCount?: number;
  emailOpens?: number;
  whatsappReplies?: number;
  estimatedAumInr?: number;
  notes?: string;
}): Promise<
  | {
      score: number;
      band: "hot" | "warm" | "cold";
      reasoning: string;
      nextAction: string;
    }
  | { error: string }
> {
  const sig = [
    `Name: ${params.name}`,
    params.source ? `Source: ${params.source}` : null,
    params.stage ? `Stage: ${params.stage}` : null,
    params.ageInStageDays != null ? `Age in stage: ${params.ageInStageDays} days` : null,
    params.lastTouchDaysAgo != null ? `Last touch: ${params.lastTouchDaysAgo} days ago` : null,
    params.callsCount != null ? `Calls: ${params.callsCount}` : null,
    params.meetingsCount != null ? `Meetings: ${params.meetingsCount}` : null,
    params.emailOpens != null ? `Email opens: ${params.emailOpens}` : null,
    params.whatsappReplies != null ? `WhatsApp replies: ${params.whatsappReplies}` : null,
    params.estimatedAumInr != null
      ? `Est. AUM: ₹${Math.round(params.estimatedAumInr).toLocaleString("en-IN")}`
      : null,
    params.notes ? `Notes:\n${params.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const system = `You score Indian MFD leads conservatively.

Output a JSON object with this exact shape:
{
  "score": <integer 0-100>,
  "band": "hot" | "warm" | "cold",
  "reasoning": "1-2 sentences citing the specific signals",
  "nextAction": "single concrete action the RM should take next"
}

Band guidance:
  hot   = score >= 70 (strong engagement, recent touch, real intent signal)
  warm  = 40-69 (some signal, needs nurture)
  cold  = < 40 (stale, low signal — recommend re-qualify or close)

Penalise: long time-in-stage with no movement, > 30 days no touch, zero replies.
Reward: meeting attended, WhatsApp replies, high estimated AUM, fresh referral source.
Never invent signals. If data is missing, score conservatively (closer to cold).
Output ONLY the JSON object.`;

  try {
    const res = await client().messages.create({
      model: FAST_MODEL,
      max_tokens: 500,
      system,
      messages: [{ role: "user", content: sig }],
    });
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    const json = text.replace(/^```(?:json)?\n?/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(json);
    const rawScore = Number(parsed.score ?? 0);
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));
    const band: "hot" | "warm" | "cold" =
      parsed.band === "hot" || parsed.band === "warm" || parsed.band === "cold"
        ? parsed.band
        : score >= 70
          ? "hot"
          : score >= 40
            ? "warm"
            : "cold";
    return {
      score,
      band,
      reasoning: String(parsed.reasoning ?? ""),
      nextAction: String(parsed.nextAction ?? ""),
    };
  } catch (err: any) {
    return { error: err?.message ?? "AI error" };
  }
}

/**
 * Suggest a retention play for an at-risk client. Fed the churn score + the
 * explainable factors from the scorecard, returns a concrete next-best-action
 * the RM can execute today. Advisory only — the deterministic score is the
 * source of truth; this just helps the RM act on it.
 */
export async function suggestRetention(params: {
  name: string;
  score: number;
  band: "low" | "medium" | "high";
  factors: Array<{ label: string; why: string }>;
  serviceTier?: string | null;
  currentValueInr?: number | null;
}): Promise<
  | {
      summary: string;
      talkingPoints: string[];
      actions: string[];
      suggestedChannel: "call" | "whatsapp" | "email" | "meeting";
    }
  | { error: string }
> {
  const sig = [
    `Client: ${params.name}`,
    `Churn risk score: ${params.score}/100 (${params.band})`,
    params.serviceTier ? `Service tier: ${params.serviceTier}` : null,
    params.currentValueInr != null
      ? `Portfolio value: ₹${Math.round(params.currentValueInr).toLocaleString("en-IN")}`
      : null,
    "Risk factors:",
    ...params.factors.map((f) => `- ${f.label} (${f.why})`),
  ]
    .filter(Boolean)
    .join("\n");

  const system = `You advise an Indian Mutual Fund Distributor (MFD) on RETAINING an at-risk client.

You are given a transparent churn-risk score and the specific factors driving it.
Recommend a practical, compliant retention play. SEBI rules: no assured returns,
no paid inducements to stay, no disparaging other products. Lead with empathy and
genuine service, not a hard sell.

Output a JSON object with this exact shape:
{
  "summary": "1-2 sentences on the core retention angle, citing the factors",
  "talkingPoints": ["2-4 short talking points the RM can use in the conversation"],
  "actions": ["2-4 concrete next steps, e.g. 'book a portfolio review', 'restart a small SIP'"],
  "suggestedChannel": "call" | "whatsapp" | "email" | "meeting"
}

Prioritise the biggest factor. For redemptions/negative returns, lead with a
portfolio review + goal re-anchoring. For silence/dormancy, lead with a warm
check-in. For SIP stops, understand the cashflow reason before re-pitching.
Output ONLY the JSON object.`;

  try {
    const res = await client().messages.create({
      model: REASONING_MODEL,
      max_tokens: 700,
      system,
      messages: [{ role: "user", content: sig }],
    });
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    const json = text.replace(/^```(?:json)?\n?/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(json);
    const ch = parsed.suggestedChannel;
    return {
      summary: String(parsed.summary ?? ""),
      talkingPoints: Array.isArray(parsed.talkingPoints) ? parsed.talkingPoints.map(String).slice(0, 5) : [],
      actions: Array.isArray(parsed.actions) ? parsed.actions.map(String).slice(0, 5) : [],
      suggestedChannel:
        ch === "call" || ch === "whatsapp" || ch === "email" || ch === "meeting" ? ch : "call",
    };
  } catch (err: any) {
    return { error: err?.message ?? "AI error" };
  }
}

/**
 * Triage an inbound WhatsApp message from a client: classify intent + urgency
 * and DRAFT a reply for the RM to review and send. Human-in-the-loop by design —
 * we never auto-send unreviewed AI text to a client (SEBI: no assured returns,
 * no advice without context). The draft is a starting point the RM edits.
 */
export async function triageInboundMessage(params: {
  text: string;
  investorName?: string | null;
}): Promise<
  | {
      intent: string;
      urgency: "low" | "normal" | "high";
      suggestedReply: string;
    }
  | { error: string }
> {
  const system = `You triage an inbound WhatsApp message a client sent to their Indian Mutual Fund
Distributor (MFD), and draft a reply the human advisor will review before sending.

Output a JSON object with this exact shape:
{
  "intent": "short label, e.g. 'redemption request', 'statement request', 'SIP query', 'complaint', 'greeting'",
  "urgency": "low" | "normal" | "high",
  "suggestedReply": "a warm, concise WhatsApp reply (<= 60 words) the advisor can send"
}

Rules for suggestedReply:
- NEVER promise returns, guarantee performance, or give specific buy/sell advice.
- For transactions (redemption/switch/new investment), acknowledge + say the advisor will assist, don't execute.
- For complaints, be empathetic + assure escalation.
- Keep it human and brief. No disclaimers needed (the platform appends them).
urgency "high" for complaints, redemptions, or anything time-sensitive.
Output ONLY the JSON object.`;

  try {
    const res = await client().messages.create({
      model: FAST_MODEL,
      max_tokens: 400,
      system,
      messages: [
        {
          role: "user",
          content: `${params.investorName ? `From client: ${params.investorName}\n` : ""}Message: ${params.text.slice(0, 2000)}`,
        },
      ],
    });
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    const json = text.replace(/^```(?:json)?\n?/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(json);
    const u = parsed.urgency;
    return {
      intent: String(parsed.intent ?? "message"),
      urgency: u === "high" || u === "low" ? u : "normal",
      suggestedReply: String(parsed.suggestedReply ?? ""),
    };
  } catch (err: any) {
    return { error: err?.message ?? "AI error" };
  }
}

/**
 * Summarise a pasted AMFI/SEBI/CBDT circular into a distributor-friendly digest:
 * a plain-English summary, the concrete actions an MFD must take, a category and
 * a severity. Helps Equitywala / the MFD turn dense regulator PDFs into the
 * amfi_circulars digest entries.
 */
export async function summariseCircular(params: {
  text: string;
  issuerHint?: string;
}): Promise<
  | {
      title: string;
      summary: string;
      mfdActions: string[];
      category: string;
      severity: "info" | "action_required" | "critical";
    }
  | { error: string }
> {
  const system = `You turn an Indian mutual-fund regulatory circular (AMFI / SEBI / RBI / CBDT)
into a concise digest for a Mutual Fund Distributor (MFD).

Output a JSON object with this exact shape:
{
  "title": "short headline (<= 90 chars)",
  "summary": "2-4 sentences in plain English — what changed and who it affects",
  "mfdActions": ["2-5 concrete actions the distributor must take"],
  "category": "one of: KYC, Nomination, Disclosure, Commission, Taxation, Onboarding, Reporting, Other",
  "severity": "info" | "action_required" | "critical"
}

severity: "critical" if it blocks transactions or has a hard near-term deadline;
"action_required" if the MFD must do something; "info" otherwise.
Be accurate to the text — do NOT invent deadlines or requirements not stated.
Output ONLY the JSON object.`;

  try {
    const res = await client().messages.create({
      model: REASONING_MODEL,
      max_tokens: 800,
      system,
      messages: [
        {
          role: "user",
          content: `${params.issuerHint ? `Likely issuer: ${params.issuerHint}\n\n` : ""}Circular text:\n${params.text.slice(0, 12000)}`,
        },
      ],
    });
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    const json = text.replace(/^```(?:json)?\n?/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(json);
    const sev = parsed.severity;
    return {
      title: String(parsed.title ?? "").slice(0, 120),
      summary: String(parsed.summary ?? ""),
      mfdActions: Array.isArray(parsed.mfdActions) ? parsed.mfdActions.map(String).slice(0, 6) : [],
      category: String(parsed.category ?? "Other"),
      severity: sev === "critical" || sev === "action_required" ? sev : "info",
    };
  } catch (err: any) {
    return { error: err?.message ?? "AI error" };
  }
}

/**
 * Generate 3 campaign concepts for a given segment.
 */
export async function generateCampaignIdeas(params: {
  segmentName: string;
  subject: "investor" | "lead";
  segmentDescription?: string;
  sampleSize?: number;
  fieldsSummary?: string;
}): Promise<
  | {
      ideas: Array<{
        title: string;
        objective: string;
        channels: Array<"whatsapp" | "email" | "sms">;
        tone: string;
        suggestedTriggers: string[];
        sampleMessage: string;
      }>;
    }
  | { error: string }
> {
  const ctx = [
    `Segment: ${params.segmentName} (${params.subject}s)`,
    params.segmentDescription ? `Description: ${params.segmentDescription}` : null,
    params.sampleSize != null ? `Audience size: ${params.sampleSize}` : null,
    params.fieldsSummary ? `Notable shared traits:\n${params.fieldsSummary}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const system = `You propose marketing campaign concepts for Indian Mutual Fund Distributors.

Output a JSON object with this exact shape:
{
  "ideas": [
    {
      "title": "short campaign name",
      "objective": "what this campaign achieves",
      "channels": ["whatsapp" | "email" | "sms"],
      "tone": "warm | educational | urgent | celebratory",
      "suggestedTriggers": ["event or schedule that fires this"],
      "sampleMessage": "1-2 line sample copy (NO scheme names, NO return promises)"
    }
  ]
}

Rules:
- Exactly 3 ideas. Diverse — don't propose 3 variants of the same thing.
- NEVER promise returns or recommend specific schemes.
- Always end sampleMessage with the standard mutual-fund risk disclosure (abbreviated is fine).
- Channels: choose what fits the objective — utility/reminder = whatsapp, education = email, urgent = sms.
- Output ONLY the JSON object.`;

  try {
    const res = await client().messages.create({
      model: REASONING_MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: ctx }],
    });
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    const json = text.replace(/^```(?:json)?\n?/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(json);
    const ideas = Array.isArray(parsed.ideas) ? parsed.ideas : [];
    return {
      ideas: ideas
        .filter((i: any) => i && typeof i === "object" && i.title)
        .map((i: any) => ({
          title: String(i.title),
          objective: String(i.objective ?? ""),
          channels: Array.isArray(i.channels)
            ? i.channels.filter((c: any) =>
                ["whatsapp", "email", "sms"].includes(c)
              )
            : [],
          tone: String(i.tone ?? "warm"),
          suggestedTriggers: Array.isArray(i.suggestedTriggers)
            ? i.suggestedTriggers.map(String)
            : [],
          sampleMessage: String(i.sampleMessage ?? ""),
        })),
    };
  } catch (err: any) {
    return { error: err?.message ?? "AI error" };
  }
}

/**
 * Draft a DDQ (Due Diligence Questionnaire) answer for a single question.
 * The MFD reviews + accepts; AI never auto-submits to the DDQ vault.
 */
export async function draftDdqAnswer(params: {
  question: string;
  tenantProfile: {
    displayName: string;
    arn?: string | null;
    euin?: string | null;
    aumRange?: string | null;
    teamSize?: string | null;
    address?: any;
  };
  existingAnswerHint?: string;
}): Promise<{ draft: string } | { error: string }> {
  const profile = [
    `Firm: ${params.tenantProfile.displayName}`,
    params.tenantProfile.arn ? `ARN: ${params.tenantProfile.arn}` : null,
    params.tenantProfile.euin ? `EUIN: ${params.tenantProfile.euin}` : null,
    params.tenantProfile.aumRange ? `AUM range: ${params.tenantProfile.aumRange}` : null,
    params.tenantProfile.teamSize ? `Team size: ${params.tenantProfile.teamSize}` : null,
    params.existingAnswerHint
      ? `Prior answer / hint:\n${params.existingAnswerHint}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const system = `You draft Due Diligence Questionnaire (DDQ) answers for an Indian MFD.

Rules:
- Factual, formal, audit-grade tone. No marketing fluff.
- NEVER invent regulatory registrations the firm doesn't have.
- If you don't know a number, say "to be confirmed by compliance" — don't fabricate.
- Cite real frameworks where appropriate: SEBI (Investment Advisers) Regulations 2013, AMFI Code of Conduct, PMLA 2002, IT Act 2000.
- Keep answers under 200 words unless the question is multi-part.
- Output ONLY the answer text — no question echo, no preamble.`;

  try {
    const res = await client().messages.create({
      model: REASONING_MODEL,
      max_tokens: 1500,
      system,
      messages: [
        {
          role: "user",
          content: `${profile}\n\nQuestion:\n${params.question}`,
        },
      ],
    });
    const draft = res.content
      .filter((b) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    return { draft };
  } catch (err: any) {
    return { error: err?.message ?? "AI error" };
  }
}

/**
 * AI Relationship Copilot — a per-client "situation brief". Given the
 * deterministic context we already compute (portfolio value, risk profile,
 * open next-best-actions, data gaps, recent interactions), Claude produces a
 * tight pre-call brief: the relationship state, what to talk about, the
 * recommended next steps, and a compliant opener the RM can send. Advisory —
 * the RM reviews everything; nothing is persisted or auto-sent.
 */
export async function generateClientBrief(params: {
  name: string;
  serviceTier?: string | null;
  riskProfile?: string | null;
  segmentTag?: string | null;
  aumInr?: number | null;
  monthlySipInr?: number | null;
  lastContactDaysAgo?: number | null;
  tenureMonths?: number | null;
  openActions?: Array<{ label: string; reason: string; impactInr?: number }>;
  dataGaps?: string[];
  recentInteractions?: Array<{ kind: string; subject?: string; whenDaysAgo?: number }>;
  allocationNote?: string;
}): Promise<
  | { summary: string; talkingPoints: string[]; recommendedActions: string[]; suggestedOpener: string; watchouts: string[] }
  | { error: string }
> {
  const ctx = [
    `Client: ${params.name}`,
    params.serviceTier ? `Service tier: ${params.serviceTier}` : null,
    params.segmentTag ? `Segment: ${params.segmentTag}` : null,
    params.riskProfile ? `Risk profile: ${params.riskProfile}` : null,
    params.aumInr != null ? `AUM: ₹${Math.round(params.aumInr).toLocaleString("en-IN")}` : null,
    params.monthlySipInr != null ? `Monthly SIP: ₹${Math.round(params.monthlySipInr).toLocaleString("en-IN")}` : null,
    params.tenureMonths != null ? `Tenure: ${params.tenureMonths} months` : null,
    params.lastContactDaysAgo != null ? `Last contact: ${params.lastContactDaysAgo} days ago` : null,
    params.allocationNote ? `Allocation: ${params.allocationNote}` : null,
    params.openActions?.length
      ? `Open next-best-actions:\n${params.openActions.map((a) => `  - ${a.label}: ${a.reason}${a.impactInr ? ` (₹${Math.round(a.impactInr).toLocaleString("en-IN")} impact)` : ""}`).join("\n")}`
      : null,
    params.dataGaps?.length ? `Data gaps: ${params.dataGaps.join(", ")}` : null,
    params.recentInteractions?.length
      ? `Recent interactions:\n${params.recentInteractions.map((i) => `  - ${i.kind}${i.subject ? ` · ${i.subject}` : ""}${i.whenDaysAgo != null ? ` · ${i.whenDaysAgo}d ago` : ""}`).join("\n")}`
      : "Recent interactions: none logged",
  ]
    .filter(Boolean)
    .join("\n");

  const system = `You are an Indian Mutual Fund Distributor's (MFD) relationship copilot. Given a
client's current state, produce a tight pre-call brief the advisor reads in 20 seconds.

Output a JSON object with this exact shape:
{
  "summary": "2-3 sentences: relationship state + the single most important thing right now",
  "talkingPoints": ["3-5 specific, personalised points grounded ONLY in the data given"],
  "recommendedActions": ["2-4 concrete next steps, prioritised by the ₹-impact shown"],
  "suggestedOpener": "a warm, compliant WhatsApp opener (<= 45 words) to restart the conversation",
  "watchouts": ["0-3 sensitivities, e.g. 'dormant 8m — lead with a check-in, not a pitch'"]
}

Hard rules (SEBI / AMFI):
- NEVER promise or project returns ("guaranteed", "assured", "X%").
- NEVER recommend a specific scheme by name (AMFI Code 4(k)).
- Ground every point in the supplied data — do NOT invent holdings, goals, or facts.
- suggestedOpener: warm and human, no disclaimers (the platform appends them), no hard sell.
- Output ONLY the JSON object.`;

  try {
    const res = await client().messages.create({
      model: REASONING_MODEL,
      max_tokens: 4096,
      system,
      responseFormat: "json",
      messages: [{ role: "user", content: ctx }],
    });
    const text = res.content.filter((b) => b.type === "text").map((b: any) => b.text).join("\n").trim();
    const p = parseAiJson(text);
    return {
      summary: String(p.summary ?? ""),
      talkingPoints: Array.isArray(p.talkingPoints) ? p.talkingPoints.map(String).slice(0, 6) : [],
      recommendedActions: Array.isArray(p.recommendedActions) ? p.recommendedActions.map(String).slice(0, 5) : [],
      suggestedOpener: String(p.suggestedOpener ?? ""),
      watchouts: Array.isArray(p.watchouts) ? p.watchouts.map(String).slice(0, 4) : [],
    };
  } catch (err: any) {
    return { error: err?.message ?? "AI error" };
  }
}

/**
 * Meeting Prep Pack — talking points for an upcoming review meeting. Given the
 * deterministic pack we already computed (client snapshot, what changed since
 * the last meeting, open items, goals), Claude produces 3-5 crisp talking
 * points + 2 questions to ask. Advisory only — the RM reads it before the
 * meeting; nothing is persisted or auto-sent.
 */
export async function generateMeetingPrepPoints(params: {
  clientName: string;
  isLead: boolean;
  meetingDateIso: string;
  snapshot: Record<string, unknown>;
  sinceLast: Record<string, unknown>;
  openItems: Array<{ title: string; dueAt?: string | null }>;
  goals: Array<{ name: string; targetAmountInr: number; progressPct?: number | null }>;
}): Promise<{ talkingPoints: string[]; questions: string[] } | { error: string }> {
  const ctx = [
    `${params.isLead ? "Prospect (lead)" : "Client"}: ${params.clientName}`,
    `Meeting date: ${params.meetingDateIso.slice(0, 10)}`,
    `Snapshot: ${JSON.stringify(params.snapshot)}`,
    `Since last meeting: ${JSON.stringify(params.sinceLast)}`,
    params.openItems.length
      ? `Open items:\n${params.openItems.map((t) => `  - ${t.title}${t.dueAt ? ` (due ${String(t.dueAt).slice(0, 10)})` : ""}`).join("\n")}`
      : "Open items: none",
    params.goals.length
      ? `Goals:\n${params.goals.map((g) => `  - ${g.name}: target ₹${Math.round(g.targetAmountInr).toLocaleString("en-IN")}${g.progressPct != null ? ` · ${Math.round(Number(g.progressPct))}% funded` : ""}`).join("\n")}`
      : "Goals: none recorded",
  ].join("\n");

  const system = `You prepare an Indian Mutual Fund Distributor (MFD) advisor for an upcoming
${params.isLead ? "prospect" : "client review"} meeting. Given the deterministic prep data, produce
talking points the advisor scans in 20 seconds before walking in.

Output a JSON object with this exact shape:
{
  "talkingPoints": ["3-5 crisp, specific points grounded ONLY in the data given"],
  "questions": ["exactly 2 open questions the advisor should ask the ${params.isLead ? "prospect" : "client"}"]
}

Hard rules (SEBI / AMFI):
- NEVER promise or project returns ("guaranteed", "assured", "X%").
- NEVER recommend a specific scheme by name (AMFI Code 4(k)) — even if scheme names appear in the data, discuss categories/allocation, not products.
- Ground every point in the supplied data — do NOT invent holdings, goals, or facts.
- Each point under 20 words. Lead with the most meeting-relevant change.
- Output ONLY the JSON object.`;

  try {
    const res = await client().messages.create({
      model: REASONING_MODEL,
      max_tokens: 1024,
      system,
      responseFormat: "json",
      messages: [{ role: "user", content: ctx }],
    });
    const text = res.content.filter((b) => b.type === "text").map((b: any) => b.text).join("\n").trim();
    const p = parseAiJson(text);
    return {
      talkingPoints: Array.isArray(p.talkingPoints) ? p.talkingPoints.map(String).slice(0, 5) : [],
      questions: Array.isArray(p.questions) ? p.questions.map(String).slice(0, 2) : [],
    };
  } catch (err: any) {
    return { error: err?.message ?? "AI error" };
  }
}

/**
 * Generate 1-page Quarterly Review Report (QRR) commentary for an investor.
 */
export async function generateQrrCommentary(params: {
  investorName: string;
  riskProfile?: string | null;
  totalAumInr?: number | null;
  totalSipInr?: number | null;
  recentTransactions?: Array<{
    date: string;
    type: string;
    schemeCategory?: string;
    amount?: number;
  }>;
  lastReviewNotes?: string | null;
  marketContext?: string;
}): Promise<{ commentary: string } | { error: string }> {
  const ctx = [
    `Investor: ${params.investorName}`,
    params.riskProfile ? `Risk profile: ${params.riskProfile}` : null,
    params.totalAumInr != null
      ? `Total AUM: ₹${Math.round(params.totalAumInr).toLocaleString("en-IN")}`
      : null,
    params.totalSipInr != null
      ? `Monthly SIP: ₹${Math.round(params.totalSipInr).toLocaleString("en-IN")}`
      : null,
    params.recentTransactions?.length
      ? `Recent transactions:\n${params.recentTransactions
          .slice(0, 10)
          .map(
            (t) =>
              `  ${t.date} · ${t.type} · ${t.schemeCategory ?? "—"} · ₹${
                t.amount != null ? Math.round(t.amount).toLocaleString("en-IN") : "—"
              }`
          )
          .join("\n")}`
      : null,
    params.lastReviewNotes ? `Last review notes:\n${params.lastReviewNotes}` : null,
    params.marketContext ? `Market context:\n${params.marketContext}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const system = `You draft 1-page Quarterly Review Report (QRR) commentary for Indian MFD clients.

Structure:
  Paragraph 1 — portfolio overview (AUM, SIP cadence, asset-class mix at a high level)
  Paragraph 2 — period activity (recent additions/withdrawals, what changed)
  Paragraph 3 — outlook + suggested next step for the upcoming quarter

Rules:
- 250-400 words total. No bullet lists — flowing prose.
- NEVER recommend a specific scheme by name (AMFI 4(k)).
- NEVER project returns or use words like "guaranteed", "assured", "X%".
- End with: "Mutual fund investments are subject to market risks. Read all scheme related documents carefully."
- Warm professional tone, addressed to "you" / "your portfolio".
- Output ONLY the commentary — no headings, no markdown.`;

  try {
    const res = await client().messages.create({
      model: REASONING_MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: ctx }],
    });
    const commentary = res.content
      .filter((b) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    return { commentary };
  } catch (err: any) {
    return { error: err?.message ?? "AI error" };
  }
}
