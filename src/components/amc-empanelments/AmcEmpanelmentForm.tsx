"use client";

/**
 * Create / edit form for an AMC empanelment.
 *
 * Sections:
 *   1. AMC + relationship core (code, distributor code, date, status, portal)
 *   2. Three primary contacts: RM / Ops / Escalation
 *   3. Additional contacts list (marketing / product / CXO / branch — extensible)
 *   4. Trail rate override (feeds brokerage reconciler)
 *   5. Documents (empanelment letter / MOU / addendums)
 *   6. Remarks
 *
 * On create: AMC picker is enabled. On edit: disabled — changing the
 * AMC code would orphan transactions + commission records.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Loader2, Trash2, Plus, X, ExternalLink } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { EMPANELMENT_CATEGORIES } from "@/db/schema/amc_empanelments";
import { DateField } from "@/components/ui/DateField";
import { AmcPicker } from "./AmcPicker";

const STATUSES = [
  { value: "empanelled", label: "Empanelled" },
  { value: "under_review", label: "Under review" },
  { value: "suspended", label: "Suspended" },
  { value: "terminated", label: "Terminated" },
];

type Contact = {
  role: string;
  name: string;
  email?: string;
  phone?: string;
  notes?: string;
};

type Doc = {
  label: string;
  url: string;
  uploadedAt?: string;
  uploadedBy?: string;
};

type FormValues = {
  id?: string;
  amcCode: string;
  amcName: string;
  category: string | null;
  distributorCode: string | null;
  empanelmentDate: string | null;
  status: string;
  rmName: string | null;
  rmEmail: string | null;
  rmPhone: string | null;
  opsName: string | null;
  opsEmail: string | null;
  opsPhone: string | null;
  escalationName: string | null;
  escalationEmail: string | null;
  escalationPhone: string | null;
  billingName: string | null;
  billingEmail: string | null;
  billingPhone: string | null;
  additionalContacts: Contact[];
  portalUrl: string | null;
  trailRateOverridePct: number | null;
  documents: Doc[];
  remarks: string | null;
  investmentPhilosophy: string | null;
  fundHouseStrengths: string | null;
  redFlags: string | null;
};

const EMPTY: FormValues = {
  amcCode: "",
  category: "",
  amcName: "",
  distributorCode: null,
  empanelmentDate: null,
  status: "empanelled",
  rmName: null,
  rmEmail: null,
  rmPhone: null,
  opsName: null,
  opsEmail: null,
  opsPhone: null,
  escalationName: null,
  escalationEmail: null,
  escalationPhone: null,
  billingName: null,
  billingEmail: null,
  billingPhone: null,
  additionalContacts: [],
  portalUrl: null,
  trailRateOverridePct: null,
  documents: [],
  remarks: null,
  investmentPhilosophy: null,
  fundHouseStrengths: null,
  redFlags: null,
};

export function AmcEmpanelmentForm({
  mode,
  initial,
  amcCatalog,
}: {
  mode: "create" | "edit";
  initial?: Partial<FormValues> & { id?: string };
  amcCatalog: Array<{ code: string; name: string }>;
}) {
  const router = useRouter();
  const [v, setV] = useState<FormValues>({ ...EMPTY, ...(initial ?? {}) });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Inputs for the inline doc + contact adders
  const [newContact, setNewContact] = useState<Contact>({
    role: "",
    name: "",
  });
  const [newDoc, setNewDoc] = useState({ label: "", url: "" });

  function field<K extends keyof FormValues>(k: K, val: FormValues[K]) {
    setV((p) => ({ ...p, [k]: val }));
    setOk(null);
  }

  function addContact() {
    if (!newContact.role.trim() || !newContact.name.trim()) return;
    field("additionalContacts", [...v.additionalContacts, { ...newContact }]);
    setNewContact({ role: "", name: "" });
  }
  function removeContact(i: number) {
    field(
      "additionalContacts",
      v.additionalContacts.filter((_, idx) => idx !== i)
    );
  }

  function addDoc() {
    if (!newDoc.label.trim() || !newDoc.url.trim()) return;
    try {
      new URL(newDoc.url.trim());
    } catch {
      setErr("Document URL is not a valid URL.");
      return;
    }
    field("documents", [
      ...v.documents,
      {
        label: newDoc.label.trim(),
        url: newDoc.url.trim(),
        uploadedAt: new Date().toISOString(),
      },
    ]);
    setNewDoc({ label: "", url: "" });
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
    if (mode === "create" && !v.amcCode) {
      setErr("Pick an AMC first.");
      setBusy(false);
      return;
    }
    try {
      const url =
        mode === "create"
          ? "/api/amc-empanelments"
          : `/api/amc-empanelments/${initial?.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const body: any = { ...v };
      // On edit, drop amcCode — it's immutable
      if (mode === "edit") delete body.amcCode;
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
        router.push(`/dashboard/amc-empanelments/${j.empanelment.id}`);
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
    if (!confirm("Terminate this empanelment? Commission history is preserved.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/amc-empanelments/${initial.id}`, {
        method: "DELETE",
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Failed");
        return;
      }
      router.push("/dashboard/amc-empanelments?status=terminated");
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

      {/* AMC + core */}
      <Section title="AMC & relationship">
        <Grid>
          {mode === "create" ? (
            <Field label="AMC *">
              <AmcPicker
                catalog={amcCatalog}
                value={v.amcCode}
                onPick={(a) => setV((p) => ({ ...p, amcCode: a.code, amcName: a.name }))}
              />
            </Field>
          ) : (
            <Field label="AMC (immutable)">
              <input
                value={`${v.amcName}`}
                disabled
                className="input-base text-sm w-full bg-secondary/50"
              />
            </Field>
          )}
          <Field label="Product line">
            <SelectField
              value={v.category ?? ""}
              onChange={(e) => field("category", e.target.value || null)}
              className="text-sm w-full"
            >
              <option value="">Uncategorised</option>
              {EMPANELMENT_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </SelectField>
          </Field>
          <Field label="Status">
            <SelectField
              value={v.status}
              onChange={(e) => field("status", e.target.value)}
              className="text-sm w-full"
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </SelectField>
          </Field>
          <Field label="Empanelment date">
            <DateField
              value={v.empanelmentDate ?? ""}
              onChange={(e) => field("empanelmentDate", e.target.value || null)}
              className="text-sm w-full"
            />
          </Field>
        </Grid>
      </Section>

      {/* Primary contacts */}
      <Section title="Primary contacts">
        <ContactRow
          label="RM (Relationship Manager)"
          name={v.rmName}
          email={v.rmEmail}
          phone={v.rmPhone}
          onChange={(k, val) =>
            field(
              k === "name"
                ? "rmName"
                : k === "email"
                  ? "rmEmail"
                  : "rmPhone",
              val
            )
          }
        />
        <ContactRow
          label="Operations team"
          name={v.opsName}
          email={v.opsEmail}
          phone={v.opsPhone}
          onChange={(k, val) =>
            field(
              k === "name"
                ? "opsName"
                : k === "email"
                  ? "opsEmail"
                  : "opsPhone",
              val
            )
          }
        />
        <ContactRow
          label="Escalation"
          name={v.escalationName}
          email={v.escalationEmail}
          phone={v.escalationPhone}
          onChange={(k, val) =>
            field(
              k === "name"
                ? "escalationName"
                : k === "email"
                  ? "escalationEmail"
                  : "escalationPhone",
              val
            )
          }
        />
        <ContactRow
          label="Billing contact"
          name={v.billingName}
          email={v.billingEmail}
          phone={v.billingPhone}
          onChange={(k, val) =>
            field(
              k === "name"
                ? "billingName"
                : k === "email"
                  ? "billingEmail"
                  : "billingPhone",
              val
            )
          }
        />
      </Section>

      {/* Additional contacts */}
      <Section title="Additional contacts">
        {v.additionalContacts.length > 0 ? (
          <ul className="space-y-1.5 mb-2">
            {v.additionalContacts.map((c, i) => (
              <li
                key={i}
                className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-md px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wide text-violet-700 font-semibold">
                    {c.role}
                  </div>
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {c.email && `${c.email}`}
                    {c.email && c.phone && " · "}
                    {c.phone && c.phone}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeContact(i)}
                  className="text-slate-400 hover:text-rose-600"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground mb-2">
            Add marketing, product, CXO, branch managers — anyone beyond the 3
            primaries.
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
          <input
            value={newContact.role}
            onChange={(e) =>
              setNewContact((c) => ({ ...c, role: e.target.value }))
            }
            placeholder="Role"
            className="input-base text-sm w-full"
          />
          <input
            value={newContact.name}
            onChange={(e) =>
              setNewContact((c) => ({ ...c, name: e.target.value }))
            }
            placeholder="Name"
            className="input-base text-sm w-full"
          />
          <input
            value={newContact.email ?? ""}
            onChange={(e) =>
              setNewContact((c) => ({ ...c, email: e.target.value || undefined }))
            }
            placeholder="Email"
            className="input-base text-sm w-full"
          />
          <input
            value={newContact.phone ?? ""}
            onChange={(e) =>
              setNewContact((c) => ({ ...c, phone: e.target.value || undefined }))
            }
            placeholder="Phone"
            className="input-base text-sm w-full"
          />
          <button
            type="button"
            onClick={addContact}
            disabled={!newContact.role.trim() || !newContact.name.trim()}
            className="btn-ghost text-xs w-full justify-center"
          >
            <Plus className="size-3.5" /> Add
          </button>
        </div>
      </Section>

      {/* Kept for records that already hold this, hidden when creating:
          the new-empanelment form asks only for what is needed to empanel.
          Nothing captured here is deleted — open an existing empanelment to
          read or edit it. */}
      {mode === "edit" && (
      <Section title="Empanelment letter / MOU / addendums">
        {v.documents.length > 0 ? (
          <ul className="space-y-1.5 mb-2">
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
                  className="text-slate-400 hover:text-rose-600"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground mb-2">
            Paste document URLs (Google Drive, S3, DigiLocker, etc.).
          </p>
        )}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <input
            value={newDoc.label}
            onChange={(e) => setNewDoc((d) => ({ ...d, label: e.target.value }))}
            placeholder="Document label"
            className="input-base text-sm w-full sm:flex-1"
          />
          <input
            value={newDoc.url}
            onChange={(e) => setNewDoc((d) => ({ ...d, url: e.target.value }))}
            placeholder="https://…"
            className="input-base text-sm w-full sm:flex-1"
          />
          <button
            type="button"
            onClick={addDoc}
            disabled={!newDoc.label.trim() || !newDoc.url.trim()}
            className="btn-ghost text-xs w-full sm:w-auto justify-center"
          >
            <Plus className="size-3.5" /> Add
          </button>
        </div>
      </Section>
      )}

      {mode === "edit" && (
      <Section title="Remarks">
        <textarea
          rows={3}
          value={v.remarks ?? ""}
          onChange={(e) => field("remarks", e.target.value || null)}
          className="input-base text-sm w-full"
          placeholder="Brokerage notes, special arrangements, fund-house policies…"
        />
      </Section>
      )}

      <div className="flex items-center justify-between pt-4 border-t">
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
          {mode === "create" ? "Add empanelment" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function ContactRow({
  label,
  name,
  email,
  phone,
  onChange,
}: {
  label: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  onChange: (k: "name" | "email" | "phone", val: string | null) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
        {label}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input
          value={name ?? ""}
          onChange={(e) => onChange("name", e.target.value || null)}
          placeholder="Name"
          className="input-base text-sm w-full"
        />
        <input
          type="email"
          value={email ?? ""}
          onChange={(e) => onChange("email", e.target.value || null)}
          placeholder="Email"
          className="input-base text-sm w-full"
        />
        <input
          value={phone ?? ""}
          onChange={(e) => onChange("phone", e.target.value || null)}
          placeholder="Phone"
          className="input-base text-sm w-full"
        />
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
