/**
 * Email renderer — converts the block-based template body into HTML using
 * React Email components. Produces email-client-safe HTML (tables, inline
 * styles) without us hand-writing it.
 *
 * Block types supported in v1:
 *   - header     { title, subtitle?, align?, color? }
 *   - hero       { title, body, ctaText?, ctaUrl?, imageUrl?, align? }
 *   - text       { content, align?, fontSize? }
 *   - button     { label, url, align? }
 *   - divider    {}
 *   - image      { url, alt?, width?, align? }
 *   - quote      { text, attribution? }
 *   - kv         { items: [{label, value}] }
 *   - footer     { text? }   // always auto-injected with ARN disclaimer
 *
 * The compliance disclaimer footer is ALWAYS appended — the editor cannot
 * remove it. This is a defense-in-depth measure: even if a tenant forgets to
 * add a footer block, the disclaimer goes out.
 */

import * as React from "react";
import { render } from "@react-email/render";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";
import { renderTemplateText } from "./tokens";

/** Strip dangerous link protocols from token-resolved hrefs (a variable value
 *  like `javascript:…` in a CTA url would otherwise become a live link). */
function safeUrl(url: string): string {
  const trimmed = (url ?? "").trim();
  if (/^(javascript|data|vbscript):/i.test(trimmed)) return "#";
  return trimmed;
}

interface EmailTemplateBody {
  subject: string;
  preheader?: string;
  blocks: Array<EmailBlock>;
  textFallback?: string;
  /** Brand */
  primaryColor?: string;
  logoUrl?: string;
  fromName?: string;
}

type EmailBlock =
  | { type: "header"; title: string; subtitle?: string; align?: "left" | "center" }
  | {
      type: "hero";
      title: string;
      body: string;
      ctaText?: string;
      ctaUrl?: string;
      imageUrl?: string;
    }
  | { type: "text"; content: string; align?: "left" | "center" | "right" }
  | { type: "button"; label: string; url: string; align?: "left" | "center" | "right" }
  | { type: "divider" }
  | { type: "image"; url: string; alt?: string; width?: number; align?: "left" | "center" | "right" }
  | { type: "quote"; text: string; attribution?: string }
  | { type: "kv"; items: Array<{ label: string; value: string }> }
  | { type: "footer"; text?: string };

