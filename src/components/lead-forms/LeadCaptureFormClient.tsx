"use client";

/**
 * Public lead capture form — client component.
 *
 * Renders the universal fields (name + email + phone + notes) plus any
 * tenant-configured extras, applies brand color, and posts to the public
 * endpoint. Shows a thank-you state or the configured redirect URL on
 * success.
 *
 * No dashboard chrome — designed to be safely embedded on the MFD's own
 * website via iframe.
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";

type Field = {
  key: string;
  label: string;
  type: "text" | "email" | "tel" | "number" | "select" | "textarea";
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
};

export function LeadCaptureFormClient({
  slug,
  form,
  tenant,
}: {
  slug: string;
  form: {
    id: string;
    name: string;
    description?: string;
    fields?: Field[];
    branding?: {
      primaryColor?: string;
      logoUrl?: string;
      thankYouMessage?: string;
      redirectUrl?: string;
    } | null;
  };
  tenant: {
    displayName?: string;
    primaryColor?: string;
    logoUrl?: string;
    arn?: string;
  } | null;
}) {
  const primary =
    form.branding?.primaryColor ?? tenant?.primaryColor ?? "#1e40af";
  const logo = form.branding?.logoUrl ?? tenant?.logoUrl;
  const thankYou =
    form.branding?.thankYouMessage ??
    "Thank you. A relationship manager will reach out shortly.";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [extras, setExtras] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Honeypot — bots fill hidden fields.
  const [hp, setHp] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/public/lead-forms/${slug}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone,
          notes,
          _gotcha: hp || undefined,
          ...extras,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `Submission failed (${res.status})`);
        return;
      }
      if (form.branding?.redirectUrl) {
        window.location.href = form.branding.redirectUrl;
        return;
      }
      setDone(true);
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <div
            className="size-12 rounded-full mx-auto mb-3 flex items-center justify-center text-white text-2xl"
            style={{ backgroundColor: primary }}
          >
            ✓
          </div>
          <h1 className="text-xl font-semibold text-slate-800 mb-1">
            Got it.
          </h1>
          <p className="text-sm text-slate-600">{thankYou}</p>
          {tenant?.arn && (
            <p className="text-[11px] text-slate-400 mt-6">
              {tenant.displayName} · ARN-{tenant.arn}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="max-w-lg mx-auto">
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          {/* Header */}
          <div
            className="px-8 py-6 text-white"
            style={{ backgroundColor: primary }}
          >
            {logo && (
              <img
                src={logo}
                alt="logo"
                className="h-10 mb-3 bg-white rounded p-1"
              />
            )}
            <h1 className="text-xl font-semibold">{form.name}</h1>
            {form.description && (
              <p className="text-sm opacity-90 mt-1">{form.description}</p>
            )}
          </div>

          {/* Form */}
          <form onSubmit={submit} className="p-8 space-y-4">
            {/* Honeypot — must remain visually hidden but in the DOM */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={hp}
              onChange={(e) => setHp(e.target.value)}
              className="absolute -left-[9999px] opacity-0"
              aria-hidden="true"
            />

            <Field label="Full name" required>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-1"
                style={
                  { "--tw-ring-color": primary } as React.CSSProperties
                }
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
              />
            </Field>
            <Field label="Phone">
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
              />
            </Field>

            {(form.fields ?? []).map((f) => (
              <Field key={f.key} label={f.label} required={f.required}>
                {f.type === "textarea" ? (
                  <textarea
                    value={extras[f.key] ?? ""}
                    onChange={(e) =>
                      setExtras((s) => ({ ...s, [f.key]: e.target.value }))
                    }
                    required={f.required}
                    placeholder={f.placeholder}
                    rows={3}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                ) : f.type === "select" ? (
                  <select
                    value={extras[f.key] ?? ""}
                    onChange={(e) =>
                      setExtras((s) => ({ ...s, [f.key]: e.target.value }))
                    }
                    required={f.required}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Select…</option>
                    {(f.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.type}
                    value={extras[f.key] ?? ""}
                    onChange={(e) =>
                      setExtras((s) => ({ ...s, [f.key]: e.target.value }))
                    }
                    required={f.required}
                    placeholder={f.placeholder}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                )}
              </Field>
            ))}

            <Field label="Anything else we should know?">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Optional"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </Field>

            {err && (
              <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                {err}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 inline-flex items-center justify-center gap-2"
              style={{ backgroundColor: primary }}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              Submit
            </button>

            <p className="text-[11px] text-slate-400 pt-2">
              By submitting, you agree to be contacted by{" "}
              {tenant?.displayName ?? "this firm"} regarding your enquiry.
              Mutual fund investments are subject to market risks.
            </p>
          </form>

          {tenant && (
            <div className="border-t border-slate-100 bg-slate-50 px-8 py-3 text-[11px] text-slate-500">
              {tenant.displayName}
              {tenant.arn && ` · ARN-${tenant.arn}`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600 block mb-1">
        {label} {required && <span className="text-rose-500">*</span>}
      </span>
      {children}
    </label>
  );
}
