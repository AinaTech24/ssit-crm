"use client";

/**
 * Reusable multi-nominee editor — used by the add-client form and the client
 * editor. Each nominee captures name, mobile, PAN, DOB, relation and an
 * (optional) PAN document. The PAN file is uploaded immediately to storage and
 * its key is held on the nominee; the create/update API then registers it as a
 * client document so it appears in the client's Documents tab.
 */

import { useState } from "react";
import { Plus, Trash2, Upload, FileText, Loader2 } from "lucide-react";
import type { Nominee } from "@/lib/investors/nominee";

export function NomineesField({
  value,
  onChange,
}: {
  value: Nominee[];
  onChange: (n: Nominee[]) => void;
}) {
  const [uploading, setUploading] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function update(i: number, patch: Partial<Nominee>) {
    onChange(value.map((n, idx) => (idx === i ? { ...n, ...patch } : n)));
  }
  function add() {
    onChange([...value, { name: "" }]);
  }
  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  async function uploadPan(i: number, file: File) {
    setErr(null);
    setUploading(i);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "kyc");
      fd.append("docType", "nominee-pan");
      const res = await fetch("/api/compliance/upload", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Upload failed");
        return;
      }
      update(i, {
        panDocKey: j.key,
        panDocName: file.name,
        panDocMime: j.contentType ?? file.type,
        panDocSize: j.sizeBytes ?? file.size,
      });
    } catch (e: any) {
      setErr(e?.message ?? "Upload failed");
    } finally {
      setUploading(null);
    }
  }

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No nominees added yet. Add one or more nominees for this client.
        </p>
      )}

      {value.map((n, i) => (
        <div key={i} className="rounded-lg border border-border p-3 space-y-2.5 bg-background/40">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Nominee {i + 1}
            </span>
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-rose-600 hover:text-rose-700 p-1"
              aria-label="Remove nominee"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <Inp label="Name" value={n.name ?? ""} onChange={(v) => update(i, { name: v })} />
            <Inp
              label="Mobile no"
              value={n.mobile ?? ""}
              onChange={(v) => update(i, { mobile: v })}
              placeholder="+919XXXXXXXXX"
            />
            <Inp
              label="PAN no"
              value={n.pan ?? ""}
              onChange={(v) => update(i, { pan: v.toUpperCase() })}
              placeholder="ABCDE1234F"
            />
            <Inp label="Date of birth" type="date" value={n.dob ?? ""} onChange={(v) => update(i, { dob: v })} />
            <Inp
              label="Relation with client"
              value={n.relation ?? ""}
              onChange={(v) => update(i, { relation: v })}
              placeholder="spouse / son / daughter / …"
            />

            {/* PAN document upload */}
            <label className="block">
              <div className="text-xs font-medium mb-1">PAN document</div>
              {n.panDocKey ? (
                <div className="flex items-center gap-2 text-xs h-[34px]">
                  <FileText className="size-3.5 text-emerald-600 shrink-0" />
                  <span className="truncate max-w-[150px]" title={n.panDocName ?? "Uploaded"}>
                    {n.panDocName ?? "Uploaded"}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      update(i, {
                        panDocKey: undefined,
                        panDocName: undefined,
                        panDocMime: undefined,
                        panDocSize: undefined,
                      })
                    }
                    className="text-rose-600 underline shrink-0"
                  >
                    remove
                  </button>
                </div>
              ) : (
                <label className="inline-flex items-center gap-1.5 cursor-pointer rounded-md border px-2.5 py-1.5 text-xs hover:bg-secondary h-[34px]">
                  {uploading === i ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                  {uploading === i ? "Uploading…" : "Upload PAN"}
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadPan(i, f);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </label>
          </div>
        </div>
      ))}

      {err && <p className="text-xs text-rose-600">{err}</p>}

      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
      >
        <Plus className="size-3.5" /> Add nominee
      </button>
    </div>
  );
}

function Inp({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1">{label}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border rounded-md px-2.5 py-1.5 text-sm bg-background"
      />
    </label>
  );
}
