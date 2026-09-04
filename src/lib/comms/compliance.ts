/**
 * Compliance checkers for outbound communication.
 *
 * Every outbound message — WhatsApp, email, SMS — runs through this pipeline
 * BEFORE being handed to the channel adapter. Any `block` severity finding
 * stops the send and records the reason. `warn` severity surfaces in UI but
 * allows send.
 *
 * 7 rule FUNCTIONS (in ALL_RULES) emit 11 distinct rule-IDs/findings — both
 * counts appear in the docs; they describe the same engine at different
 * granularities (functions vs. emitted finding codes):
 *   1. AMFI mandatory risk disclaimer on marketing communications
 *        → amfi.risk_disclaimer
 *   2. SEBI May 2026 ARN + registered name disclosure
 *        → sebi.arn_disclosure, sebi.registered_name
 *   3. No guaranteed-returns language
 *        → amfi.no_guaranteed_returns
 *   4. No "Wealth Adviser" / "Investment Adviser" terminology unless RIA-registered
 *        → sebi.no_adviser_term
 *   5. No scheme-specific marketing without AMC approval
 *        → amfi.scheme_marketing_4k
 *   6. SMS: DLT template id required + content match
 *        → trai.dlt_template_required, trai.dlt_template_mismatch, trai.dlt_template_not_registered
 *   7. WhatsApp marketing: requires session window OR pre-opt-in
 *        → whatsapp.marketing_outside_session
 *   (+ _rule_internal_error guard if a rule throws)
 *
 * To add a rule: write a new function that returns ComplianceFinding[], add
 * it to ALL_RULES.
 */

export type ComplianceSeverity = "info" | "warn" | "block";

export interface ComplianceFinding {
  rule: string;
  severity: ComplianceSeverity;
  message: string;
  /** Optional location of the offending text */
  match?: string;
  /** Suggested fix shown in UI */
  remediation?: string;
}

export interface ComplianceContext {
  channel: "whatsapp" | "email" | "sms" | "inapp";
  /** transactional/utility messages are exempted from most marketing rules */
  category: "transactional" | "utility" | "marketing" | "authentication";
  tenant: {
    legalName?: string;
    arn?: string;
    principalEuin?: string;
    riaRegistered?: boolean;
  };
  /** Full rendered text — for regex-based scanning */
  text: string;
  /** Subject line (email) */
  subject?: string;
  /** SMS-specific: DLT template id assigned by TRAI */
  dltTemplateId?: string;
  /** SMS-specific: Approved DLT template content pattern */
  dltTemplateContent?: string;
  /** WhatsApp-specific session window check */
  whatsappSessionActive?: boolean;
  /** Has marketing-scope consent for this channel? */
  hasMarketingConsent?: boolean;
  /** Has the template referenced a specific scheme name? */
  schemesMentioned?: string[];
  /** Was AMC approval attached to the template version? */
  amcApprovalRef?: string;
}

const AMFI_RISK_DISCLAIMER_PATTERNS = [
  /mutual\s+fund\s+investments?\s+are\s+subject\s+to\s+market\s+risks?/i,
  /mf\s+investments?\s+are\s+subject\s+to\s+market\s+risks?/i,
  /read\s+all\s+scheme\s+related\s+documents?\s+carefully/i,
];

const GUARANTEED_RETURN_PATTERNS = [
  /\b(guaranteed|guarantee|assured|risk[-\s]?free|no[-\s]?risk|safe|certain)\s+(return|profit|growth|income)/i,
  /\b(guaranteed|guarantee|assured)\b(?![^.]*subject to market risks)/i,
  /\bfixed\s+return\b/i,
  /\bzero\s+risk\b/i,
  /\b\d+%\s+(guaranteed|assured)\b/i,
];

const ADVISER_TERM_PATTERNS = [
  /\b(wealth\s+adviser|investment\s+adviser|financial\s+adviser)\b/i,
];

const SCHEME_NAME_PATTERNS = [
  // Common AMC scheme naming patterns. This is a heuristic; real implementation
  // would maintain a master list of AMFI schemes and substring-match.
  /\b(SBI|HDFC|ICICI|Kotak|Axis|Aditya Birla|UTI|Nippon|Franklin|DSP|Mirae|Quant|Edelweiss|Motilal|Tata|Sundaram|IDFC|L&T|JM|PGIM|Invesco|Bandhan|Canara|Union|Baroda|Mahindra|360 ONE|Bank of India|HSBC|Navi|White Oak|Helios|Old Bridge|Samco|Trust|Zerodha|WhiteOak|NJ)\s+(Mutual\s+Fund|MF)?\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,5}\s+(Fund|Scheme|Plan)/,
];

/** The exact AMFI-mandated market-risk disclaimer (what the rule looks for). */
export const MANDATORY_RISK_DISCLAIMER =
  "Mutual fund investments are subject to market risks. Read all scheme related documents carefully.";

