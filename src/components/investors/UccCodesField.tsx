"use client";

/**
 * UccCodesField — a repeatable list of Unique Client Codes. A client can hold
 * several UCCs (BSE / NSE / MFU / multiple registrations), so this renders one
 * input per code with a remove button, plus a "+ Add UCC" button. Drop-in:
 * pass `value: string[]` and `onChange: (next: string[]) => void`.
 */

import { Plus, X } from "lucide-react";

export function UccCodesField({
  value,
  onChange,
  label = "UCC codes",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  label?: string;
}) {
  const codes = value.length ? value : [""];

  const update = (i: number, v: string) => {
    const next = [...codes];
    next[i] = v;
    onChange(next);
  };
  const remove = (i: number) => {
    const next = codes.filter((_, idx) => idx !== i);
    onChange(next);
  };
  const add = () => onChange([...codes, ""]);

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="space-y-2">
        {codes.map((code, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={code}
              onChange={(e) => update(i, e.target.value)}
              placeholder="e.g. 1234567 (BSE) / CAN-… (NSE)"
              className="input-base flex-1"
            />
            {codes.length > 1 || code ? (
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Remove UCC"
                className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
              >
                <X className="size-4" />
              </button>
            ) : (
              <span className="w-8 shrink-0" />
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1 text-xs font-medium text-brand-cyan-deep hover:underline"
      >
        <Plus className="size-3.5" /> Add another UCC
      </button>
    </div>
  );
}