function renderBlock(block: EmailBlock, tokens: Record<string, string>, primary: string): React.ReactElement | null {
  switch (block.type) {
    case "header":
      return (
        <Section key={Math.random()} style={{ padding: "24px 0" }}>
          <Heading style={{ color: primary, fontSize: 24, margin: 0, textAlign: block.align ?? "left" }}>
            {renderTemplateText(block.title, tokens)}
          </Heading>
          {block.subtitle && (
            <Text style={{ color: "#6b7280", marginTop: 4, textAlign: block.align ?? "left" }}>
              {renderTemplateText(block.subtitle, tokens)}
            </Text>
          )}
        </Section>
      );
    case "hero":
      return (
        <Section key={Math.random()} style={{ padding: "16px 0" }}>
          {block.imageUrl && (
            <Img src={block.imageUrl} alt="" width="100%" style={{ borderRadius: 8, marginBottom: 16 }} />
          )}
          <Heading style={{ fontSize: 28, color: "#111827", margin: "0 0 12px 0" }}>
            {renderTemplateText(block.title, tokens)}
          </Heading>
          <Text style={{ color: "#374151", fontSize: 16, lineHeight: "24px" }}>
            {renderTemplateText(block.body, tokens)}
          </Text>
          {block.ctaText && block.ctaUrl && (
            <Button
              href={safeUrl(renderTemplateText(block.ctaUrl, tokens))}
              style={{
                backgroundColor: primary,
                color: "white",
                padding: "12px 24px",
                borderRadius: 6,
                marginTop: 16,
                textDecoration: "none",
                display: "inline-block",
                fontWeight: 600,
              }}
            >
              {renderTemplateText(block.ctaText, tokens)}
            </Button>
          )}
        </Section>
      );
    case "text":
      return (
        <Section key={Math.random()} style={{ padding: "8px 0" }}>
          <Text style={{ color: "#374151", fontSize: 15, lineHeight: "22px", textAlign: block.align ?? "left", whiteSpace: "pre-wrap" }}>
            {renderTemplateText(block.content, tokens)}
          </Text>
        </Section>
      );
    case "button":
      return (
        <Section key={Math.random()} style={{ textAlign: block.align ?? "center", padding: "16px 0" }}>
          <Button
            href={safeUrl(renderTemplateText(block.url, tokens))}
            style={{
              backgroundColor: primary,
              color: "white",
              padding: "12px 24px",
              borderRadius: 6,
              textDecoration: "none",
              display: "inline-block",
              fontWeight: 600,
            }}
          >
            {renderTemplateText(block.label, tokens)}
          </Button>
        </Section>
      );
    case "divider":
      return <Hr key={Math.random()} style={{ borderColor: "#e5e7eb", margin: "24px 0" }} />;
    case "image":
      return (
        <Section key={Math.random()} style={{ textAlign: block.align ?? "center", padding: "8px 0" }}>
          <Img
            src={block.url}
            alt={block.alt ?? ""}
            width={block.width ?? 560}
            style={{ borderRadius: 6, maxWidth: "100%" }}
          />
        </Section>
      );
    case "quote":
      return (
        <Section
          key={Math.random()}
          style={{
            padding: "16px 20px",
            backgroundColor: "#f3f4f6",
            borderLeft: `3px solid ${primary}`,
            margin: "16px 0",
          }}
        >
          <Text style={{ fontStyle: "italic", color: "#374151", margin: 0 }}>
            {renderTemplateText(block.text, tokens)}
          </Text>
          {block.attribution && (
            <Text style={{ color: "#6b7280", marginTop: 8, fontSize: 13 }}>— {block.attribution}</Text>
          )}
        </Section>
      );
    case "kv":
      return (
        <Section key={Math.random()} style={{ padding: "8px 0" }}>
          {block.items.map((item, i) => (
            <Section key={i} style={{ padding: "6px 0" }}>
              <Text style={{ color: "#6b7280", fontSize: 13, margin: 0 }}>
                {renderTemplateText(item.label, tokens)}
              </Text>
              <Text style={{ color: "#111827", fontSize: 15, margin: 0, fontWeight: 600 }}>
                {renderTemplateText(item.value, tokens)}
              </Text>
            </Section>
          ))}
        </Section>
      );
    case "footer":
      return null; // footer is auto-injected below
    default:
      return null;
  }
}

/** The non-removable footer with mandatory disclaimers. */
function ComplianceFooter({ tokens }: { tokens: Record<string, string> }) {
  // The ARN may be stored with or without the "ARN-" prefix — strip it so the
  // footer never reads "ARN-ARN-249212".
  const arn = (tokens.arn_no ?? tokens.tenant_arn ?? "").replace(/^[Aa][Rr][Nn][\s-]*/, "");
  const legalName = tokens.arn_name ?? tokens.tenant_name ?? "";
  const euin = tokens.euin ?? "";
  const phone = tokens.firm_phone ?? "";
  const email = tokens.firm_email ?? "";
  const website = tokens.firm_website ?? "";

  return (
    <Section style={{ borderTop: "1px solid #e5e7eb", marginTop: 32, paddingTop: 16 }}>
      <Text style={{ color: "#6b7280", fontSize: 12, lineHeight: "18px" }}>
        {legalName ? `${legalName} ` : ""}{arn ? `· ARN-${arn}` : ""}{euin ? ` · EUIN-${euin}` : ""}
        {phone ? ` · ${phone}` : ""}{email ? ` · ${email}` : ""}{website ? ` · ${website}` : ""}
      </Text>
      <Text style={{ color: "#9ca3af", fontSize: 11, marginTop: 8, lineHeight: "16px" }}>
        Mutual fund investments are subject to market risks. Read all scheme related documents
        carefully. The information here is for educational purposes only and does not constitute
        investment advice or a recommendation to buy or sell any security. Past performance is not
        indicative of future results.
      </Text>
      <Text style={{ color: "#9ca3af", fontSize: 11, marginTop: 8 }}>
        If you no longer wish to receive these emails, you can{" "}
        <Link href="{{unsubscribe_url}}" style={{ color: "#6b7280" }}>unsubscribe here</Link>.
      </Text>
    </Section>
  );
}