/**
 * Given a plain-text message + its category + the firm's identity, return the
 * mandatory footer lines that are MISSING and would otherwise BLOCK the send:
 *   - the AMFI market-risk disclaimer (marketing)
 *   - the SEBI ARN disclosure
 *   - the registered firm name (marketing)
 * Appending these clears the block-severity findings WITHOUT bypassing the gate.
 * Lines already present in the text are not returned (idempotent).
 */
export function missingMandatoryLines(params: {
  category: ComplianceContext["category"];
  text: string;
  tenant: { legalName?: string | null; arn?: string | null };
}): string[] {
  const text = params.text ?? "";
  const lines: string[] = [];

  if (params.category === "marketing" && !AMFI_RISK_DISCLAIMER_PATTERNS.some((p) => p.test(text))) {
    lines.push(MANDATORY_RISK_DISCLAIMER);
  }

  const arn = params.tenant.arn?.trim();
  if (arn && params.category !== "authentication") {
    // ARN may be stored with or without the "ARN-" prefix — normalise to the
    // bare number so we never emit "ARN-ARN-249212" (matches ruleArnDisclosure).
    const bare = arn.replace(/^arn[\s-]*/i, "");
    const forms = [`ARN-${bare}`, `ARN ${bare}`, arn];
    if (!forms.some((f) => f && text.includes(f))) lines.push(`ARN-${bare}`);
  }

  const legalName = params.tenant.legalName?.trim();
  if (legalName && params.category === "marketing" && !text.toLowerCase().includes(legalName.toLowerCase())) {
    lines.push(legalName);
  }

  return lines;
}

/** ============== Deterministic rule functions ============== */

function ruleAmfiDisclaimer(ctx: ComplianceContext): ComplianceFinding[] {
  if (ctx.category !== "marketing") return [];
  const has = AMFI_RISK_DISCLAIMER_PATTERNS.some((p) => p.test(ctx.text));
  if (!has) {
    return [
      {
        rule: "amfi.risk_disclaimer",
        severity: "block",
        message: "Marketing communications must include the mandatory market risk disclaimer.",
        remediation:
          'Add the exact phrase: "Mutual fund investments are subject to market risks. Read all scheme related documents carefully."',
      },
    ];
  }
  return [];
}

function ruleArnDisclosure(ctx: ComplianceContext): ComplianceFinding[] {
  if (ctx.category === "authentication") return [];
  const findings: ComplianceFinding[] = [];
  if (ctx.tenant.arn) {
    // The ARN may be stored WITH or WITHOUT the "ARN-" prefix (e.g. "ARN-249212"
    // or "249212"). Normalise to the bare number, then accept any reasonable
    // form in the text. The previous check blindly prepended "ARN-", so a
    // stored "ARN-249212" demanded "ARN-ARN-249212" — which the footer never
    // contains, blocking EVERY communication.
    const raw = String(ctx.tenant.arn).trim();
    const bare = raw.replace(/^arn[\s-]*/i, "");
    const forms = [`ARN-${bare}`, `ARN ${bare}`, raw];
    const present = forms.some((f) => f && ctx.text.includes(f));
    if (!present) {
      findings.push({
        rule: "sebi.arn_disclosure",
        severity: ctx.category === "marketing" ? "block" : "warn",
        message: `ARN-${bare} must appear on all communications (SEBI May 2026 directive).`,
        remediation: `Append "ARN-${bare}" to the message footer.`,
      });
    }
  }
  if (ctx.tenant.legalName && ctx.category === "marketing" && !ctx.text.toLowerCase().includes(ctx.tenant.legalName.toLowerCase())) {
    findings.push({
      rule: "sebi.registered_name",
      severity: "warn",
      message: `Registered firm name '${ctx.tenant.legalName}' must appear on marketing communications.`,
    });
  }
  return findings;
}

function ruleGuaranteedReturns(ctx: ComplianceContext): ComplianceFinding[] {
  const findings: ComplianceFinding[] = [];
  for (const pat of GUARANTEED_RETURN_PATTERNS) {
    const m = ctx.text.match(pat);
    if (m) {
      findings.push({
        rule: "amfi.no_guaranteed_returns",
        severity: "block",
        message: "Communication contains guaranteed/assured-return language, which is prohibited.",
        match: m[0],
        remediation: "Rephrase to remove guarantee/assurance claims about returns.",
      });
    }
  }
  return findings;
}

function ruleAdviserTerm(ctx: ComplianceContext): ComplianceFinding[] {
  if (ctx.tenant.riaRegistered) return [];
  const findings: ComplianceFinding[] = [];
  for (const pat of ADVISER_TERM_PATTERNS) {
    const m = ctx.text.match(pat);
    if (m) {
      findings.push({
        rule: "sebi.no_adviser_term",
        severity: "block",
        message: `Use of '${m[0]}' is restricted to SEBI-registered Investment Advisers (RIA).`,
        match: m[0],
        remediation: "Use 'Mutual Fund Distributor', 'MFD', or 'Distributor' instead.",
      });
    }
  }
  return findings;
}

