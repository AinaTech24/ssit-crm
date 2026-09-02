"use client";

/**
 * Create / edit form for a legal registration. Reused at /new and /[id].
 *
 * Form is intentionally flat — single column with clear groupings.
 * Document upload is implemented as URL-paste in the MVP; the next
 * iteration can wire this to the compliance-vault presigned URL flow
 * (see /api/compliance/upload-url).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Loader2, Trash2, Plus, ExternalLink, X } from "lucide-react";
import { ThemeSelect } from "@/components/ui/ThemeSelect";
import { ThemeDate } from "@/components/ui/ThemeDate";

const AUTHORITIES = [
  { value: "AMFI", label: "AMFI" },
  { value: "SEBI", label: "SEBI" },
  { value: "IRDAI", label: "IRDAI" },
  { value: "GST", label: "GST" },
  { value: "Income_Tax", label: "Income Tax (TAN / PAN / TDS)" },
  { value: "MCA", label: "MCA / ROC (CIN / LLPIN / DIN)" },
  { value: "RBI", label: "RBI" },
  { value: "State_Govt", label: "State Govt (Shop Act / Prof Tax)" },
  { value: "Local_Authority", label: "Local Authority (Trade License)" },
  { value: "Trademark_Registry", label: "Trademark Registry" },
  { value: "FIU_IND", label: "FIU-IND" },
  { value: "Other", label: "Other (specify below)" },
];

const FREQUENCIES = [
  { value: "perpetual", label: "Perpetual (no renewal)" },
  { value: "annual", label: "Annual" },
  { value: "biennial", label: "Biennial (2 years)" },
  { value: "triennial", label: "Triennial (3 years)" },
  { value: "5_year", label: "5-year" },
  { value: "10_year", label: "10-year" },
  { value: "on_demand", label: "On demand" },
  { value: "other", label: "Other (specify in renewal details)" },
];

const STATUSES = [
  { value: "active", label: "Active" },
  { value: "pending_renewal", label: "Pending renewal" },
  { value: "expired", label: "Expired" },
  { value: "surrendered", label: "Surrendered" },
  { value: "rejected", label: "Rejected" },
];

type Doc = {
  label: string;
  url: string;
  uploadedAt?: string;
  uploadedBy?: string;
};

type FormValues = {
  id?: string;
  registeredInNameOf: string;
  authority: string;
  authorityOther: string | null;
  registrationFor: string;
  registrationNumber: string | null;
  registrationDate: string | null;
  expiryAt: string | null;
  renewalFrequency: string;
  renewalDetails: string | null;
  status: string;
  documents: Doc[];
  remarks: string | null;
};

const EMPTY: FormValues = {
  registeredInNameOf: "",
  authority: "Other",
  authorityOther: null,
  registrationFor: "",
  registrationNumber: null,
  registrationDate: null,
  expiryAt: null,
  renewalFrequency: "annual",
  renewalDetails: null,
  status: "active",
  documents: [],
  remarks: null,
};

export function LegalRegistrationForm({
  mode,
  initial,
  defaultRegisteredInNameOf,
}: {
  mode: "create" | "edit";
  initial?: Partial<FormValues> & { id?: string };
  defaultRegisteredInNameOf?: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<FormValues>({
    ...EMPTY,
    registeredInNameOf: defaultRegisteredInNameOf ?? "",
    ...(initial ?? {}),
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [newDocLabel, setNewDocLabel] = useState("");
  const [newDocUrl, setNewDocUrl] = useState("");

  function field<K extends keyof FormValues>(k: K, val: FormValues[K]) {
    setV((p) => ({ ...p, [k]: val }));
    setOk(null);
  }

  function addDoc() {
    if (!newDocLabel.trim() || !newDocUrl.trim()) return;
    try {
      new URL(newDocUrl.trim());
    } catch {
      setErr("Document URL is not a valid URL.");
      return;
    }
    field("documents", [
      ...v.documents,
      {
        label: newDocLabel.trim(),
        url: newDocUrl.trim(),
        uploadedAt: new Date().toISOString(),
      },
    ]);
    setNewDocLabel("");
    setNewDocUrl("");
    setErr(null);
  }
  function removeDoc(i: number) {
    field(
      "documents",
      v.documents.filter((_, idx) => idx !== i)
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const url =
        mode === "create"
          ? "/api/legal-registrations"
          : `/api/legal-registrations/${initial?.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(v),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Failed (${res.status})`);
        return;
      }
      if (mode === "create") {
        router.push(`/dashboard/legal-registrations/${j.registration.id}`);
        return;
      }
      setOk("Saved.");
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function surrender() {
    if (!initial?.id) return;
    if (
      !confirm(
        "Mark this registration as surrendered? It will stay in the register for audit but no longer count as active."
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/legal-registrations/${initial.id}`, {
        method: "DELETE",
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Failed");
        return;
      }
      router.push("/dashboard/legal-registrations?status=surrendered");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card-surface p-5 space-y-5">
      {err && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
          {err}
        </div>
      )}
      {ok && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
          ✓ {ok}
        </div>
      )}

      {/* Identity */}
      <Grid>
        <Field label="Registered in the name of *">
          <input
            required
            value={v.registeredInNameOf}
            onChange={(e) => field("registeredInNameOf", e.target.value)}
            className="input-base text-sm w-full"
            placeholder="Firm or individual name"
          />
        </Field>
        <Field label="Status">
          <ThemeSelect
            value={v.status}
            onChange={(val) => field("status", val)}
            className="text-sm w-full"
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </ThemeSelect>
        </Field>
      </Grid>

      {/* Authority + purpose */}
      <Grid>
        <Field label="Regulatory / government authority *">
          <ThemeSelect
            value={v.authority}
            onChange={(val) => field("authority", val)}
            className="text-sm w-full"
          >
            {AUTHORITIES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </ThemeSelect>
        </Field>
        {v.authority === "Other" && (
          <Field label="Authority name (free text)">
            <input
              value={v.authorityOther ?? ""}
              onChange={(e) => field("authorityOther", e.target.value || null)}
              className="input-base text-sm w-full"
              placeholder="e.g. FSSAI, SEZ Authority"
            />
          </Field>
        )}
      </Grid>

      <Field label="Registration for *">
        <input
          required
          value={v.registrationFor}
          onChange={(e) => field("registrationFor", e.target.value)}
          className="input-base text-sm w-full"
          placeholder="e.g. Mutual fund distribution, GST under regular scheme, Investment advisory"
        />
      </Field>

      <Grid>
        <Field label="Registration / license number">
          <input
            value={v.registrationNumber ?? ""}
            onChange={(e) =>
              field("registrationNumber", e.target.value || null)
            }
            className="input-base text-sm w-full font-mono"
          />
        </Field>
        <Field label="Registration date">
          <ThemeDate
            value={v.registrationDate ?? ""}
            onChange={(val) => field("registrationDate", val || null)}
            className="text-sm w-full"
          />
        </Field>
        <Field label="Expiry date (leave blank if perpetual)">
          <ThemeDate
            value={v.expiryAt ?? ""}
            onChange={(val) => field("expiryAt", val || null)}
            className="text-sm w-full"
          />
        </Field>
        <Field label="Renewal frequency">
          <ThemeSelect
            value={v.renewalFrequency}
            onChange={(val) => field("renewalFrequency", val)}
            className="text-sm w-full"
          >
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </ThemeSelect>
        </Field>
      </Grid>

      <Field label="Renewal details (fee, portal, contact, lead time…)">
        <textarea
          rows={2}
          value={v.renewalDetails ?? ""}
          onChange={(e) => field("renewalDetails", e.target.value || null)}
          className="input-base text-sm w-full"
        />
      </Field>

      {/* Documents */}
      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
          Certificate &amp; supporting documents
        </div>
        {v.documents.length > 0 ? (
          <ul className="space-y-1.5">
            {v.documents.map((d, i) => (
              <li
                key={i}
                className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-md px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{d.label}</div>
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-slate-500 truncate inline-flex items-center gap-1 hover:text-slate-800"
                  >
                    {d.url} <ExternalLink className="size-2.5" />
                  </a>
                </div>
                <button
                  type="button"
                  onClick={() => removeDoc(i)}
                  className="ml-2 text-slate-400 hover:text-rose-600"
                  title="Remove"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            No documents linked yet. Paste a URL below (Google Drive, S3,
            DigiLocker, public link) to attach the certificate.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={newDocLabel}
            onChange={(e) => setNewDocLabel(e.target.value)}
            placeholder="Document label (e.g. ARN certificate)"
            className="input-base text-sm flex-1 min-w-[12rem]"
          />
          <input
            value={newDocUrl}
            onChange={(e) => setNewDocUrl(e.target.value)}
            placeholder="https://…"
            className="input-base text-sm flex-1 min-w-[12rem]"
          />
          <button
            type="button"
            onClick={addDoc}
            className="btn-ghost text-xs"
            disabled={!newDocLabel.trim() || !newDocUrl.trim()}
          >
            <Plus className="size-3.5" /> Add
          </button>
        </div>
      </div>

      {/* Remarks */}
      <Field label="Remarks">
        <textarea
          rows={3}
          value={v.remarks ?? ""}
          onChange={(e) => field("remarks", e.target.value || null)}
          className="input-base text-sm w-full"
          placeholder="Free-form notes — anything the structured fields don't cover."
        />
      </Field>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-4 border-t">
        {mode === "edit" && v.status !== "surrendered" ? (
          <button
            type="button"
            onClick={surrender}
            disabled={busy}
            className="btn-ghost text-xs text-rose-600 hover:bg-rose-50"
          >
            <Trash2 className="size-3.5" /> Mark surrendered
          </button>
        ) : (
          <span />
        )}
        <button type="submit" disabled={busy} className="btn-primary text-sm">
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {mode === "create" ? "Add registration" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium block mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
