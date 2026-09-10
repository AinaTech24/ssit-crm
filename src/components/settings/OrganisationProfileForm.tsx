"use client";

/**
 * MFD Organisation Profile — spec § 6, Module 1.
 *
 * Three groups:
 *   1. Editable by Owner — identity, contact, address, branding, business profile.
 *   2. Master records (read-only here) — ARN, EUIN, GSTIN, Owner Name, Created date.
 *   3. License / package (read-only here, Equitywala controls) — package, status, dates.
 *
 * Logo upload: posts to /api/compliance/upload-url (kind=general) to get a
 * presigned PUT URL, uploads the file directly to S3, then patches the tenant
 * with the resulting public URL.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Save, Loader2, Upload, CreditCard, AlertCircle } from "lucide-react";
import { HelpHint } from "@/components/help/HelpHint";
import { LOGO_SLOTS, type LogoField } from "@/lib/branding/logo";

type OwnerLite = { id: string; name: string; email: string } | null;

export function OrganisationProfileForm({
  tenant,
  owner,
  subscription,
  pkg,
  license,
}: {
  tenant: any;
  owner: OwnerLite;
  subscription: any | null;
  pkg: any | null;
  license: any;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  // Which logo slot a click on the shared hidden file input targets.
  const activeField = useRef<LogoField>("logoUrl");
  const [form, setForm] = useState({
    displayName: tenant.displayName ?? "",
    legalName: tenant.legalName ?? "",
    email: tenant.email ?? "",
    phone: tenant.phone ?? "",
    website: tenant.website ?? "",
    primaryColor: tenant.primaryColor ?? "#1f2937",
    secondaryColor: tenant.secondaryColor ?? "#d22e32",
    logoUrl: tenant.logoUrl ?? "",
    logoIconUrl: (tenant as any).logoIconUrl ?? "",
    logoMarkUrl: (tenant as any).logoMarkUrl ?? "",
    faviconUrl: (tenant as any).faviconUrl ?? "",
    aumRange: tenant.aumRange ?? "",
    sipBookRange: tenant.sipBookRange ?? "",
    teamSize: tenant.teamSize ?? "",
    currentSoftwareUsed: tenant.currentSoftwareUsed ?? "",
    dormancyWindowDays: String((tenant as any).dormancyWindowDays ?? 180),
    addressLine1: tenant.address?.line1 ?? "",
    city: tenant.address?.city ?? "",
    state: tenant.address?.state ?? "",
    pincode: tenant.address?.pincode ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/tenant", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          // The API expects a number in 30–1095; blank → skip (keeps current).
          dormancyWindowDays:
            form.dormancyWindowDays === "" ? undefined : Math.min(1095, Math.max(30, Math.round(Number(form.dormancyWindowDays) || 180))),
          address: {
            line1: form.addressLine1,
            city: form.city,
            state: form.state,
            pincode: form.pincode,
            country: "India",
          },
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        // Surface WHICH field failed validation instead of a bare "invalid body".
        const fields = Array.isArray(j.issues)
          ? j.issues
              .map((i: any) => (Array.isArray(i.path) ? i.path.join(".") : ""))
              .filter(Boolean)
              .join(", ")
          : "";
        setErr((j.error ?? "Save failed") + (fields ? ` — check: ${fields}` : ""));
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function uploadAsset(file: File, field: LogoField) {
    setUploadErr(null);
    setUploadingField(field);
    try {
      // 1. Ask server for a presigned PUT URL
      const presign = await fetch("/api/compliance/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "image/png",
          kind: "general",
          docType: "logo", // → firm/<firm>/logos/…
        }),
      });
      const presignJson = await presign.json();
      if (!presign.ok) throw new Error(presignJson.error ?? "presign failed");

      // 2. PUT the file directly to S3
      const put = await fetch(presignJson.url, {
        method: "PUT",
        headers: { "content-type": file.type || "image/png" },
        body: file,
      });
      if (!put.ok) throw new Error("upload to S3 failed");

      // 3. Store the app-served asset URL `/api/upload-local/<key>`. That route
      //    serves the object from the local volume OR S3 (whichever has it), so
      //    the same URL works regardless of where the bytes landed — and S3
      //    objects (private bucket) are served through the app, not a raw,
      //    403-ing S3 URL.
      const publicUrl = `/api/upload-local/${presignJson.key}`;

      setForm((s) => ({ ...s, [field]: publicUrl }));
    } catch (e: any) {
      setUploadErr(e.message ?? "logo upload failed");
    } finally {
      setUploadingField(null);
    }
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) void uploadAsset(f, activeField.current);
    e.target.value = ""; // allow re-picking the same file
  }

  function set(k: string, v: string) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  return (
    <form onSubmit={save} className="space-y-4">
      {/* -------------------------------- Identity -------------------------------- */}
      <Section title="Identity">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Row label="Organisation name (display)" value={form.displayName} onChange={(v) => set("displayName", v)} required />
          <Row label="Legal name" value={form.legalName} onChange={(v) => set("legalName", v)} required />
          <Row label="Owner name" value={owner?.name ?? "—"} disabled note={owner ? owner.email : ""} />
          <Row label="ARN" helpTerm="ARN" value={tenant.arn ?? "—"} disabled note="Managed by Equitywala" />
          <Row label="Principal EUIN" helpTerm="EUIN" value={tenant.principalEuin ?? "—"} disabled note="Managed by Equitywala" />
          <Row label="GSTIN" value={tenant.gstNumber ?? "—"} disabled />
          <Row
            label="Created"
            value={tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}
            disabled
          />
        </div>
      </Section>

      {/* --------------------------------- Contact -------------------------------- */}
      <Section title="Contact">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Row label="Email" value={form.email} onChange={(v) => set("email", v)} type="email" />
          <Row label="Mobile / phone" value={form.phone} onChange={(v) => set("phone", v)} placeholder="+91…" />
          <Row label="Website" value={form.website} onChange={(v) => set("website", v)} placeholder="https://" />
        </div>
      </Section>

      {/* --------------------------------- Address -------------------------------- */}
      <Section title="Address">
        <Row label="Address line" value={form.addressLine1} onChange={(v) => set("addressLine1", v)} />
        <div className="grid grid-cols-3 gap-3">
          <Field label="City">
            <input value={form.city} onChange={(e) => set("city", e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
          </Field>
          <Field label="State">
            <input value={form.state} onChange={(e) => set("state", e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
          </Field>
          <Field label="Pincode">
            <input value={form.pincode} onChange={(e) => set("pincode", e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
          </Field>
        </div>
      </Section>

      {/* --------------------------------- Branding ------------------------------- */}
      <Section title="Branding">
        {/* One shared hidden file input; each slot's "Upload" sets activeField first. */}
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp,.ico,image/x-icon" onChange={onPickFile} className="hidden" />
        <p className="text-xs text-muted-foreground -mt-1">
          Upload a logo for each context so your branding looks sharp everywhere. Only the
          <strong> Full logo</strong> is required — the rest fall back to it automatically. Transparent PNGs work best.
        </p>

        {uploadErr && (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-lg p-3 flex items-start gap-2.5 my-2">
            <AlertCircle className="size-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-semibold">Upload failed</div>
              <div className="text-rose-600/90 mt-0.5">{uploadErr}</div>
            </div>
            <button
              type="button"
              onClick={() => setUploadErr(null)}
              className="text-[10px] text-rose-700 font-semibold hover:underline shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          {LOGO_SLOTS.map((slot) => {
            const url = (form as any)[slot.field] as string;
            return (
              <div key={slot.field} className="rounded-lg border p-3 flex gap-3">
                <div
                  className={`shrink-0 ${slot.shape === "wide" ? "w-24 h-14" : "size-14"} rounded-md border bg-muted/30 grid place-items-center overflow-hidden`}
                >
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt={slot.label} className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="text-[9px] text-muted-foreground text-center px-1 leading-tight">No image</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium flex items-center gap-1.5">
                    {slot.label}
                    {slot.field === "logoUrl" && (
                      <span className="text-[9px] uppercase tracking-wide bg-brand-cyan-light/60 text-brand-cyan-deep rounded px-1 py-0.5 font-semibold">
                        Recommended
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{slot.hint}</div>
                  <div className="text-[10px] text-muted-foreground/80 mt-0.5">Used in: {slot.used}</div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        activeField.current = slot.field;
                        fileRef.current?.click();
                      }}
                      disabled={uploadingField !== null}
                      className="rounded-md border px-2 py-1 text-xs flex items-center gap-1 hover:bg-accent disabled:opacity-50"
                    >
                      {uploadingField === slot.field ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Upload className="size-3" />
                      )}
                      {uploadingField === slot.field ? "Uploading…" : url ? "Replace" : "Upload"}
                    </button>
                    {url && (
                      <button
                        type="button"
                        onClick={() => set(slot.field, "")}
                        className="text-[11px] text-muted-foreground hover:text-rose-700 hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-3 gap-3 items-end pt-3 border-t">
          <Field label="Primary colour">
            <input
              type="color"
              value={form.primaryColor}
              onChange={(e) => set("primaryColor", e.target.value)}
              className="h-10 w-full border rounded-md cursor-pointer"
            />
          </Field>
          <Field label="Secondary colour">
            <input
              type="color"
              value={form.secondaryColor}
              onChange={(e) => set("secondaryColor", e.target.value)}
              className="h-10 w-full border rounded-md cursor-pointer"
            />
          </Field>
          <Field label="Preview">
            <div
              className="h-10 rounded-md border flex items-center justify-center text-white text-sm font-semibold"
              style={{ backgroundColor: form.primaryColor }}
            >
              {form.displayName || "Firm"}
            </div>
          </Field>
        </div>
      </Section>

      {/* ----------------------------- Business profile --------------------------- */}
      <Section title="Business profile">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Row label="Approx AUM range" value={form.aumRange} onChange={(v) => set("aumRange", v)} placeholder="e.g. ₹50Cr – ₹100Cr" />
          <Row label="SIP book range" value={form.sipBookRange} onChange={(v) => set("sipBookRange", v)} placeholder="e.g. ₹50L – ₹1Cr" />
          <Row label="Team size" value={form.teamSize} onChange={(v) => set("teamSize", v)} placeholder="1–5, 6–10, 11–25, 25+" />
          <Row label="Current software" value={form.currentSoftwareUsed} onChange={(v) => set("currentSoftwareUsed", v)} placeholder="e.g. Wealth Elite, Excel, Investwell" />
          <Row
            label="Dormancy window (days)"
            type="number"
            value={form.dormancyWindowDays}
            onChange={(v) => set("dormancyWindowDays", v)}
            placeholder="180"
            note="A client with no transaction for this many days counts as “dormant” (Investors KPIs, churn report, and the copilot). 30–1095; default 180."
          />
        </div>
      </Section>


      {err && <div className="text-sm text-rose-600">{err}</div>}

      <div className="flex justify-end gap-2 sticky bottom-4 bg-card border rounded-lg p-3">
        {saved && <span className="text-xs text-emerald-600 self-center">✓ Saved</span>}
        <button
          disabled={busy}
          className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function fmtDate(d: any): string {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border rounded-lg bg-card p-5 space-y-3">
      <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
  disabled,
  note,
  tone,
  helpTerm,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  note?: string;
  tone?: "emerald" | "rose";
  helpTerm?: string;
}) {
  return (
    <Field label={label} note={note} helpTerm={helpTerm}>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        className={`w-full border rounded-md px-3 py-2 text-sm bg-background disabled:opacity-70 disabled:cursor-not-allowed ${
          tone === "rose" ? "text-rose-700" : tone === "emerald" ? "text-emerald-700" : ""
        }`}
      />
    </Field>
  );
}

function Field({
  label,
  children,
  note,
  helpTerm,
}: {
  label: string;
  children: React.ReactNode;
  note?: string;
  helpTerm?: string;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1 flex items-center justify-between">
        <span className="inline-flex items-center">
          {label}
          {helpTerm && <HelpHint term={helpTerm} />}
        </span>
        {note && <span className="text-[10px] text-muted-foreground font-normal">{note}</span>}
      </div>
      {children}
    </label>
  );
}
