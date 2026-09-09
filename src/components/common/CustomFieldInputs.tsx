"use client";

/**
 * Shared renderer for MFD-defined custom fields — used everywhere a firm's
 * custom fields need to be filled in: the detail-page card, the Add Lead /
 * Add Investor forms, and the edit panels. One place defines how each field
 * `type` renders + coerces, so all surfaces stay consistent.
 */

import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";

export type CustomFieldDef = {
  id: string;
  key: string;
  label: string;
  type: string;
  options: string[] | null;
  required: boolean;
};

/** Field types that carry a user-defined list of choices in `options`. */
export const CHOICE_TYPES = ["select", "radio", "multiselect"];

/** Supported currencies for the `currency` field type. options[0] holds the code. */
export const CURRENCIES: Array<{ code: string; symbol: string; label: string }> = [
  { code: "INR", symbol: "₹", label: "Indian Rupee (₹)" },
  { code: "USD", symbol: "$", label: "US Dollar ($)" },
  { code: "EUR", symbol: "€", label: "Euro (€)" },
  { code: "GBP", symbol: "£", label: "British Pound (£)" },
  { code: "AED", symbol: "AED", label: "UAE Dirham (AED)" },
  { code: "SGD", symbol: "S$", label: "Singapore Dollar (S$)" },
  { code: "JPY", symbol: "¥", label: "Japanese Yen (¥)" },
  { code: "AUD", symbol: "A$", label: "Australian Dollar (A$)" },
  { code: "CAD", symbol: "C$", label: "Canadian Dollar (C$)" },
];
export function currencySymbol(code?: string | null): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? code ?? "₹";
}

/** All selectable field types, with a friendly label, for the settings picker. */
export const FIELD_TYPES: Array<{ value: string; label: string }> = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Paragraph" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "date", label: "Date" },
  { value: "select", label: "Dropdown" },
  { value: "radio", label: "Radio buttons" },
  { value: "multiselect", label: "Multi-select" },
  { value: "checkbox", label: "Checkbox" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "url", label: "URL" },
];

function isEmptyValue(v: any): boolean {
  return v === undefined || v === null || v === "" || v === false || (Array.isArray(v) && v.length === 0);
}

/** First required field with no value — for pre-save validation. Returns null if all good. */
export function missingRequired(defs: CustomFieldDef[], values: Record<string, any>): CustomFieldDef | null {
  return defs.find((d) => d.required && isEmptyValue(values[d.key])) ?? null;
}

/** A single custom-field input, dispatched by type. */
function Field({ d, value, onChange }: { d: CustomFieldDef; value: any; onChange: (v: any) => void }) {
  switch (d.type) {
    case "textarea":
      return <textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)} rows={2} className="input-base text-sm w-full" />;
    case "select":
      return (
        <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="input-base text-sm w-full">
          <option value="">Select…</option>
          {(d.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case "radio":
      return (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
          {(d.options ?? []).map((o) => (
            <label key={o} className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="radio" name={`cf-${d.id}`} checked={value === o} onChange={() => onChange(o)} className="size-3.5" />
              {o}
            </label>
          ))}
        </div>
      );
    case "multiselect": {
      const arr: string[] = Array.isArray(value) ? value : [];
      const toggle = (o: string) => onChange(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o]);
      return (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {(d.options ?? []).map((o) => {
            const on = arr.includes(o);
            return (
              <button
                type="button"
                key={o}
                onClick={() => toggle(o)}
                className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${on ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent border-border"}`}
              >
                {o}
              </button>
            );
          })}
        </div>
      );
    }
    case "checkbox":
      return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="size-4 rounded mt-1" />;
    case "currency":
      return (
        <div className="flex items-stretch">
          <span className="inline-flex items-center px-2.5 rounded-l-md border border-r-0 border-border bg-muted/50 text-sm text-muted-foreground">
            {currencySymbol(d.options?.[0])}
          </span>
          <input type="number" inputMode="decimal" value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="input-base text-sm w-full rounded-l-none" />
        </div>
      );
    case "number":
      return <input type="number" value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="input-base text-sm w-full" />;
    case "date":
      return <input type="date" value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="input-base text-sm w-full" />;
    case "email":
      return <input type="email" value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder="name@example.com" className="input-base text-sm w-full" />;
    case "phone":
      return <input type="tel" value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder="+91 98765 43210" className="input-base text-sm w-full" />;
    case "url":
      return <input type="url" value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder="https://…" className="input-base text-sm w-full" />;
    default:
      return <input type="text" value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="input-base text-sm w-full" />;
  }
}

/** A responsive grid of every custom field, bound to a `values` object. */
export function CustomFieldInputs({
  defs,
  values,
  onChange,
  columns = 2,
}: {
  defs: CustomFieldDef[];
  values: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
  columns?: 1 | 2;
}) {
  const set = (k: string, v: any) => onChange({ ...values, [k]: v });
  return (
    <div className={`grid grid-cols-1 ${columns === 2 ? "sm:grid-cols-2" : ""} gap-3`}>
      {defs.map((d) => (
        <label key={d.id} className={`block ${["textarea", "multiselect"].includes(d.type) ? "sm:col-span-2" : ""}`}>
          <div className="text-xs font-medium mb-1">
            {d.label}
            {d.required && <span className="text-destructive"> *</span>}
          </div>
          <Field d={d} value={values[d.key]} onChange={(v) => set(d.key, v)} />
        </label>
      ))}
    </div>
  );
}

/**
 * Self-contained section for embedding in the Add / Edit forms: fetches the
 * firm's field definitions for the entity, renders a titled block, and reports
 * value changes up to the parent (which owns the save). Renders nothing while
 * loading or when the firm has defined no fields. Calls onDefsLoaded so the
 * parent can run required-field validation before submit.
 */
export function CustomFieldsSection({
  entity,
  values,
  onChange,
  onDefsLoaded,
}: {
  entity: "lead" | "investor";
  values: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
  onDefsLoaded?: (defs: CustomFieldDef[]) => void;
}) {
  const [defs, setDefs] = useState<CustomFieldDef[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/settings/custom-fields?entity=${entity}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const d = Array.isArray(j.fields) ? (j.fields as CustomFieldDef[]) : [];
        setDefs(d);
        onDefsLoaded?.(d);
      })
      .catch(() => { if (alive) setDefs([]); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity]);

  if (!defs || defs.length === 0) return null;

  return (
    <div className="border rounded-lg bg-card p-4 space-y-3">
      <div className="font-semibold text-sm flex items-center gap-2">
        <SlidersHorizontal className="size-4 text-brand-cyan" /> Custom fields
      </div>
      <CustomFieldInputs defs={defs} values={values} onChange={onChange} />
    </div>
  );
}
