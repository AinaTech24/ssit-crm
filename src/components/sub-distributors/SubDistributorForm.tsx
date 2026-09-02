"use client";

/**
 * Create + edit form for a sub-distributor. Reused for /new and /[id]
 * pages — the only difference is the initial state and the HTTP verb.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Loader2, Trash2 } from "lucide-react";
import { ThemeSelect } from "@/components/ui/ThemeSelect";
import { ThemeDate } from "@/components/ui/ThemeDate";

const ASSOCIATIONS: Array<{ value: string; label: string }> = [
  { value: "individual", label: "Individual" },
  { value: "firm", label: "Firm / Proprietorship" },
  { value: "channel_partner", label: "Channel partner" },
  { value: "referral_partner", label: "Referral partner" },
  { value: "internal_referral", label: "Internal referral" },
  { value: "other", label: "Other" },
];

type FormValues = {
  id?: string;
  name: string;
  code: string | null;
  typeOfAssociation: string;
  city: string | null;
  email: string | null;
  mobile: string | null;
  panNumber: string | null;
  nismCertificateNo: string | null;
  nismExamDate: string | null;
  nismExpiryAt: string | null;
  nismCategory: string | null;
  arnNumber: string | null;
  arnRegistrationDate: string | null;
  arnExpiryAt: string | null;
  euin: string | null;
  euinExpiryAt: string | null;
  commissionSplitPct: number | null;
  bankDetails: {
    accountHolder?: string;
    accountNumber?: string;
    ifsc?: string;
    bankName?: string;
    branch?: string;
    upi?: string;
  } | null;
  status: string;
  onboardedAt: string | null;
  terminatedAt?: string | null;
  remarks: string | null;
  dscOnFile: boolean;
  relationshipManagerId?: string | null;
};

const EMPTY: FormValues = {
  name: "",
  code: null,
  typeOfAssociation: "individual",
  city: null,
  email: null,
  mobile: null,
  panNumber: null,
  nismCertificateNo: null,
  nismExamDate: null,
  nismExpiryAt: null,
  nismCategory: null,
  arnNumber: null,
  arnRegistrationDate: null,
  arnExpiryAt: null,
  euin: null,
  euinExpiryAt: null,
  commissionSplitPct: null,
  bankDetails: null,
  status: "active",
  onboardedAt: null,
  remarks: null,
  dscOnFile: false,
};

export function SubDistributorForm({
  mode,
  initial,
}: {
  mode: "create" | "edit";
  initial?: Partial<FormValues> & { id?: string };
}) {
  const router = useRouter();
  const [v, setV] = useState<FormValues>({ ...EMPTY, ...(initial ?? {}) });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function field<K extends keyof FormValues>(k: K, val: FormValues[K]) {
    setV((p) => ({ ...p, [k]: val }));
    setOk(null);
  }

  function bankField(k: keyof NonNullable<FormValues["bankDetails"]>, val: string) {
    setV((p) => ({
      ...p,
      bankDetails: { ...(p.bankDetails ?? {}), [k]: val || undefined },
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const url =
        mode === "create"
          ? "/api/sub-distributors"
          : `/api/sub-distributors/${initial?.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const body: any = { ...v };
      // Drop empty bankDetails so we don't store an empty object.
      if (
        body.bankDetails &&
        Object.keys(body.bankDetails).every((k) => !body.bankDetails[k])
      ) {
        body.bankDetails = null;
      }
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Failed (${res.status})`);
        return;
      }
      if (mode === "create") {
        router.push(`/dashboard/sub-distributors/${j.subDistributor.id}`);
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

  async function terminate() {
    if (!initial?.id) return;
    if (!confirm("Mark this sub-distributor as terminated? Commission history is preserved.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sub-distributors/${initial.id}`, {
        method: "DELETE",
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Failed to terminate");
        return;
      }
      router.push("/dashboard/sub-distributors?status=terminated");
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
      <Section title="Identity">
        <Grid>
          <Field label="Name *">
            <input
              required
              value={v.name}
              onChange={(e) => field("name", e.target.value)}
              className="input-base text-sm w-full"
              placeholder="Sub-distributor or firm name"
            />
          </Field>
          <Field label="Sub-distributor code">
            <input
              value={v.code ?? ""}
              onChange={(e) => field("code", e.target.value || null)}
              className="input-base text-sm w-full font-mono"
              placeholder="e.g. SD-001"
            />
          </Field>
          <Field label="Type of association">
            <ThemeSelect
              value={v.typeOfAssociation}
              onChange={(val) => field("typeOfAssociation", val)}
              className="text-sm w-full"
            >
              {ASSOCIATIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </ThemeSelect>
          </Field>
          <Field label="Status">
            <ThemeSelect
              value={v.status}
              onChange={(val) => field("status", val)}
              className="text-sm w-full"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="terminated">Terminated</option>
            </ThemeSelect>
          </Field>
          <Field label="City">
            <input
              value={v.city ?? ""}
              onChange={(e) => field("city", e.target.value || null)}
              className="input-base text-sm w-full"
            />
          </Field>
          <Field label="Onboarded date">
            <ThemeDate
              value={v.onboardedAt ?? ""}
              onChange={(val) => field("onboardedAt", val || null)}
              className="text-sm w-full"
            />
          </Field>
        </Grid>
      </Section>

      {/* Contact */}
      <Section title="Contact">
        <Grid>
          <Field label="Email">
            <input
              type="email"
              value={v.email ?? ""}
              onChange={(e) => field("email", e.target.value || null)}
              className="input-base text-sm w-full"
            />
          </Field>
          <Field label="Mobile">
            <input
              value={v.mobile ?? ""}
              onChange={(e) => field("mobile", e.target.value || null)}
              className="input-base text-sm w-full"
            />
          </Field>
          <Field label="PAN">
            <input
              value={v.panNumber ?? ""}
              onChange={(e) =>
                field("panNumber", e.target.value.toUpperCase() || null)
              }
              className="input-base text-sm w-full font-mono"
              placeholder="ABCDE1234F"
              maxLength={10}
            />
          </Field>
        </Grid>
      </Section>

      {/* Licensing */}
      <Section title="Licensing — ARN / EUIN / NISM">
        <Grid>
          <Field label="ARN number">
            <input
              value={v.arnNumber ?? ""}
              onChange={(e) => field("arnNumber", e.target.value || null)}
              className="input-base text-sm w-full font-mono"
              placeholder="ARN-123456"
            />
          </Field>
          <Field label="ARN registration date">
            <ThemeDate
              value={v.arnRegistrationDate ?? ""}
              onChange={(val) => field("arnRegistrationDate", val || null)}
              className="text-sm w-full"
            />
          </Field>
          <Field label="ARN expiry date">
            <ThemeDate
              value={v.arnExpiryAt ?? ""}
              onChange={(val) => field("arnExpiryAt", val || null)}
              className="text-sm w-full"
            />
          </Field>
          <Field label="EUIN">
            <input
              value={v.euin ?? ""}
              onChange={(e) => field("euin", e.target.value || null)}
              className="input-base text-sm w-full font-mono"
              placeholder="E123456"
            />
          </Field>
          <Field label="EUIN expiry">
            <ThemeDate
              value={v.euinExpiryAt ?? ""}
              onChange={(val) => field("euinExpiryAt", val || null)}
              className="text-sm w-full"
            />
          </Field>
          <Field label="NISM certificate no.">
            <input
              value={v.nismCertificateNo ?? ""}
              onChange={(e) =>
                field("nismCertificateNo", e.target.value || null)
              }
              className="input-base text-sm w-full font-mono"
            />
          </Field>
          <Field label="NISM category">
            <input
              value={v.nismCategory ?? ""}
              onChange={(e) => field("nismCategory", e.target.value || null)}
              className="input-base text-sm w-full"
              placeholder="V-A"
            />
          </Field>
          <Field label="NISM exam date">
            <ThemeDate
              value={v.nismExamDate ?? ""}
              onChange={(val) => field("nismExamDate", val || null)}
              className="text-sm w-full"
            />
          </Field>
          <Field label="NISM expiry">
            <ThemeDate
              value={v.nismExpiryAt ?? ""}
              onChange={(val) => field("nismExpiryAt", val || null)}
              className="text-sm w-full"
            />
          </Field>
          <Field label="DSC on file">
            <label className="flex items-center gap-2 h-9 px-3 border rounded-md bg-background">
              <input
                type="checkbox"
                checked={v.dscOnFile}
                onChange={(e) => field("dscOnFile", e.target.checked)}
                className="size-4"
              />
              <span className="text-xs">
                {v.dscOnFile ? "Yes" : "No"}
              </span>
            </label>
          </Field>
        </Grid>
      </Section>

      {/* Commission + payout */}
      <Section title="Commission & payout">
        <Grid>
          <Field label="Commission split (%)">
            <input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={v.commissionSplitPct ?? ""}
              onChange={(e) =>
                field(
                  "commissionSplitPct",
                  e.target.value === "" ? null : Number(e.target.value)
                )
              }
              className="input-base text-sm w-full"
              placeholder="e.g. 70.00"
            />
          </Field>
        </Grid>
        <Grid>
          <Field label="Bank account holder">
            <input
              value={v.bankDetails?.accountHolder ?? ""}
              onChange={(e) => bankField("accountHolder", e.target.value)}
              className="input-base text-sm w-full"
            />
          </Field>
          <Field label="Account number">
            <input
              value={v.bankDetails?.accountNumber ?? ""}
              onChange={(e) => bankField("accountNumber", e.target.value)}
              className="input-base text-sm w-full font-mono"
            />
          </Field>
          <Field label="IFSC">
            <input
              value={v.bankDetails?.ifsc ?? ""}
              onChange={(e) =>
                bankField("ifsc", e.target.value.toUpperCase())
              }
              className="input-base text-sm w-full font-mono"
              maxLength={11}
            />
          </Field>
          <Field label="Bank name">
            <input
              value={v.bankDetails?.bankName ?? ""}
              onChange={(e) => bankField("bankName", e.target.value)}
              className="input-base text-sm w-full"
            />
          </Field>
          <Field label="UPI ID">
            <input
              value={v.bankDetails?.upi ?? ""}
              onChange={(e) => bankField("upi", e.target.value)}
              className="input-base text-sm w-full font-mono"
              placeholder="optional"
            />
          </Field>
        </Grid>
      </Section>

      {/* Remarks */}
      <Section title="Remarks">
        <textarea
          rows={3}
          value={v.remarks ?? ""}
          onChange={(e) => field("remarks", e.target.value || null)}
          className="input-base text-sm w-full"
          placeholder="Free-form notes — anything the structured fields don't cover."
        />
      </Section>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-4 border-t">
        {mode === "edit" && v.status !== "terminated" ? (
          <button
            type="button"
            onClick={terminate}
            disabled={busy}
            className="btn-ghost text-xs text-rose-600 hover:bg-rose-50"
          >
            <Trash2 className="size-3.5" /> Terminate
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
          {mode === "create" ? "Register" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
        {title}
      </h3>
      {children}
    </div>
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
