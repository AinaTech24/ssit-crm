"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { ChevronLeft, Eye, ShieldCheck, AlertCircle, Save, Send } from "lucide-react";
import { runComplianceChecks, missingMandatoryLines } from "@/lib/comms/compliance";
import { SelectField } from "@/components/ui/SelectField";
import type { Template, TemplateVersion } from "@/db/schema";
import type { EmailDesignerBody } from "@/lib/email-designer/types";

const EmailDesigner = dynamic(
  () => import("@/components/email-designer/EmailDesigner").then((m) => m.EmailDesigner),
  { ssr: false, loading: () => <div className="skeleton h-[60vh] min-h-[400px] w-full rounded-xl" /> }
);

type Channel = "whatsapp" | "email" | "sms";
type Category = "transactional" | "utility" | "marketing" | "authentication";

function extractVariables(text: string): string[] {
  const matches = text.match(/\{\{([^}]+)\}\}/g) ?? [];
  return Array.from(new Set(matches.map((m) => m.slice(2, -2).trim())));
}

interface EditTemplateFormProps {
  initialTemplate: Template;
  initialVersion: TemplateVersion | null;
}

export function EditTemplateForm({ initialTemplate, initialVersion }: EditTemplateFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialTemplate.name);
  const [category, setCategory] = useState<Category>(initialTemplate.category as Category);
  const [locale, setLocale] = useState(initialTemplate.locale);

  // Dynamic tenant details loaded from API
  const [tenant, setTenant] = useState<{
    legalName?: string;
    arn?: string;
    principalEuin?: string;
    riaRegistered?: boolean;
  } | null>(null);

  useEffect(() => {
    fetch("/api/tenant")
      .then((r) => r.json())
      .then((data) => {
        if (data?.tenant) {
          setTenant({
            legalName: data.tenant.legalName ?? "",
            arn: data.tenant.arn ?? "",
            principalEuin: data.tenant.principalEuin ?? undefined,
            riaRegistered: !!data.tenant.riaRegistered,
          });
        }
      })
      .catch((err) => console.error("Failed to load tenant details:", err));
  }, []);

  // Email body
  const [emailBody, setEmailBody] = useState<EmailDesignerBody>(() => {
    if (initialTemplate.channel === "email" && initialVersion?.body) {
      return initialVersion.body as EmailDesignerBody;
    }
    return {
      subject: "",
      preheader: "",
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
  });

  // Plain-text channels (WA / SMS)
  const [waText, setWaText] = useState(() => {
    if (initialTemplate.channel === "whatsapp" && initialVersion?.body) {
      return (initialVersion.body as any).body?.text ?? "";
    }
    return "";
  });

  const [smsText, setSmsText] = useState(() => {
    if (initialTemplate.channel === "sms" && initialVersion?.body) {
      return (initialVersion.body as any).text ?? "";
    }
    return "";
  });

  const [dltId, setDltId] = useState(() => {
    if (initialTemplate.channel === "sms" && initialVersion?.body) {
      return (initialVersion.body as any).dltTemplateId ?? "";
    }
    return "";
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Determine if editing is allowed (only allowed on drafts)
  const isDraft = initialVersion?.approvalStatus === "draft";

  // Compliance score against rendered text
  const previewText = useMemo(() => {
    if (initialTemplate.channel === "email") {
      if (emailBody.mode === "html") return emailBody.html ?? "";
      return [
        emailBody.subject,
        emailBody.preheader,
        ...(emailBody.blocks ?? []).map((b: any) => b.text || b.title || b.subtitle || b.html || b.label || ""),
      ]
        .filter(Boolean)
        .join("\n");
    }
    if (initialTemplate.channel === "whatsapp") return waText;
    return smsText;
  }, [initialTemplate.channel, emailBody, waText, smsText]);

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
  >(() => {
    return (initialVersion?.variables as any[]) ?? [];
  });

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
      channel: initialTemplate.channel as any,
      category,
      tenant: activeTenant,
      text: previewText,
      subject: initialTemplate.channel === "email" ? emailBody.subject : undefined,
      dltTemplateId: initialTemplate.channel === "sms" ? dltId : undefined,
      whatsappSessionActive: false,
      hasMarketingConsent: true,
    });
  }, [previewText, emailBody.subject, initialTemplate.channel, category, dltId, activeTenant]);

  // Mandatory footer lines (disclaimer / ARN / firm name) missing from the body.
  // Only offered for the plain-text channels here; email carries them via the
  // designer footer + auto-injected renderer footer.
  const fixLines = useMemo(() => {
    if (initialTemplate.channel === "email") return [];
    return missingMandatoryLines({ category, text: previewText, tenant: activeTenant });
  }, [initialTemplate.channel, category, previewText, activeTenant]);

  function applyComplianceFix() {
    if (!fixLines.length) return;
    const append = (t: string) => `${(t ?? "").replace(/\s+$/, "")}\n\n${fixLines.join("\n")}`;
    if (initialTemplate.channel === "whatsapp") setWaText(append);
    else if (initialTemplate.channel === "sms") setSmsText(append);
  }

  async function save(opts: { submitForApproval?: boolean }) {
    if (!isDraft) {
      setError("Cannot edit content of an already submitted or approved version. Create a new version instead.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body =
        initialTemplate.channel === "email"
          ? emailBody
          : initialTemplate.channel === "whatsapp"
            ? { body: { text: waText } }
            : { dltTemplateId: dltId, text: smsText };

      const payload = {
        name,
        category,
        body,
        variables: declaredVars,
      };
      const r = await fetch(`/api/templates/${initialTemplate.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      if (opts.submitForApproval) {
        const submitRes = await fetch(`/api/templates/${initialTemplate.id}/submit`, { method: "POST" });
        const submitData = await submitRes.json().catch(() => ({}));
        if (!submitRes.ok) throw new Error(submitData?.error ?? `Submission failed (HTTP ${submitRes.status})`);
      }
      router.push(`/dashboard/templates/${initialTemplate.id}`);
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Failed to save template");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-[1400px]">
      <Link
        href={`/dashboard/templates/${initialTemplate.id}`}
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Cancel and go back
      </Link>

      {!isDraft && (
        <div className="bg-amber-50 text-amber-800 p-4 rounded-lg text-sm border border-amber-200">
          <strong>Warning:</strong> You are viewing an approved/submitted version (Version {initialVersion?.versionNumber}). 
          Editing template content is disabled. To edit, please go back and click "Create New Version Draft".
        </div>
      )}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[300px]">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isDraft}
            className="text-2xl font-bold tracking-tight bg-transparent border-none outline-none w-full disabled:opacity-75"
            placeholder="Template name"
          />
          <div className="text-xs font-mono text-muted-foreground mt-1">
            {initialTemplate.key} · Version {initialVersion?.versionNumber ?? "—"} ({initialVersion?.approvalStatus})
          </div>
        </div>
        {isDraft && (
          <div className="flex gap-2">
            <button onClick={() => save({ submitForApproval: false })} disabled={saving} className="btn-secondary text-sm flex items-center gap-1">
              <Save className="size-4" /> Save draft
            </button>
            <button
              disabled={compliance.blocked || saving}
              onClick={() => save({ submitForApproval: true })}
              className="btn-primary text-sm disabled:opacity-50 flex items-center gap-1"
            >
              <Send className="size-4" /> Submit for approval
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="card-surface p-3 text-sm text-rose-700 bg-rose-50/40">{error}</div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Field label="Channel">
          <input
            value={initialTemplate.channel.toUpperCase()}
            disabled
            className="input-base w-full bg-slate-100/50 cursor-not-allowed select-none font-semibold text-slate-700"
          />
        </Field>
        <Field label="Category">
          <SelectField
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            disabled={!isDraft}
            className="w-full"
          >
            <option value="transactional">Transactional</option>
            <option value="utility">Utility</option>
            <option value="marketing">Marketing</option>
            <option value="authentication">Authentication</option>
          </SelectField>
        </Field>
        <Field label="Locale">
          <SelectField
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            disabled
            className="w-full"
          >
            <option value="en-IN">English (India)</option>
            <option value="hi-IN">Hindi</option>
            <option value="gu-IN">Gujarati</option>
            <option value="mr-IN">Marathi</option>
          </SelectField>
        </Field>
      </div>

      {/* Compliance score strip */}
      <div className="card-surface p-3 flex items-center gap-3">
        <ShieldCheck className={`size-4 ${compliance.blocked ? "text-rose-600" : "text-emerald-600"}`} />
        <div className="text-sm font-medium">Compliance score</div>
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full ${
              compliance.blocked ? "bg-rose-500" : compliance.score >= 90 ? "bg-emerald-500" : "bg-amber-500"
            }`}
            style={{ width: `${compliance.score}%` }}
          />
        </div>
        <div className="font-mono text-xs">{compliance.score}/100</div>
        {isDraft && fixLines.length > 0 && (
          <button
            type="button"
            onClick={applyComplianceFix}
            className="text-xs font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 px-2.5 py-1 flex items-center gap-1"
            title={`Insert the mandatory ${fixLines.join(" + ")}`}
          >
            <ShieldCheck className="size-3.5" /> Apply suggested fix
          </button>
        )}
        {compliance.findings.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">{compliance.findings.length} finding(s)</summary>
            <ul className="mt-2 space-y-1 max-w-md">
              {compliance.findings.map((f, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <AlertCircle
                    className={`size-3 mt-0.5 ${
                      f.severity === "block" ? "text-rose-600" : f.severity === "warn" ? "text-amber-600" : "text-blue-600"
                    }`}
                  />
                  <span>{f.message}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* Variable Configuration Panel */}
      {declaredVars.length > 0 && (
        <div className="card-surface p-4 space-y-3 bg-slate-50/50">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-xs text-slate-800">Auto-Detected Variables ({declaredVars.length})</h3>
            <span className="text-[10px] text-muted-foreground font-mono">Use {"{{variable_name}}"} in text to add more</span>
          </div>
          <div className="border rounded-md divide-y bg-background overflow-hidden">
            {declaredVars.map((v, idx) => (
              <div key={v.key} className="p-3 grid grid-cols-1 md:grid-cols-4 gap-3 items-center text-xs">
                <div className="font-mono font-semibold text-slate-700 truncate">{v.key}</div>
                <div>
                  <label className="text-[9px] text-muted-foreground block font-medium uppercase tracking-wider mb-0.5">Type</label>
                  <SelectField
                    value={v.type}
                    onChange={(e) => {
                      const next = [...declaredVars];
                      next[idx].type = e.target.value as any;
                      setDeclaredVars(next);
                    }}
                    disabled={!isDraft}
                    size="sm"
                    className="w-full"
                  >
                    <option value="string">String</option>
                    <option value="number">Number</option>
                    <option value="currency">Currency (INR)</option>
                    <option value="date">Date</option>
                    <option value="boolean">Boolean</option>
                    <option value="url">URL</option>
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
                    disabled={!isDraft}
                    placeholder="e.g. investor.name"
                    className="input-base py-1 px-2 text-xs w-full font-mono bg-background disabled:bg-slate-50 disabled:cursor-not-allowed"
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
                    disabled={!isDraft}
                    className="rounded border-gray-300 text-primary focus:ring-primary size-3.5 disabled:opacity-50"
                  />
                  <label htmlFor={`req-${v.key}`} className="cursor-pointer text-xs text-slate-600 select-none">
                    Required Variable
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Body editor — per channel */}
      {initialTemplate.channel === "email" && (
        <EmailDesigner value={emailBody} onChange={setEmailBody} tenant={undefined} />
      )}

      {initialTemplate.channel === "whatsapp" && (
        <div className="card-surface p-5 space-y-3">
          <Field label="Body">
            <textarea
              value={waText}
              onChange={(e) => setWaText(e.target.value)}
              disabled={!isDraft}
              rows={10}
              className="input-base font-mono w-full disabled:bg-slate-50 disabled:cursor-not-allowed"
            />
          </Field>
          <div className="text-xs text-muted-foreground">
            Use <code className="bg-muted px-1 rounded">{`{{name}}`}</code>,{" "}
            <code className="bg-muted px-1 rounded">{`{{amount}}`}</code> etc. for personalization. Variables resolve
            from subject + tenant + run context at send time.
          </div>
        </div>
      )}

      {initialTemplate.channel === "sms" && (
        <div className="card-surface p-5 space-y-3">
          <Field label="DLT Template ID">
            <input 
              value={dltId} 
              onChange={(e) => setDltId(e.target.value)} 
              disabled={!isDraft}
              className="input-base w-full font-mono disabled:bg-slate-50 disabled:cursor-not-allowed" 
              placeholder="1107171234567" 
            />
          </Field>
          <Field label="SMS body (max ~160 chars per part)">
            <textarea
              value={smsText}
              onChange={(e) => setSmsText(e.target.value)}
              disabled={!isDraft}
              rows={5}
              className="input-base font-mono w-full disabled:bg-slate-50 disabled:cursor-not-allowed"
            />
          </Field>
          <div className="text-xs text-muted-foreground">{smsText.length} characters · {Math.ceil(smsText.length / 160)} SMS part(s)</div>
        </div>
      )}
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
