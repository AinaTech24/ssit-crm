"use client";

/**
 * SSIT firm-admin screen to define custom fields for leads / clients. Fields
 * defined here appear on the matching detail pages (CustomFieldsCard).
 */

import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2, SlidersHorizontal } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { FIELD_TYPES, CHOICE_TYPES, CURRENCIES } from "@/components/common/CustomFieldInputs";

type Def = { id: string; key: string; label: string; type: string; options: string[] | null; required: boolean };
const typeLabel = (t: string) => FIELD_TYPES.find((x) => x.value === t)?.label ?? t;

export function CustomFieldsManager() {
  const [entity, setEntity] = useState<"lead" | "investor">("lead");
  const [defs, setDefs] = useState<Def[] | null>(null);
  const [label, setLabel] = useState("");
  const [type, setType] = useState("text");
  const [options, setOptions] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [required, setRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setDefs(null);
    const j = await fetch(`/api/settings/custom-fields?entity=${entity}`).then((r) => r.json()).catch(() => ({}));
    setDefs(Array.isArray(j.fields) ? j.fields : []);
  }
  useEffect(() => { load(); }, [entity]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    setBusy(true); setErr(null);
    try {
      const body: any = { entity, label, type, required };
      if (CHOICE_TYPES.includes(type)) body.options = options.split(",").map((s) => s.trim()).filter(Boolean);
      if (type === "currency") body.options = [currency];
      const res = await fetch("/api/settings/custom-fields", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? "Couldn't add."); return; }
      setLabel(""); setOptions(""); setType("text"); setCurrency("INR"); setRequired(false);
      await load();
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    await fetch(`/api/settings/custom-fields/${id}`, { method: "DELETE" }).catch(() => {});
    await load();
  }

  return (
    <div className="border rounded-lg bg-card p-6 space-y-5">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="size-5 text-brand-cyan" />
        <div>
          <h2 className="font-semibold">Custom fields</h2>
          <p className="text-xs text-muted-foreground">Add your own fields to leads &amp; clients. They appear on the record's detail page.</p>
        </div>
      </div>

      <div className="flex gap-1 text-sm">
        {(["lead", "investor"] as const).map((e) => (
          <button key={e} onClick={() => setEntity(e)}
            className={`px-3 py-1.5 rounded-md border ${entity === e ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent"}`}>
            {e === "lead" ? "Leads" : "Clients"}
          </button>
        ))}
      </div>

      {/* Existing fields */}
      {defs === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4"><Loader2 className="size-4 animate-spin" /> Loading…</div>
      ) : defs.length === 0 ? (
        <div className="text-xs text-muted-foreground bg-muted/40 rounded-md p-3">No custom fields yet for {entity === "lead" ? "leads" : "clients"}. Add one below.</div>
      ) : (
        <div className="border rounded-md divide-y">
          {defs.map((d) => (
            <div key={d.id} className="flex items-center gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{d.label}{d.required && <span className="text-rose-500"> *</span>}</div>
                <div className="text-[11px] text-muted-foreground">
                  {typeLabel(d.type)}
                  {d.type === "currency" && d.options?.[0] ? ` · ${d.options[0]}` : ""}
                  {CHOICE_TYPES.includes(d.type) && d.options?.length ? ` · ${d.options.join(", ")}` : ""}
                  {" · "}<span className="font-mono">{d.key}</span>
                </div>
              </div>
              <button onClick={() => remove(d.id)} className="text-muted-foreground hover:text-rose-600 p-1" title="Delete field"><Trash2 className="size-4" /></button>
            </div>
          ))}
        </div>
      )}

      {/* Add new */}
      <div className="border-t pt-4 space-y-3">
        <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Add a field</div>
        {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">{err}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Field label (e.g. Preferred AMC)" className="input-base text-sm" />
          <SelectField value={type} onChange={(e) => setType(e.target.value)} className="w-full">
            {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </SelectField>
          {CHOICE_TYPES.includes(type) && (
            <input value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Options, comma-separated (e.g. HDFC, ICICI, Axis)" className="input-base text-sm sm:col-span-2" />
          )}
          {type === "currency" && (
            <SelectField value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-full sm:col-span-2">
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </SelectField>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="size-4 rounded" /> Required
          </label>
        </div>
        <button onClick={add} disabled={busy || !label.trim()} className="btn-primary text-xs inline-flex items-center gap-1">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Add field
        </button>
      </div>
    </div>
  );
}