export function renderEmailTemplate(body: EmailTemplateBody, tokens: Record<string, string>): string {
  // ── NEW: Designer-mode bodies (block UI / raw HTML mode) ─────────────────
  // Detected by the presence of `mode` field. Routes through the new renderer
  // in src/lib/email-designer/render.ts.
  if ((body as any)?.mode === "designer" || (body as any)?.mode === "html") {
    // Tokens have flat keys (e.g. tokens["investor_name"]). The new renderer
    // expects a nested object (e.g. { investor: { name: ... } }), so unflatten.
    const variables = unflattenTokens(tokens);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { renderEmailHtml } = require("@/lib/email-designer/render") as typeof import("@/lib/email-designer/render");
    return renderEmailHtml(body as any, {
      // Actual send: any field still unfilled (e.g. transaction.* on a manual
      // send with no transaction context) renders blank, never raw "{{…}}".
      blankUnresolved: true,
      variables,
      tenant: {
        legalName: tokens.tenant_name ?? tokens.arn_name ?? "",
        displayName: tokens.tenant_display_name ?? tokens.tenant_name ?? "",
        arn: tokens.tenant_arn ?? tokens.arn_no ?? "",
        principalEuin: tokens.euin ?? "",
        address: tokens.firm_address ?? "",
        websiteUrl: tokens.firm_website ?? "",
        brandColor: tokens.brand_color ?? null,
        logoUrl: tokens.tenant_logo_url ?? tokens.logo_url ?? null,
      },
      unsubscribeUrl: tokens.unsubscribe_url ?? "",
    });
  }

  // ── Legacy block-based body (kept for older approved templates) ──────────
  const primary = body.primaryColor ?? "#1f2937";

  const element = (
    <Html>
      <Head>
        <title>{body.subject}</title>
      </Head>
      <Preview>{renderTemplateText(body.preheader ?? "", tokens)}</Preview>
      <Body style={{ backgroundColor: "#f9fafb", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", margin: 0 }}>
        <Container
          style={{
            backgroundColor: "white",
            maxWidth: 600,
            margin: "32px auto",
            padding: 32,
            borderRadius: 8,
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          {body.logoUrl && <Img src={body.logoUrl} alt="" width={120} style={{ marginBottom: 16 }} />}
          {body.blocks.map((b, i) => (
            <React.Fragment key={i}>{renderBlock(b, tokens, primary)}</React.Fragment>
          ))}
          <ComplianceFooter tokens={tokens} />
        </Container>
      </Body>
    </Html>
  );

  // @react-email/render returns Promise in newer versions; cast for compatibility
  const html = render(element) as unknown as string | Promise<string>;
  if (typeof html === "string") return html;
  // Shouldn't happen in our usage (we call sync) — fall back to empty if Promise
  return "";
}

/**
 * Convert flat tokens like { "investor_name": "Rajesh", "tenant_arn": "123456" }
 * into nested objects { investor: { name: "Rajesh" }, tenant: { arn: "123456" } }
 * so the new designer renderer's `{{investor.name}}` paths resolve.
 * Keys without an underscore are kept flat.
 */
function unflattenTokens(tokens: Record<string, string>): Record<string, unknown> {
  const out: Record<string, any> = {};
  const setPath = (parts: string[], v: string) => {
    let node = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (typeof node[p] !== "object" || node[p] === null) node[p] = {};
      node = node[p];
    }
    node[parts[parts.length - 1]] = v;
  };
  for (const [k, v] of Object.entries(tokens ?? {})) {
    // Designer merge fields are DOTTED paths — "investor.name" → { investor: { name } }
    // — and readPath() splits on ".". The previous version split on "_", so dotted
    // keys never nested and every {{field}} rendered raw. Handle dot first, fall
    // back to the legacy underscore namespace, and keep a flat alias.
    out[k] = v;
    if (k.includes(".")) {
      setPath(k.split("."), v);
    } else if (k.includes("_")) {
      const idx = k.indexOf("_");
      setPath([k.slice(0, idx), k.slice(idx + 1)], v);
    }
  }
  return out;
}
