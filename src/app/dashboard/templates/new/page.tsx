"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  ChevronLeft, ChevronDown, ShieldCheck, AlertCircle, Save, Send, Plus, Trash, Paperclip,
  Mail, MessageSquare, Smartphone, Check, ArrowRight, Sparkles, Upload, Loader2,
} from "lucide-react";
import { runComplianceChecks, missingMandatoryLines } from "@/lib/comms/compliance";
import { MergeFieldInserter, type VarDecl } from "@/components/templates/MergeFieldInserter";
import { SelectField } from "@/components/ui/SelectField";
import type { EmailDesignerBody } from "@/lib/email-designer/types";
import { STARTER_TEMPLATES, applyStarter } from "@/lib/email-designer/starters";

// Code-split the block-based email designer (847 lines + its editor deps) so
// it loads only when the email channel is actually edited, not on page open.
const EmailDesigner = dynamic(
  () => import("@/components/email-designer/EmailDesigner").then((m) => m.EmailDesigner),
  { ssr: false, loading: () => <div className="skeleton h-[60vh] min-h-[400px] w-full rounded-xl" /> }
);

type Channel = "whatsapp" | "email" | "sms";
type Category = "transactional" | "utility" | "marketing" | "authentication";

const CHANNELS: { value: Channel; label: string; help: string; Icon: typeof Mail }[] = [
  { value: "email", label: "Email", help: "A designed email with your logo & branding", Icon: Mail },
  { value: "whatsapp", label: "WhatsApp", help: "A short WhatsApp text message", Icon: MessageSquare },
  { value: "sms", label: "SMS", help: "A plain text SMS (DLT-registered)", Icon: Smartphone },
];

const CATEGORIES: { value: Category; label: string; help: string }[] = [
  { value: "transactional", label: "Transactional", help: "Order, SIP & payment confirmations, statements" },
  { value: "utility", label: "Service / Reminder", help: "Reminders, status updates, document requests" },
  { value: "marketing", label: "Marketing", help: "Promotions & newsletters — needs marketing consent" },
  { value: "authentication", label: "Authentication", help: "OTP / verification codes" },
];

const defaultEmailBody: EmailDesignerBody = {
  subject: "Welcome to {{tenant.displayName}}",
  preheader: "Your wealth-management partner",
  mode: "designer",
  blocks: [],
  footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
  theme: {
    brandColor: "#0ea5e9",
    accentColor: "#0e2557",
    pageBackground: "#f5f7fb",
    cardBackground: "#ffffff",
    textColor: "#111827",
    mutedColor: "#6b7280",
    fontFamily: "sans",
    baseFontSize: 15,
    containerWidth: 600,
    cornerRadius: 12,
    logoHeight: 40,
    logoAlign: "center",
  },
};

function extractVariables(text: string): string[] {
  const matches = text.match(/\{\{([^}]+)\}\}/g) ?? [];
  return Array.from(new Set(matches.map((m) => m.slice(2, -2).trim())));
}

const STEPS = [
  { n: 1 as const, label: "Set up" },
  { n: 2 as const, label: "Design" },
  { n: 3 as const, label: "Review & send" },
];