function ruleSchemeSpecific(ctx: ComplianceContext): ComplianceFinding[] {
  if (ctx.category !== "marketing") return [];
  if (ctx.amcApprovalRef) return [];
  const findings: ComplianceFinding[] = [];
  const mentions = ctx.schemesMentioned ?? [];
  for (const pat of SCHEME_NAME_PATTERNS) {
    const m = ctx.text.match(pat);
    if (m) mentions.push(m[0]);
  }
  if (mentions.length) {
    findings.push({
      rule: "amfi.scheme_marketing_4k",
      severity: "block",
      message:
        "AMFI Code of Conduct clause 4(k) prohibits self-designed scheme-specific marketing without AMC approval.",
      match: mentions.join(", "),
      remediation:
        "Either remove scheme-specific mentions, or attach the AMC's written approval reference on the template version.",
    });
  }
  return findings;
}

export function matchDltTemplate(text: string, template: string): boolean {
  // Normalize whitespace
  const normText = text.replace(/\s+/g, " ").trim();
  const normTemplate = template.replace(/\s+/g, " ").trim();

  // Escape special regex characters
  const escapeRegex = (s: string) => s.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");

  // Placeholder regex pattern: matches {#...#}, {#...}, {%...%}, etc.
  const placeholderRegex = /\{#[^#]*#\}|\{#[^}]*\}|\{%[^%]*%\}/g;

  const segments = normTemplate.split(placeholderRegex);
  const escapedSegments = segments.map(escapeRegex);

  // Combine segments with non-greedy wildcard matcher
  const regexStr = "^" + escapedSegments.join(".*?") + "$";
  const regex = new RegExp(regexStr, "i");

  return regex.test(normText);
}

function ruleDltTemplate(ctx: ComplianceContext): ComplianceFinding[] {
  if (ctx.channel !== "sms") return [];
  if (!ctx.dltTemplateId) {
    return [
      {
        rule: "trai.dlt_template_required",
        severity: "block",
        message: "SMS dispatch requires a TRAI DLT-registered template id.",
      },
    ];
  }

  if (ctx.dltTemplateContent) {
    const isMatch = matchDltTemplate(ctx.text, ctx.dltTemplateContent);
    if (!isMatch) {
      return [
        {
          rule: "trai.dlt_template_mismatch",
          severity: "block",
          message: "SMS text does not match the approved TRAI DLT template content structure.",
          remediation: `Ensure your message text conforms to the approved DLT format: "${ctx.dltTemplateContent}"`,
        },
      ];
    }
  } else {
    return [
      {
        rule: "trai.dlt_template_not_registered",
        severity: "block",
        message: `DLT Template ID '${ctx.dltTemplateId}' is not registered in the Equitywala DLT pre-registry.`,
        remediation: "Go to Settings -> DLT templates to pre-register this Template ID.",
      },
    ];
  }

  return [];
}

function ruleWhatsappSession(ctx: ComplianceContext): ComplianceFinding[] {
  if (ctx.channel !== "whatsapp") return [];
  if (ctx.category === "marketing") {
    if (!ctx.hasMarketingConsent && !ctx.whatsappSessionActive) {
      return [
        {
          rule: "whatsapp.marketing_outside_session",
          severity: "block",
          message:
            "Marketing-scope WhatsApp messages require either an active session (recipient replied <24h ago) or recorded marketing opt-in.",
        },
      ];
    }
  }
  return [];
}

/** ============== Aggregator ============== */

const ALL_RULES = [
  ruleAmfiDisclaimer,
  ruleArnDisclosure,
  ruleGuaranteedReturns,
  ruleAdviserTerm,
  ruleSchemeSpecific,
  ruleDltTemplate,
  ruleWhatsappSession,
];

export interface ComplianceResult {
  findings: ComplianceFinding[];
  blocked: boolean;
  /** Score: 100 minus 30 per block, 5 per warn (floor 0) */
  score: number;
}

export function runComplianceChecks(ctx: ComplianceContext): ComplianceResult {
  const all: ComplianceFinding[] = [];
  for (const rule of ALL_RULES) {
    try {
      all.push(...rule(ctx));
    } catch (err) {
      // Fail CLOSED for marketing: a crashing rule must not silently let a
      // marketing message bypass that protection. Transactional/utility stay
      // warn so a rule bug can't block the client's own service messages.
      all.push({
        rule: "_rule_internal_error",
        severity: ctx.category === "marketing" ? "block" : "warn",
        message: `Compliance rule failed: ${(err as Error).message}`,
      });
    }
  }
  const blocked = all.some((f) => f.severity === "block");
  const score = Math.max(
    0,
    100 - all.filter((f) => f.severity === "block").length * 30 - all.filter((f) => f.severity === "warn").length * 5
  );
  return { findings: all, blocked, score };
}
