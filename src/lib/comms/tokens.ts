/**
 * Token / variable resolver for templates.
 *
 * Templates declare their variables in a typed `variables` array. The resolver
 * walks that declaration, fetches each value from a context object built from
 * the subject (investor/lead), tenant, user, and run-scope vars, and applies
 * formatting (currency, date, etc.). Missing required variables throw —
 * better to fail at compose time than send a half-rendered message.
 */

import { format as formatDate } from "date-fns";

export interface VariableDef {
  key: string;
  type: "string" | "number" | "currency" | "date" | "boolean" | "url";
  source?: string;
  required?: boolean;
  fallback?: unknown;
  format?: string;
}

export interface ResolveContext {
  subject: Record<string, any> | null;
  tenant: Record<string, any>;
  user?: Record<string, any>;
  context?: Record<string, any>;
  overrides?: Record<string, any>;
}

export class TokenResolutionError extends Error {}

export function resolveTokens(
  variables: VariableDef[],
  ctx: ResolveContext
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const v of variables) {
    const value = resolveOne(v, ctx);
    // Don't hard-fail the whole send when a field can't be resolved — render it
    // blank. Blocking an entire email because one optional field is empty is the
    // wrong trade-off; the compliance gate + the author's review are the safety
    // net, and the designer preview still flags unfilled fields.
    resolved[v.key] = formatValue(value, v);
  }
  return resolved;
}

function resolveOne(def: VariableDef, ctx: ResolveContext): unknown {
  // Override always wins.
  if (ctx.overrides && def.key in ctx.overrides) {
    return ctx.overrides[def.key];
  }
  // Auto-detected designer variables (e.g. "investor.name") carry no explicit
  // `source` — fall back to the key itself as the path.
  const source = def.source || def.key;
  if (!source) return def.fallback ?? null;
  const [root, ...rest] = source.split(".");
  const subject: any = ctx.subject ?? {};
  const context: any = ctx.context ?? {};
  // Map the merge-field namespaces to the loaded records. investor/lead both map
  // to the subject; transaction/family/system come from the run context.
  const roots: Record<string, any> = {
    subject,
    investor: subject,
    lead: subject,
    family: subject.family ?? context.family ?? {},
    transaction: context.transaction ?? {},
    system: context.system ?? {},
    tenant: ctx.tenant,
    user: ctx.user ?? {},
    context,
  };
  let cur = roots[root];
  if (cur === undefined) return def.fallback ?? null;
  for (const seg of rest) {
    if (cur == null || typeof cur !== "object") return def.fallback ?? null;
    // Records are camelCase (drizzle); merge tokens are often snake_case — try
    // the exact key, then the camelCased equivalent (date_of_birth → dateOfBirth).
    const camel = seg.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
    cur = (cur as any)[seg] !== undefined ? (cur as any)[seg] : (cur as any)[camel];
  }
  if (cur === undefined || cur === null) return def.fallback ?? null;
  return cur;
}

function formatValue(value: unknown, def: VariableDef): string {
  if (value === null || value === undefined) return "";
  switch (def.type) {
    case "currency":
      return formatINR(Number(value), def.format === "inr_paise");
    case "number":
      return Number(value).toLocaleString("en-IN");
    case "date":
      try {
        return formatDate(typeof value === "string" ? new Date(value) : (value as Date), def.format ?? "dd MMM yyyy");
      } catch {
        return String(value);
      }
    case "boolean":
      return value ? "Yes" : "No";
    case "url":
    case "string":
    default:
      return String(value);
  }
}

function formatINR(n: number, asRupeesFromPaise = false): string {
  const rupees = asRupeesFromPaise ? n / 100 : n;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(rupees);
}

/** System-provided tokens available to every template (footer + pipeline). */
const SYSTEM_TOKENS = new Set([
  "unsubscribe_url", "tenant_name", "tenant_display_name", "tenant_arn", "arn_no", "arn_name",
  "euin", "firm_phone", "firm_email", "firm_website", "firm_address", "brand_color",
  "tenant_logo_url", "logo_url",
]);

/**
 * Flatten a template body to the plain text the compliance gate scans.
 *
 * This is the SINGLE source of truth for "what text does this template
 * contain" — the create / PATCH / submit routes previously each carried their
 * own slightly different `extractText`, so the compliance gate scanned
 * different text on different paths (e.g. submit missed header titles + button
 * labels that the send-time gate reads). That left seams in the moat.
 *
 * It is deliberately a SUPERSET of every field any extractor reads, including
 * the send-time pipeline (`extractTextFromBlocks`: text→content, header→title,
 * button→label). Scanning a superset at authoring time means authoring is at
 * least as strict as send — a template that clears the authoring gate can never
 * be newly blocked at send for content the author couldn't see being scanned.
 */
export function templateBodyToText(channel: string, body: any): string {
  if (!body) return "";
  if (channel === "whatsapp") {
    return [body?.header?.text, body?.body?.text, body?.footer?.text].filter(Boolean).join("\n");
  }
  if (channel === "email") {
    const blocks = Array.isArray(body?.blocks) ? body.blocks : [];
    const blockText = blocks
      .map((b: any) =>
        // Every candidate text-bearing field across all block shapes, regardless
        // of `type` — guarantees we never under-scan relative to send-time.
        [b?.content, b?.text, b?.title, b?.subtitle, b?.html, b?.label]
          .filter(Boolean)
          .join("\n")
      )
      .filter(Boolean)
      .join("\n");
    return [body?.subject, body?.preheader, blockText, body?.textFallback].filter(Boolean).join("\n");
  }
  if (channel === "sms") return body?.text ?? "";
  return JSON.stringify(body);
}

/**
 * Find `{{placeholders}}` in template text that have no matching declared
 * variable (and aren't system tokens or positional params). Surfaced as a
 * non-blocking warning so authors catch typo'd merge fields before they
 * silently render blank at send time.
 */
export function findUndeclaredPlaceholders(text: string, declaredKeys: string[]): string[] {
  const declared = new Set(declaredKeys);
  const found = new Set<string>();
  const re = /\{\{\s*([^}]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text ?? "")) !== null) {
    const k = m[1].trim();
    if (!k || declared.has(k) || SYSTEM_TOKENS.has(k)) continue;
    if (/^\d+$/.test(k) || /^p\d+$/.test(k)) continue; // positional params
    found.add(k);
  }
  return [...found];
}

/**
 * Render a WhatsApp template body by replacing `{{key}}` mustache placeholders.
 * Also supports `{{1}}, {{2}}` style for raw Wapi positional params.
 */
export function renderTemplateText(text: string, tokens: Record<string, string>): string {
  return text.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, key) => {
    const k = key.trim();
    if (k in tokens) return tokens[k];
    // numeric positional — keys named 'p1', 'p2', etc. or '1', '2'
    if (/^\d+$/.test(k) && `p${k}` in tokens) return tokens[`p${k}`];
    return "";
  });
}