export default function NewTemplatePage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("New template");
  const [key, setKey] = useState("new_template");
  // Auto-derive the key from the name until the user edits the key directly, so
  // two templates never collide on the static default "new_template".
  const [keyEdited, setKeyEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [channel, setChannel] = useState<Channel>("email");
  const [category, setCategory] = useState<Category>("transactional");
  const [locale, setLocale] = useState("en-IN");
  const [attachments, setAttachments] = useState<Array<{ name: string; url: string }>>([]);
  // File-upload state for attachments. `uploadingIdx === -1` = the top "Upload"
  // button is busy (appending a new row); `>= 0` = that row is being replaced.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<number>(-1);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const waRef = useRef<HTMLTextAreaElement>(null);
  const smsRef = useRef<HTMLTextAreaElement>(null);

  // Dynamic tenant details loaded from API
  const [tenant, setTenant] = useState<{
    legalName?: string;
    displayName?: string;
    arn?: string;
    principalEuin?: string;
    riaRegistered?: boolean;
    logoUrl?: string;
    brandColor?: string;
  } | null>(null);

  useEffect(() => {
    fetch("/api/tenant")
      .then((r) => r.json())
      .then((data) => {
        if (data?.tenant) {
          setTenant({
            legalName: data.tenant.legalName ?? "",
            displayName: data.tenant.displayName ?? "",
            arn: data.tenant.arn ?? "",
            principalEuin: data.tenant.principalEuin ?? undefined,
            riaRegistered: !!data.tenant.riaRegistered,
            logoUrl: data.tenant.logoUrl ?? "",
            brandColor: data.tenant.primaryColor ?? data.tenant.brandColor ?? undefined,
          });
        }
      })
      .catch((err) => console.error("Failed to load tenant details:", err));
  }, []);

  // Keep `key` a slug of `name` until the user hand-edits the key field.
  useEffect(() => {
    if (keyEdited) return;
    const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
    setKey(slug.length >= 2 ? slug : "new_template");
  }, [name, keyEdited]);

  // Email body (block designer / HTML mode)
  const [emailBody, setEmailBody] = useState<EmailDesignerBody>(defaultEmailBody);

  // Plain-text channels (WA / SMS) keep the old simple textarea editor
  const [waText, setWaText] = useState(
    "Hi {{investor.name}}, your SIP for {{transaction.scheme_name}} of ₹{{transaction.amount}} on {{transaction.transaction_date}} did not go through. We'll be in touch shortly.\n\n— {{tenant.displayName}} · ARN-{{tenant.arn}}"
  );
  const [smsText, setSmsText] = useState(
    "Dear {{investor.name}}, your SIP for {{transaction.scheme_name}} of Rs.{{transaction.amount}} failed. We will be in touch. - {{tenant.displayName}}"
  );
  const [dltId, setDltId] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Compliance score against rendered text (for any channel)
  const previewText = useMemo(() => {
    if (channel === "email") {
      if (emailBody.mode === "html") return emailBody.html ?? "";
      return [
        emailBody.subject,
        emailBody.preheader,
        ...(emailBody.blocks ?? []).map((b: any) => b.text || b.title || b.subtitle || b.html || b.label || ""),
      ]
        .filter(Boolean)
        .join("\n");
    }
    if (channel === "whatsapp") return waText;
    return smsText;
  }, [channel, emailBody, waText, smsText]);

  // Declared variables schema state
  const [declaredVars, setDeclaredVars] = useState<
    Array<{
      key: string;
      type: "string" | "number" | "currency" | "date" | "boolean" | "url";
      source?: string;
      required?: boolean;
      fallback?: unknown;
      format?: string;
    }>
  >([]);

  // Automatically extract variables from text blocks
  const parsedKeys = useMemo(() => {
    return extractVariables(previewText);
  }, [previewText]);

  useEffect(() => {
    setDeclaredVars((prev) => {
      return parsedKeys.map((vkey) => {
        const existing = prev.find((v) => v.key === vkey);
        if (existing) return existing;

        let guessedType: "string" | "number" | "currency" | "date" | "boolean" | "url" = "string";
        if (vkey.includes("amount") || vkey.includes("balance") || vkey.includes("value") || vkey.includes("aum") || vkey.includes("price")) {
          guessedType = "currency";
        } else if (vkey.includes("date") || vkey.includes("at") || vkey.includes("expiry") || vkey.includes("time")) {
          guessedType = "date";
        } else if (vkey.includes("url") || vkey.includes("link") || vkey.includes("href") || vkey.includes("site")) {
          guessedType = "url";
        } else if (vkey.includes("count") || vkey.includes("number") || vkey.includes("units") || vkey.includes("id")) {
          guessedType = "number";
        } else if (vkey.includes("is_") || vkey.includes("has_") || vkey.includes("active")) {
          guessedType = "boolean";
        }

        return {
          key: vkey,
          type: guessedType,
          source: vkey,
          required: true,
        };
      });
    });
  }, [parsedKeys]);

  const activeTenant = useMemo(
    () =>
      tenant ?? {
        legalName: "Demo Wealth Advisors",
        arn: "123456",
        principalEuin: "E123456",
        riaRegistered: false,
      },
    [tenant]
  );

  const compliance = useMemo(() => {
    return runComplianceChecks({
      channel,
      category,
      tenant: activeTenant,
      text: previewText,
      subject: channel === "email" ? emailBody.subject : undefined,
      dltTemplateId: channel === "sms" ? dltId : undefined,
      whatsappSessionActive: false,
      hasMarketingConsent: true,
    });
  }, [previewText, emailBody.subject, channel, category, dltId, activeTenant]);

  // Mandatory footer lines (disclaimer / ARN / firm name) missing from the body.
  // Offered for plain-text channels; email carries them via the designer footer.
  const fixLines = useMemo(() => {
    if (channel === "email") return [];
    return missingMandatoryLines({ category, text: previewText, tenant: activeTenant });
  }, [channel, category, previewText, activeTenant]);

  function applyComplianceFix() {
    if (!fixLines.length) return;
    const append = (t: string) => `${t.replace(/\s+$/, "")}\n\n${fixLines.join("\n")}`;
    if (channel === "whatsapp") setWaText(append);
    else if (channel === "sms") setSmsText(append);
  }

  /** Insert a merge token: into WA/SMS at the cursor, or into the email subject;
   *  and upsert a precise variable declaration so the schema is correct. */
  function insertMergeField(token: string, decl: VarDecl) {
    setDeclaredVars((prev) => {
      const i = prev.findIndex((v) => v.key === decl.key);
      if (i === -1) return [...prev, decl];
      const next = [...prev];
      next[i] = { ...next[i], type: decl.type, source: decl.source };
      return next;
    });
    if (channel === "whatsapp") setWaText((t) => spliceAtCursor(waRef.current, t, token));
    else if (channel === "sms") setSmsText((t) => spliceAtCursor(smsRef.current, t, token));
    else setEmailBody((b) => ({ ...b, subject: `${b.subject ?? ""}${token}` }));
  }

  const MAX_ATTACH_BYTES = 25 * 1024 * 1024; // 25 MB — matches email provider limits

  /** Upload a picked file to storage and return its hosted URL + display name.
   *  Reuses the content-library presigned-PUT flow (same tenant `library/`
   *  prefix whose public URLs are already fetched as email image sources), so
   *  the resulting URL is reachable by the email provider at send time. */
  async function uploadAttachmentFile(file: File): Promise<{ url: string; name: string }> {
    const presignRes = await fetch("/api/content-library/upload-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: file.name, contentType: file.type || "application/octet-stream" }),
    });
    const presign = await presignRes.json().catch(() => ({}));
    if (!presignRes.ok || !presign?.url) {
      throw new Error(presign?.error ?? "Could not start the upload. Please try again.");
    }
    const put = await fetch(presign.url, {
      method: "PUT",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!put.ok) throw new Error(`Upload failed (HTTP ${put.status})`);
    return { url: presign.publicUrl as string, name: file.name };
  }

  /** Open the OS file picker; `idx` = -1 appends a new attachment row. */
  function pickAttachmentFile(idx: number) {
    uploadTargetRef.current = idx;
    fileInputRef.current?.click();
  }

  async function onAttachmentFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    const idx = uploadTargetRef.current;
    const appendMode = idx < 0;
    if (file.size > MAX_ATTACH_BYTES) {
      setError("That file is over 25 MB — too large to attach to an email.");
      return;
    }
    setError(null);
    setUploadingIdx(appendMode ? -1 : idx);
    try {
      const up = await uploadAttachmentFile(file);
      setAttachments((arr) =>
        appendMode
          ? [...arr, { name: up.name, url: up.url }]
          : arr.map((x, i) => (i === idx ? { name: x.name?.trim() || up.name, url: up.url } : x))
      );
    } catch (err: any) {
      setError(err?.message ?? "Upload failed");
    } finally {
      setUploadingIdx(null);
    }
  }

  async function save(opts: { submitForApproval?: boolean }) {
    setSaving(true);
    setError(null);
    try {
      const body =
        channel === "email"
          ? emailBody
          : channel === "whatsapp"
            ? { body: { text: waText } }
            : { dltTemplateId: dltId, text: smsText };

      const payload = {
        key,
        name,
        description: description || undefined,
        channel,
        category,
        locale,
        body,
        variables: declaredVars,
        attachments,
      };
      const r = await fetch("/api/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      if (opts.submitForApproval) {
        const sr = await fetch(`/api/templates/${data.id}/submit`, { method: "POST" });
        const sd = await sr.json().catch(() => ({}));
        if (!sr.ok) {
          // The draft saved, but submission (e.g. Meta rejection, WhatsApp not
          // connected) failed — keep the user here with the real reason rather
          // than navigating away as if it succeeded.
          throw new Error(sd?.error ?? `Submit failed (HTTP ${sr.status})`);
        }
        const dest =
          channel === "whatsapp" && sd?.submittedToMeta
            ? `/dashboard/templates/${data.id}?submitted=meta`
            : `/dashboard/templates/${data.id}`;
        router.push(dest);
        return;
      }
      router.push(`/dashboard/templates/${data.id}`);
    } catch (e: any) {
      setError(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const channelLabel = CHANNELS.find((c) => c.value === channel)?.label ?? channel;
  const categoryMeta = CATEGORIES.find((c) => c.value === category);

  // ---- shared sub-blocks ---------------------------------------------------

  const complianceBadge = (
    <div className="inline-flex items-center gap-2 text-xs">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${compliance.blocked
            ? "bg-rose-50 text-rose-700"
            : compliance.score >= 90
              ? "bg-emerald-50 text-emerald-700"
              : "bg-amber-50 text-amber-700"
          }`}
      >
        <ShieldCheck className="size-3.5" />
        {compliance.blocked ? "Not ready to send" : compliance.score >= 90 ? "Looks good" : "Could be better"} · {compliance.score}/100
      </span>
      {fixLines.length > 0 && (
        <button
          type="button"
          onClick={applyComplianceFix}
          className="font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 px-2.5 py-1 inline-flex items-center gap-1"
          title={`Insert the mandatory ${fixLines.join(" + ")}`}
        >
          <Sparkles className="size-3.5" /> Fix it for me
        </button>
      )}
    </div>
  );

  const editorForChannel = (
    <>
      {channel === "email" && (
        <EmailDesigner value={emailBody} onChange={setEmailBody} tenant={tenant ?? undefined} />
      )}

      {channel === "whatsapp" && (
        <div className="card-surface p-5 space-y-3">
          <Field label="Message text">
            <textarea
              ref={waRef}
              value={waText}
              onChange={(e) => setWaText(e.target.value)}
              rows={10}
              className="input-base font-mono w-full"
            />
          </Field>
          <div className="text-xs text-muted-foreground">
            Tip: type <code className="bg-muted px-1 rounded">{`{{name}}`}</code> or{" "}
            <code className="bg-muted px-1 rounded">{`{{amount}}`}</code> where you want the client&apos;s details to
            appear — they get filled in automatically when the message is sent.
          </div>
        </div>
      )}

      {channel === "sms" && (
        <div className="card-surface p-5 space-y-3">
          <Field label="DLT Template ID">
            <input value={dltId} onChange={(e) => setDltId(e.target.value)} className="input-base w-full font-mono" placeholder="1107171234567" />
          </Field>
          <Field label="SMS text (max ~160 characters per part)">
            <textarea
              ref={smsRef}
              value={smsText}
              onChange={(e) => setSmsText(e.target.value)}
              rows={5}
              className="input-base font-mono w-full"
            />
          </Field>
          <div className="text-xs text-muted-foreground">{smsText.length} characters · {Math.ceil(smsText.length / 160)} SMS part(s)</div>
        </div>
      )}
    </>
  );

  // ---- render --------------------------------------------------------------

  return (
    <div className={`mx-auto pb-28 ${step === 2 ? "max-w-[1400px]" : "max-w-3xl"}`}>
      <Link
        href="/dashboard/templates"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1 mb-3"
      >
        <ChevronLeft className="size-4" /> Back to templates
      </Link>

      {/* Title + stepper */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Create a message template</h1>

        <ol className="mt-4 flex items-center gap-2">
          {STEPS.map((s, i) => {
            const state = s.n < step ? "done" : s.n === step ? "current" : "todo";
            return (
              <li key={s.n} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep(s.n)}
                  className={`flex items-center gap-2 rounded-full pl-1.5 pr-3 py-1 text-sm font-medium transition-colors ${state === "current"
                      ? "bg-brand-cyan/10 text-brand-cyan-deep"
                      : state === "done"
                        ? "text-emerald-700 hover:bg-emerald-50"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                >
                  <span
                    className={`grid place-items-center size-6 rounded-full text-xs font-bold ${state === "current"
                        ? "bg-brand-cyan text-white"
                        : state === "done"
                          ? "bg-emerald-600 text-white"
                          : "bg-muted text-muted-foreground"
                      }`}
                  >
                    {state === "done" ? <Check className="size-3.5" /> : s.n}
                  </span>
                  {s.label}
                </button>
                {i < STEPS.length - 1 && <span className="w-6 h-px bg-border" />}
              </li>
            );
          })}
        </ol>
      </div>

      {error && (
        <div className="card-surface p-3 mb-4 text-sm text-rose-700 bg-rose-50/40">{error}</div>
      )}

      {/* ============================ STEP 1 — SET UP ============================ */}
      {step === 1 && (
        <div className="space-y-6">
          <section>
            <h2 className="font-semibold text-sm mb-2">1. How do you want to reach your client?</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {CHANNELS.map(({ value, label, help, Icon }) => {
                const active = channel === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setChannel(value)}
                    className={`text-left rounded-xl border p-4 transition-all ${active ? "border-brand-cyan ring-2 ring-brand-cyan/20 bg-brand-cyan/5" : "border-border bg-card hover:border-brand-cyan/50"
                      }`}
                  >
                    <Icon className={`size-5 mb-2 ${active ? "text-brand-cyan-deep" : "text-muted-foreground"}`} />
                    <div className="font-semibold text-sm">{label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{help}</div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4">
            <h2 className="font-semibold text-sm -mb-1">2. Name it &amp; tell us what it&apos;s for</h2>
            <Field label="Template name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-base w-full text-base"
                placeholder="e.g. SIP bounce — friendly reminder"
              />
            </Field>
            <Field label="What is this template for? (optional)">
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Sent when a SIP bounces — low-balance variant"
                className="input-base w-full"
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Message type">
                <SelectField value={category} onChange={(e) => setCategory(e.target.value as Category)} className="w-full">
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </SelectField>
                {categoryMeta && <p className="text-[11px] text-muted-foreground mt-1">{categoryMeta.help}</p>}
              </Field>
              <Field label="Language">
                <SelectField value={locale} onChange={(e) => setLocale(e.target.value)} className="w-full">
                  <option value="en-IN">English (India)</option>
                  <option value="hi-IN">Hindi</option>
                  <option value="gu-IN">Gujarati</option>
                  <option value="mr-IN">Marathi</option>
                </SelectField>
              </Field>
            </div>
          </section>

          {channel === "email" && (
            <section>
              <h2 className="font-semibold text-sm mb-1">3. Choose a starting point</h2>
              <p className="text-xs text-muted-foreground mb-3">
                Pick a ready-made email to start from — you can change everything in the next step. Or skip to start from a blank email.
              </p>
              <div className="space-y-4">
                {([
                  { key: "client-transactional", label: "Client · Transactional", match: (s: (typeof STARTER_TEMPLATES)[number]) => s.audience !== "internal" && s.category === "transactional" },
                  { key: "client-utility", label: "Client · Service / Reminder", match: (s: (typeof STARTER_TEMPLATES)[number]) => s.audience !== "internal" && s.category === "utility" },
                  { key: "client-marketing", label: "Client · Marketing", match: (s: (typeof STARTER_TEMPLATES)[number]) => s.audience !== "internal" && s.category === "marketing" },
                  { key: "internal", label: "Team & Internal", match: (s: (typeof STARTER_TEMPLATES)[number]) => s.audience === "internal" },
                ] as const).map((group) => {
                  const items = STARTER_TEMPLATES.filter(group.match);
                  if (!items.length) return null;
                  return (
                    <div key={group.key}>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">{group.label}</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {items.map((s) => (
                          <button
                            key={s.key}
                            type="button"
                            onClick={() => {
                              const body = applyStarter(s.key);
                              if (body) {
                                setEmailBody(body);
                                setCategory(s.category);
                                setName(s.name);
                                setKeyEdited(false);
                                setStep(2);
                              }
                            }}
                            className="text-left rounded-lg border border-border bg-card px-3 py-2.5 hover:border-brand-cyan/60 hover:shadow-sm transition-all"
                          >
                            <div className="text-sm font-semibold truncate">{s.name}</div>
                            <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{s.description}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ============================ STEP 2 — DESIGN ============================ */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-semibold text-base">
                {channel === "email" ? "Design your email" : `Write your ${channelLabel} message`}
              </h2>
              <p className="text-xs text-muted-foreground">
                {channel === "email"
                  ? "Add blocks, edit text and see the live preview on the right."
                  : "Keep it short and personal. Use the personalisation helper to drop in client details."}
              </p>
            </div>
            {complianceBadge}
          </div>

          {/* Personalisation helper — collapsible so it doesn't crowd the editor */}
          <details className="card-surface p-0 group" open={channel !== "email"}>
            <summary className="flex items-center justify-between cursor-pointer list-none select-none px-4 py-3">
              <span className="font-semibold text-sm flex items-center gap-1.5">
                <ChevronDown className="size-4 -rotate-90 group-open:rotate-0 transition-transform" />
                Add personalisation (client name, amount, dates…)
              </span>
            </summary>
            <div className="px-4 pb-4 space-y-2">
              <MergeFieldInserter onInsert={insertMergeField} />
              {channel === "email" && (
                <p className="text-[11px] text-muted-foreground">
                  Picking a field adds it to the <strong>subject line</strong>. To use it in the body, just type{" "}
                  <code className="bg-muted px-1 rounded">{`{{investor.name}}`}</code> directly into any text block.
                </p>
              )}
            </div>
          </details>

          {editorForChannel}
        </div>
      )}

      {/* ========================= STEP 3 — REVIEW & SEND ========================= */}
      {step === 3 && (
        <div className="space-y-4">
          <h2 className="font-semibold text-base">Review &amp; send for approval</h2>

          {/* Compliance result — friendly */}
          <div className={`card-surface p-4 ${compliance.blocked ? "bg-rose-50/40" : "bg-emerald-50/30"}`}>
            <div className="flex items-center gap-3">
              <ShieldCheck className={`size-5 ${compliance.blocked ? "text-rose-600" : "text-emerald-600"}`} />
              <div className="flex-1">
                <div className="font-semibold text-sm">
                  {compliance.blocked ? "A few things to fix before sending" : "Compliance check passed"}
                </div>
                <div className="text-xs text-muted-foreground">Score {compliance.score}/100</div>
              </div>
              {fixLines.length > 0 && (
                <button
                  type="button"
                  onClick={applyComplianceFix}
                  className="text-xs font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 px-2.5 py-1 inline-flex items-center gap-1"
                >
                  <Sparkles className="size-3.5" /> Fix it for me
                </button>
              )}
            </div>
            {compliance.findings.length > 0 && (
              <ul className="mt-3 space-y-1.5 text-xs">
                {compliance.findings.map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <AlertCircle
                      className={`size-3.5 mt-0.5 shrink-0 ${f.severity === "block" ? "text-rose-600" : f.severity === "warn" ? "text-amber-600" : "text-blue-600"
                        }`}
                    />
                    <span>{f.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Summary */}
          <div className="card-surface p-4">
            <h3 className="font-semibold text-sm mb-3">Summary</h3>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-y-3 gap-x-4 text-sm">
              <SummaryItem label="Name" value={name} />
              <SummaryItem label="Channel" value={channelLabel} />
              <SummaryItem label="Type" value={categoryMeta?.label ?? category} />
              <SummaryItem label="Language" value={locale} />
            </dl>
          </div>

          {/* Attachments (email only really) */}
          <div className="card-surface p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Paperclip className="size-4 text-brand-cyan" /> Attachments ({attachments.length})
              </h3>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => pickAttachmentFile(-1)}
                  disabled={uploadingIdx === -1}
                  className="btn-secondary text-xs disabled:opacity-60"
                >
                  {uploadingIdx === -1 ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                  {uploadingIdx === -1 ? "Uploading…" : "Upload file"}
                </button>
                <button type="button" onClick={() => setAttachments((a) => [...a, { name: "", url: "" }])} className="btn-ghost text-xs">
                  <Plus className="size-3.5" /> Add URL
                </button>
              </div>
            </div>
            {/* Shared hidden input — the picker target for every upload button. */}
            <input ref={fileInputRef} type="file" className="hidden" onChange={onAttachmentFilePicked} />
            {attachments.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Upload a file (fund factsheet, KYC form, brochure) or paste a hosted link — auto-attached on every <strong>email</strong> send. Max 25 MB.
              </p>
            ) : (
              <ul className="space-y-2">
                {attachments.map((a, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <input
                      value={a.name}
                      onChange={(e) => setAttachments((arr) => arr.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))}
                      placeholder="Display name"
                      className="input-base text-sm w-1/3"
                    />
                    <input
                      value={a.url}
                      onChange={(e) => setAttachments((arr) => arr.map((x, idx) => (idx === i ? { ...x, url: e.target.value } : x)))}
                      placeholder="https://… (hosted file URL) or upload →"
                      className="input-base text-sm flex-1 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => pickAttachmentFile(i)}
                      disabled={uploadingIdx === i}
                      title="Upload a file for this attachment"
                      className="p-2 text-muted-foreground hover:text-brand-cyan hover:bg-brand-cyan/10 rounded-md disabled:opacity-60"
                    >
                      {uploadingIdx === i ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAttachments((arr) => arr.filter((_, idx) => idx !== i))}
                      className="p-2 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 rounded-md"
                    >
                      <Trash className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Advanced — hidden by default; the techie bits live here */}
          <details className="card-surface p-0 group">
            <summary className="flex items-center justify-between cursor-pointer list-none select-none px-4 py-3">
              <span className="font-semibold text-sm flex items-center gap-1.5">
                <ChevronDown className="size-4 -rotate-90 group-open:rotate-0 transition-transform" />
                Advanced settings
              </span>
              <span className="text-[11px] text-muted-foreground">Most people can skip this</span>
            </summary>
            <div className="px-4 pb-4 space-y-4">
              <Field label="Template key (used internally — auto-generated)">
                <input
                  value={key}
                  onChange={(e) => { setKeyEdited(true); setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_")); }}
                  className="input-base w-full font-mono text-sm"
                  placeholder="template_key"
                />
              </Field>

              {declaredVars.length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1.5">
                    Personalisation fields found in your message ({declaredVars.length}) — we guessed the format for each.
                  </div>
                  <div className="border rounded-md divide-y bg-background overflow-hidden">
                    {declaredVars.map((v, idx) => (
                      <div key={v.key} className="p-3 grid grid-cols-1 md:grid-cols-4 gap-3 items-center text-xs">
                        <div className="font-mono font-semibold text-slate-700 truncate">{v.key}</div>
                        <div>
                          <label className="text-[9px] text-muted-foreground block font-medium uppercase tracking-wider mb-0.5">Format</label>
                          <SelectField
                            value={v.type}
                            onChange={(e) => {
                              const next = [...declaredVars];
                              next[idx].type = e.target.value as any;
                              setDeclaredVars(next);
                            }}
                            size="sm"
                            className="w-full"
                          >
                            <option value="string">Text</option>
                            <option value="number">Number</option>
                            <option value="currency">Currency (INR)</option>
                            <option value="date">Date</option>
                            <option value="boolean">Yes / No</option>
                            <option value="url">Link</option>
                          </SelectField>
                        </div>
                        <div>
                          <label className="text-[9px] text-muted-foreground block font-medium uppercase tracking-wider mb-0.5">Source path</label>
                          <input
                            value={v.source ?? ""}
                            onChange={(e) => {
                              const next = [...declaredVars];
                              next[idx].source = e.target.value;
                              setDeclaredVars(next);
                            }}
                            placeholder="e.g. investor.name"
                            className="input-base py-1 px-2 text-xs w-full font-mono bg-background"
                          />
                        </div>
                        <div className="flex items-center gap-2 md:pt-3">
                          <input
                            type="checkbox"
                            id={`req-${v.key}`}
                            checked={!!v.required}
                            onChange={(e) => {
                              const next = [...declaredVars];
                              next[idx].required = e.target.checked;
                              setDeclaredVars(next);
                            }}
                            className="rounded border-gray-300 text-primary focus:ring-primary size-3.5"
                          />
                          <label htmlFor={`req-${v.key}`} className="cursor-pointer text-xs text-slate-600 select-none">
                            Required
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </details>
        </div>
      )}

      {/* ============================ STICKY FOOTER NAV ============================ */}
      <div className="sticky bottom-3 z-10 mt-6 rounded-xl border border-border bg-card/95 backdrop-blur shadow-lg px-4 py-3 flex items-center justify-between gap-3">
        <div>
          {step > 1 && (
            <button type="button" onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)} className="btn-secondary text-sm flex items-center gap-1">
              <ChevronLeft className="size-4" /> Back
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => save({ submitForApproval: false })} disabled={saving} className="btn-secondary text-sm flex items-center gap-1">
            <Save className="size-4" /> Save draft
          </button>
          {step < 3 ? (
            <button type="button" onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)} className="btn-primary text-sm flex items-center gap-1">
              {step === 1 ? "Next: Design" : "Next: Review"} <ArrowRight className="size-4" />
            </button>
          ) : (
            <button
              disabled={compliance.blocked || saving}
              onClick={() => save({ submitForApproval: true })}
              className="btn-primary text-sm disabled:opacity-50 flex items-center gap-1"
              title={compliance.blocked ? "Fix the compliance issues above before submitting" : undefined}
            >
              <Send className="size-4" /> Submit for approval
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-medium truncate" title={value}>{value || "—"}</dd>
    </div>
  );
}

/** Insert `token` at the textarea's caret (or append if no caret). */
function spliceAtCursor(el: HTMLTextAreaElement | null, value: string, token: string): string {
  if (!el) return value + token;
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  const next = value.slice(0, start) + token + value.slice(end);
  requestAnimationFrame(() => {
    try {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    } catch { }
  });
  return next;
}
