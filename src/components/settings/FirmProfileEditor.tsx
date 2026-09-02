"use client";

/**
 * Firm profile editor — handles tenant-level scalar fields from the
 * Network FP "1.6 Firm Details" template. Renders as a static view with
 * an inline edit panel that toggles open for the whole form.
 *
 * Directors are managed via the API directly from this component (add /
 * resign) — they're a sub-collection of the tenant, but their own
 * lifecycle, so they get their own buttons.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Loader2, Pencil, X, Plus } from "lucide-react";

const LEGAL_STRUCTURES = [
  { value: "", label: "—" },
  { value: "sole_proprietorship", label: "Sole Proprietorship" },
  { value: "partnership", label: "Partnership" },
  { value: "llp", label: "LLP" },
  { value: "private_limited", label: "Private Limited" },
  { value: "public_limited", label: "Public Limited" },
  { value: "huf", label: "HUF" },
  { value: "one_person_company", label: "One Person Company (OPC)" },
  { value: "other", label: "Other" },
];

type Tenant = {
  id: string;
  legalName: string;
  displayName: string;
  legalStructure: string | null;
  incorporationDate: string | null;
  website: string | null;
  arn: string;
  panNumber: string | null;
  tan: string | null;
  gstNumber: string | null;
  nationalDistributorCode: string | null;
  primaryDin: string | null;
  auditorName: string | null;
  auditorFrn: string | null;
  bankAccount: any;
  authorizedSignatory: any;
  dataProtectionOfficer: any;
  address: any;
};

export function FirmProfileEditor({ tenant }: { tenant: Tenant }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [v, setV] = useState({
    displayName: tenant.displayName,
    legalName: tenant.legalName,
    website: tenant.website ?? "",
    legalStructure: tenant.legalStructure ?? "",
    incorporationDate: tenant.incorporationDate ?? "",
    panNumber: tenant.panNumber ?? "",
    tan: tenant.tan ?? "",
    gstNumber: tenant.gstNumber ?? "",
    nationalDistributorCode: tenant.nationalDistributorCode ?? "",
    primaryDin: tenant.primaryDin ?? "",
    auditorName: tenant.auditorName ?? "",
    auditorFrn: tenant.auditorFrn ?? "",
    bankAccount: tenant.bankAccount ?? {},
    authorizedSignatory: tenant.authorizedSignatory ?? {},
    dataProtectionOfficer: tenant.dataProtectionOfficer ?? {},
  });

  function setField<K extends keyof typeof v>(k: K, val: (typeof v)[K]) {
    setV((p) => ({ ...p, [k]: val }));
  }
  function setBank(k: string, val: string) {
    setV((p) => ({
      ...p,
      bankAccount: { ...(p.bankAccount ?? {}), [k]: val || undefined },
    }));
  }
  function setSig(k: string, val: string) {
    setV((p) => ({
      ...p,
      authorizedSignatory: {
        ...(p.authorizedSignatory ?? {}),
        [k]: val || undefined,
      },
    }));
  }
  function setDpo(k: string, val: string) {
    setV((p) => ({
      ...p,
      dataProtectionOfficer: {
        ...(p.dataProtectionOfficer ?? {}),
        [k]: val || undefined,
      },
    }));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const body: any = { ...v };
      // Empty objects → null
      if (
        body.bankAccount &&
        Object.keys(body.bankAccount).every((k) => !body.bankAccount[k])
      )
        body.bankAccount = null;
      if (
        body.authorizedSignatory &&
        Object.keys(body.authorizedSignatory).every(
          (k) => !body.authorizedSignatory[k]
        )
      )
        body.authorizedSignatory = null;
      if (
        body.dataProtectionOfficer &&
        Object.keys(body.dataProtectionOfficer).every(
          (k) => !body.dataProtectionOfficer[k]
        )
      )
        body.dataProtectionOfficer = null;
      const res = await fetch("/api/tenant", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Failed (${res.status})`);
        return;
      }
      setOk("Saved.");
      setEditing(false);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  // ── View mode ──────────────────────────────────────────────────────
  if (!editing) {
    return (
      <div className="space-y-3">
        {ok && (
          <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2 print:hidden">
            ✓ {ok}
          </div>
        )}

        {/* Basic Details */}
        <section className="card-surface p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-base">Basic details</h2>
            <button
              onClick={() => setEditing(true)}
              className="btn-ghost text-xs print:hidden"
            >
              <Pencil className="size-3" /> Edit
            </button>
          </div>
          <Grid>
            <Read label="Display name" value={tenant.displayName} />
            <Read label="Legal name" value={tenant.legalName} />
            <Read
              label="Legal structure"
              value={
                LEGAL_STRUCTURES.find((s) => s.value === tenant.legalStructure)
                  ?.label ?? "—"
              }
            />
            <Read
              label="Date of incorporation"
              value={tenant.incorporationDate ?? "—"}
            />
            <Read label="Website" value={tenant.website ?? "—"} mono />
            <Read
              label="Registered office"
              value={
                tenant.address
                  ? [
                      tenant.address.line1,
                      tenant.address.line2,
                      tenant.address.city,
                      tenant.address.state,
                      tenant.address.pincode,
                      tenant.address.country,
                    ]
                      .filter(Boolean)
                      .join(", ") || "—"
                  : "—"
              }
            />
          </Grid>
        </section>

        {/* Tax + IDs */}
        <section className="card-surface p-5 space-y-3">
          <h2 className="font-semibold text-base">Tax &amp; Identifiers</h2>
          <Grid>
            <Read label="ARN (AMFI)" value={tenant.arn} mono />
            <Read label="PAN" value={tenant.panNumber ?? "—"} mono />
            <Read label="TAN" value={tenant.tan ?? "—"} mono />
            <Read label="GSTIN" value={tenant.gstNumber ?? "—"} mono />
            <Read
              label="National Distributor Code"
              value={tenant.nationalDistributorCode ?? "—"}
              mono
            />
            <Read label="Primary DIN" value={tenant.primaryDin ?? "—"} mono />
          </Grid>
        </section>

        {/* Authorized Signatory */}
        <section className="card-surface p-5 space-y-3">
          <h2 className="font-semibold text-base">Authorized Signatory</h2>
          {tenant.authorizedSignatory ? (
            <Grid>
              <Read
                label="Name"
                value={tenant.authorizedSignatory?.name ?? "—"}
              />
              <Read
                label="Designation"
                value={tenant.authorizedSignatory?.designation ?? "—"}
              />
              <Read
                label="Email"
                value={tenant.authorizedSignatory?.email ?? "—"}
              />
              <Read
                label="Phone"
                value={tenant.authorizedSignatory?.phone ?? "—"}
              />
              <Read
                label="PAN"
                value={tenant.authorizedSignatory?.panNumber ?? "—"}
                mono
              />
              <Read
                label="DIN"
                value={tenant.authorizedSignatory?.din ?? "—"}
                mono
              />
            </Grid>
          ) : (
            <p className="text-xs text-muted-foreground">Not set.</p>
          )}
        </section>

        {/* Bank Account */}
        <section className="card-surface p-5 space-y-3">
          <h2 className="font-semibold text-base">
            Firm bank account (for AMC payouts)
          </h2>
          {tenant.bankAccount ? (
            <Grid>
              <Read
                label="Bank name"
                value={tenant.bankAccount?.bankName ?? "—"}
              />
              <Read
                label="Account holder"
                value={tenant.bankAccount?.accountHolder ?? "—"}
              />
              <Read
                label="Account number"
                value={tenant.bankAccount?.accountNumber ?? "—"}
                mono
              />
              <Read
                label="IFSC"
                value={tenant.bankAccount?.ifsc ?? "—"}
                mono
              />
              <Read
                label="Branch"
                value={tenant.bankAccount?.branch ?? "—"}
              />
              <Read
                label="Account type"
                value={tenant.bankAccount?.accountType ?? "—"}
              />
            </Grid>
          ) : (
            <p className="text-xs text-muted-foreground">Not set.</p>
          )}
        </section>

        {/* Auditor */}
        <section className="card-surface p-5 space-y-3">
          <h2 className="font-semibold text-base">Statutory auditor</h2>
          <Grid>
            <Read label="Auditor name" value={tenant.auditorName ?? "—"} />
            <Read
              label="ICAI Firm Registration Number"
              value={tenant.auditorFrn ?? "—"}
              mono
            />
          </Grid>
        </section>

        {/* Data Protection Officer (DPDP Act) */}
        <section className="card-surface p-5 space-y-3">
          <h2 className="font-semibold text-base">Data Protection Officer</h2>
          {tenant.dataProtectionOfficer?.name ? (
            <Grid>
              <Read label="Name" value={tenant.dataProtectionOfficer?.name ?? "—"} />
              <Read label="Email" value={tenant.dataProtectionOfficer?.email ?? "—"} />
              <Read label="Phone" value={tenant.dataProtectionOfficer?.phone ?? "—"} />
            </Grid>
          ) : (
            <p className="text-xs text-muted-foreground">
              Not set. Required under the DPDP Act for handling client personal data.
            </p>
          )}
        </section>
      </div>
    );
  }

  // ── Edit mode ──────────────────────────────────────────────────────
  return (
    <div className="card-surface p-5 space-y-5">
      {err && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
          {err}
        </div>
      )}

      <Section title="Basic details">
        <Grid>
          <Field label="Display name *">
            <input
              required
              value={v.displayName}
              onChange={(e) => setField("displayName", e.target.value)}
              className="input-base text-sm w-full"
            />
          </Field>
          <Field label="Legal name *">
            <input
              required
              value={v.legalName}
              onChange={(e) => setField("legalName", e.target.value)}
              className="input-base text-sm w-full"
            />
          </Field>
          <Field label="Legal structure">
            <select
              value={v.legalStructure}
              onChange={(e) => setField("legalStructure", e.target.value)}
              className="input-base text-sm w-full"
            >
              {LEGAL_STRUCTURES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date of incorporation">
            <input
              type="date"
              value={v.incorporationDate}
              onChange={(e) => setField("incorporationDate", e.target.value)}
              className="input-base text-sm w-full"
            />
          </Field>
          <Field label="Website">
            <input
              type="url"
              value={v.website}
              onChange={(e) => setField("website", e.target.value)}
              placeholder="https://"
              className="input-base text-sm w-full"
            />
          </Field>
        </Grid>
      </Section>

      <Section title="Tax & Identifiers">
        <Grid>
          <Field label="PAN">
            <input
              value={v.panNumber}
              onChange={(e) => setField("panNumber", e.target.value.toUpperCase())}
              maxLength={10}
              placeholder="ABCDE1234F"
              className="input-base text-sm w-full font-mono"
            />
          </Field>
          <Field label="TAN">
            <input
              value={v.tan}
              onChange={(e) => setField("tan", e.target.value.toUpperCase())}
              maxLength={10}
              placeholder="ABCD12345E"
              className="input-base text-sm w-full font-mono"
            />
          </Field>
          <Field label="GSTIN">
            <input
              value={v.gstNumber}
              onChange={(e) => setField("gstNumber", e.target.value.toUpperCase())}
              maxLength={15}
              className="input-base text-sm w-full font-mono"
            />
          </Field>
          <Field label="National Distributor Code (NDC)">
            <input
              value={v.nationalDistributorCode}
              onChange={(e) =>
                setField("nationalDistributorCode", e.target.value)
              }
              className="input-base text-sm w-full font-mono"
            />
          </Field>
          <Field label="Primary DIN">
            <input
              value={v.primaryDin}
              onChange={(e) => setField("primaryDin", e.target.value)}
              maxLength={8}
              placeholder="8 digits"
              className="input-base text-sm w-full font-mono"
            />
          </Field>
        </Grid>
      </Section>

      <Section title="Authorized Signatory">
        <Grid>
          <Field label="Name">
            <input
              value={v.authorizedSignatory?.name ?? ""}
              onChange={(e) => setSig("name", e.target.value)}
              className="input-base text-sm w-full"
            />
          </Field>
          <Field label="Designation">
            <input
              value={v.authorizedSignatory?.designation ?? ""}
              onChange={(e) => setSig("designation", e.target.value)}
              className="input-base text-sm w-full"
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={v.authorizedSignatory?.email ?? ""}
              onChange={(e) => setSig("email", e.target.value)}
              className="input-base text-sm w-full"
            />
          </Field>
          <Field label="Phone">
            <input
              value={v.authorizedSignatory?.phone ?? ""}
              onChange={(e) => setSig("phone", e.target.value)}
              className="input-base text-sm w-full"
            />
          </Field>
          <Field label="PAN">
            <input
              value={v.authorizedSignatory?.panNumber ?? ""}
              onChange={(e) => setSig("panNumber", e.target.value.toUpperCase())}
              maxLength={10}
              className="input-base text-sm w-full font-mono"
            />
          </Field>
          <Field label="DIN">
            <input
              value={v.authorizedSignatory?.din ?? ""}
              onChange={(e) => setSig("din", e.target.value)}
              maxLength={8}
              className="input-base text-sm w-full font-mono"
            />
          </Field>
        </Grid>
      </Section>

      <Section title="Firm bank account">
        <Grid>
          <Field label="Bank name">
            <input
              value={v.bankAccount?.bankName ?? ""}
              onChange={(e) => setBank("bankName", e.target.value)}
              className="input-base text-sm w-full"
            />
          </Field>
          <Field label="Account holder">
            <input
              value={v.bankAccount?.accountHolder ?? ""}
              onChange={(e) => setBank("accountHolder", e.target.value)}
              className="input-base text-sm w-full"
            />
          </Field>
          <Field label="Account number">
            <input
              value={v.bankAccount?.accountNumber ?? ""}
              onChange={(e) => setBank("accountNumber", e.target.value)}
              className="input-base text-sm w-full font-mono"
            />
          </Field>
          <Field label="IFSC">
            <input
              value={v.bankAccount?.ifsc ?? ""}
              onChange={(e) => setBank("ifsc", e.target.value.toUpperCase())}
              maxLength={11}
              className="input-base text-sm w-full font-mono"
            />
          </Field>
          <Field label="Branch">
            <input
              value={v.bankAccount?.branch ?? ""}
              onChange={(e) => setBank("branch", e.target.value)}
              className="input-base text-sm w-full"
            />
          </Field>
          <Field label="Account type">
            <select
              value={v.bankAccount?.accountType ?? ""}
              onChange={(e) => setBank("accountType", e.target.value)}
              className="input-base text-sm w-full"
            >
              <option value="">Select…</option>
              <option value="current">Current</option>
              <option value="savings">Savings</option>
              <option value="od">Overdraft</option>
              <option value="cc">Cash Credit</option>
            </select>
          </Field>
        </Grid>
      </Section>

      <Section title="Statutory auditor">
        <Grid>
          <Field label="Auditor name">
            <input
              value={v.auditorName}
              onChange={(e) => setField("auditorName", e.target.value)}
              className="input-base text-sm w-full"
            />
          </Field>
          <Field label="ICAI Firm Registration Number">
            <input
              value={v.auditorFrn}
              onChange={(e) => setField("auditorFrn", e.target.value)}
              className="input-base text-sm w-full font-mono"
            />
          </Field>
        </Grid>
      </Section>

      <Section title="Data Protection Officer (DPDP Act)">
        <Grid>
          <Field label="Name">
            <input
              value={v.dataProtectionOfficer?.name ?? ""}
              onChange={(e) => setDpo("name", e.target.value)}
              className="input-base text-sm w-full"
            />
          </Field>
          <Field label="Email">
            <input
              value={v.dataProtectionOfficer?.email ?? ""}
              onChange={(e) => setDpo("email", e.target.value)}
              className="input-base text-sm w-full"
            />
          </Field>
          <Field label="Phone">
            <input
              value={v.dataProtectionOfficer?.phone ?? ""}
              onChange={(e) => setDpo("phone", e.target.value)}
              className="input-base text-sm w-full"
            />
          </Field>
        </Grid>
      </Section>

      <div className="flex items-center justify-end gap-2 pt-3 border-t">
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={busy}
          className="btn-ghost text-sm"
        >
          <X className="size-3.5" /> Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="btn-primary text-sm"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Save changes
        </button>
      </div>
    </div>
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
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
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

function Read({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
        {label}
      </div>
      <div className={`text-sm ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

// Suppress unused-import warning for Plus (will be used when directors
// inline-add is wired in next iteration).
void Plus;
