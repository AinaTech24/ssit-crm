/**
 * Convert a CRM WhatsApp template (named {{module.field}} mustache tokens +
 * {header,body,footer} blocks) into the Meta-shaped fields Vartify's
 * POST /extension/templates expects ({{1}},{{2}} positional body + examples).
 */

import type { Template, TemplateVersion } from "@/db/schema";

const sanitizeName = (s: string): string =>
  (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 512) || "template";

const metaCategory = (c?: string): string => {
  const x = (c ?? "").toLowerCase();
  if (x === "marketing") return "MARKETING";
  if (x === "authentication") return "AUTHENTICATION";
  return "UTILITY"; // utility / transactional / other
};

const metaLanguage = (locale?: string): string => {
  const l = (locale ?? "").toLowerCase();
  if (l.startsWith("hi")) return "hi";
  if (l.startsWith("gu")) return "gu";
  if (l.startsWith("mr")) return "mr";
  return "en_US";
};

/** Replace {{module.field}} named tokens with Meta positional {{1}},{{2}} in
 *  order of first appearance, and emit one example per placeholder. */
function toPositional(
  text: string,
  variables: Array<{ key: string; example?: string; sample?: string }>
): { body: string; examples: Array<{ key: string; example: string }> } {
  const order: string[] = [];
  const body = String(text ?? "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, raw) => {
    const k = String(raw).trim();
    let i = order.indexOf(k);
    if (i === -1) {
      order.push(k);
      i = order.length - 1;
    }
    return `{{${i + 1}}}`;
  });
  const exMap = new Map((variables ?? []).map((v) => [v.key, (v as any).example ?? (v as any).sample ?? ""]));
  const examples = order.map((k, i) => {
    const ex = exMap.get(k) || (/^\d+$/.test(k) ? "Sample" : (k.split(".").pop() ?? "Sample"));
    return { key: String(i + 1), example: String(ex || "Sample") };
  });
  return { body, examples };
}

export type MetaSubmission = {
  templateName: string;
  category: string;
  language: string;
  messageBody: string;
  variableExamples: Array<{ key: string; example: string }>;
  headerText?: string;
  footerText?: string;
  headerMediaUrl?: string;
};

export function buildMetaSubmission(tpl: Template, ver: TemplateVersion): MetaSubmission {
  const body = (ver.body ?? {}) as any;
  const bodyText = body?.body?.text ?? body?.text ?? "";
  const { body: messageBody, examples } = toPositional(bodyText, (ver.variables as any) ?? []);
  const headerText = typeof body?.header?.text === "string" ? body.header.text.trim() : undefined;
  const headerMediaUrl = body?.header?.mediaUrl ?? body?.header?.url ?? body?.headerMediaUrl ?? undefined;
  const footerText = typeof body?.footer?.text === "string" ? body.footer.text.trim() : undefined;
  return {
    templateName: sanitizeName(tpl.key || tpl.name),
    category: metaCategory(tpl.category as any),
    language: metaLanguage(tpl.locale as any),
    messageBody: messageBody || " ",
    variableExamples: examples,
    headerText: headerMediaUrl ? undefined : headerText || undefined,
    footerText: footerText || undefined,
    headerMediaUrl: headerMediaUrl || undefined,
  };
}
