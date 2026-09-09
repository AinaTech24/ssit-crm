"use client";

/**
 * Renders a firm's MFD-defined custom fields for a lead / client on the detail
 * page, editable inline. Renders nothing when the firm has defined no fields.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, SlidersHorizontal } from "lucide-react";
import { CustomFieldInputs, missingRequired, type CustomFieldDef } from "@/components/common/CustomFieldInputs";

type Def = CustomFieldDef;

export function CustomFieldsCard({
  entity,
  recordId,
  initialValues,
}: {
  entity: "lead" | "investor";
  recordId: string;
  initialValues?: Record<string, any> | null;
}) {
  const router = useRouter();
  const [defs, setDefs] = useState<Def[] | null>(null);
  const [values, setValues] = useState<Record<string, any>>(initialValues ?? {});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/settings/custom-fields?entity=${entity}`)
      .then((r) => r.json())
      .then((j) => { if (alive) setDefs(Array.isArray(j.fields) ? j.fields : []); })
      .catch(() => { if (alive) setDefs([]); });
    return () => { alive = false; };
  }, [entity]);

  if (defs === null || defs.length === 0) return null; // no fields defined → nothing to show

  async function save() {
    setBusy(true); setErr(null);
    try {
      const miss = missingRequired(defs!, values);
      if (miss) { setErr(`${miss.label} is required.`); return; }
      const res = await fetch("/api/custom-fields/values", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entity, recordId, values }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? "Couldn't save."); return; }
      setValues(j.customFields ?? values);
      setSaved(true);
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <div className="border rounded-lg bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-sm flex items-center gap-2"><SlidersHorizontal className="size-4 text-brand-cyan" /> Custom fields</div>
        <button onClick={save} disabled={busy} className="btn-primary text-xs inline-flex items-center gap-1">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save
        </button>
      </div>
      {err && <div className="text-xs text-destructive bg-destructive/5 border border-destructive/30 rounded-md px-3 py-2">{err}</div>}
      {saved && <div className="text-xs text-emerald-700 bg-emerald-50 rounded-md px-3 py-1.5">✓ Saved</div>}
      <CustomFieldInputs
        defs={defs}
        values={values}
        onChange={(next) => { setValues(next); setSaved(false); }}
      />
    </div>
  );
}
