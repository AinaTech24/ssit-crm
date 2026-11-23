"use client";

/**
 * "Update a field": set ONE field to the same value for every selected record.
 *
 * Pick a field (grouped - Service, Classification, Profile, Address, Tags), then the
 * value input that fits it (a list, a date, a text box or a tag), and apply. The
 * field list comes from the caller, so the same dialog serves any module that has a
 * catalogue of bulk-editable fields; the server re-validates every value.
 */

import { useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import type { BulkField, BulkFieldGroup } from "@/lib/investors/bulk-fields";

function findField(groups: BulkFieldGroup[], key: string): BulkField | undefined {
  for (const g of groups) {
    const f = g.fields.find((x) => x.key === key);
    if (f) return f;
  }
  return undefined;
}

export function BulkUpdateFieldDialog({
  open,
  onOpenChange,
  groups,
  count,
  noun = "clients",
  busy,
  error,
  onApply,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  groups: BulkFieldGroup[];
  count: number;
  noun?: string;
  busy?: boolean;
  error?: string | null;
  onApply: (field: string, value: string) => Promise<void>;
}) {
  const [fieldKey, setFieldKey] = useState(groups[0]?.fields[0]?.key ?? "");
  const [value, setValue] = useState("");
  const field = findField(groups, fieldKey);
  // For a creatable select: the person chose "+ Add new" and types the value instead.
  const NEW = "__new__";
  const typingNew = !!field?.creatable && value === NEW;
  const [newText, setNewText] = useState("");

  function pickField(k: string) {
    setFieldKey(k);
    setValue("");
    setNewText("");
  }

  // Text fields may be left empty to clear them; everything else needs a value.
  const needsValue = !!field && field.kind !== "text";
  const canApply = !!field && (!needsValue || (typingNew ? newText.trim().length >= 2 : value.trim() !== ""));

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="size-4 text-muted-foreground" /> Update a field
          </DialogTitle>
          <DialogDescription>
            Set one field to the same value for all {count} {noun} you selected.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-3 text-sm">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Field</span>
            <select className="input-base w-full" value={fieldKey} onChange={(e) => pickField(e.target.value)}>
              {groups.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.fields.map((f) => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          {field && (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                {field.kind === "tag_add" ? "Tag to add" : field.kind === "tag_remove" ? "Tag to remove" : "New value"}
              </span>
              {field.kind === "select" ? (
                <>
                  <select className="input-base w-full" value={value} onChange={(e) => setValue(e.target.value)}>
                    <option value="">Select…</option>
                    {field.options?.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                    {field.creatable && <option value={NEW}>+ Add a new one…</option>}
                  </select>
                  {typingNew && (
                    <input
                      autoFocus
                      className="input-base w-full mt-2"
                      value={newText}
                      maxLength={120}
                      placeholder={field.placeholder}
                      onChange={(e) => setNewText(e.target.value)}
                    />
                  )}
                </>
              ) : field.kind === "date" ? (
                <input type="date" className="input-base w-full" value={value} onChange={(e) => setValue(e.target.value)} />
              ) : (
                <input
                  className="input-base w-full"
                  value={value}
                  maxLength={field.kind === "text" ? 120 : 60}
                  placeholder={field.placeholder}
                  onChange={(e) => setValue(e.target.value)}
                />
              )}
              {field.kind === "text" && (
                <span className="block text-[11px] text-muted-foreground">Leave empty to clear this field on every selected record.</span>
              )}
              {field.kind === "tag_add" && (
                <span className="block text-[11px] text-muted-foreground">Added to what each record already has; a record that has it keeps one copy.</span>
              )}
            </label>
          )}

          {error && <div className="text-xs text-destructive">{error}</div>}
        </div>

        <DialogFooter>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={busy || !canApply} onClick={() => onApply(fieldKey, typingNew ? newText.trim() : value)}>
            {busy && <Loader2 className="size-4 animate-spin" />} Update {count} {count === 1 ? "record" : "records"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
