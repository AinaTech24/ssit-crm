"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Save, Loader2 } from "lucide-react";

type Value = {
  id: string;
  key: string;
  label: string;
  description?: string | null;
  sortOrder?: number | null;
  isActive: boolean;
  isSystemDefault?: boolean | null;
};

export function MasterValuesEditor({
  masterType,
  initialValues,
}: {
  masterType: string;
  initialValues: Value[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<Value[]>(initialValues);
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function addValue() {
    if (!newKey || !newLabel) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/masters/${masterType}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: newKey, label: newLabel }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Add failed");
        return;
      }
      setAdding(false);
      setNewKey("");
      setNewLabel("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(v: Value) {
    setBusy(true);
    try {
      await fetch(`/api/masters/${masterType}?key=${v.key}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !v.isActive }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deleteValue(v: Value) {
    if (!confirm(v.isSystemDefault ? "Deactivate this system default?" : `Delete "${v.label}"?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/masters/${masterType}?key=${v.key}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function rename(v: Value, newLabel: string) {
    if (newLabel === v.label) return;
    setBusy(true);
    try {
      await fetch(`/api/masters/${masterType}?key=${v.key}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: newLabel }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border rounded-lg bg-card">
      <div className="border-b px-4 py-2.5 flex items-center justify-between">
        <span className="text-sm font-medium">{values.length} values</span>
        {!adding ? (
          <button
            onClick={() => setAdding(true)}
            className="text-xs rounded-md border px-2.5 py-1 flex items-center gap-1 hover:bg-accent"
          >
            <Plus className="size-3" /> Add value
          </button>
        ) : (
          <div className="flex gap-2">
            <input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
              placeholder="key (lowercase)"
              className="text-xs border rounded px-2 py-1 bg-background font-mono"
            />
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Label"
              className="text-xs border rounded px-2 py-1 bg-background"
            />
            <button
              onClick={addValue}
              disabled={busy || !newKey || !newLabel}
              className="text-xs rounded bg-primary text-primary-foreground px-2 py-1 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
            </button>
            <button
              onClick={() => {
                setAdding(false);
                setNewKey("");
                setNewLabel("");
                setErr(null);
              }}
              className="text-xs rounded border px-2 py-1"
            >
              <X className="size-3" />
            </button>
          </div>
        )}
      </div>

      {err && <div className="px-4 py-2 text-sm text-rose-600">{err}</div>}

      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground border-b">
          <tr>
            <th className="text-left px-4 py-2 font-medium">Key</th>
            <th className="text-left py-2 font-medium">Label</th>
            <th className="text-left py-2 font-medium">Source</th>
            <th className="text-left py-2 font-medium">Status</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {values.map((v) => (
            <tr key={v.id} className={`border-b last:border-0 ${!v.isActive ? "opacity-50" : ""}`}>
              <td className="px-4 py-2 font-mono text-xs">{v.key}</td>
              <td className="py-2">
                <input
                  defaultValue={v.label}
                  onBlur={(e) => rename(v, e.target.value)}
                  className="bg-transparent border-none outline-none focus:bg-background focus:border focus:rounded px-2 py-1 w-full"
                />
              </td>
              <td className="py-2 text-xs">
                {v.isSystemDefault ? (
                  <span className="text-muted-foreground">system default</span>
                ) : (
                  <span className="text-primary">custom</span>
                )}
              </td>
              <td className="py-2">
                <button
                  onClick={() => toggleActive(v)}
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    v.isActive ? "bg-emerald-50 text-emerald-700" : "bg-gray-50 text-gray-700"
                  }`}
                >
                  {v.isActive ? "active" : "disabled"}
                </button>
              </td>
              <td className="px-4 py-2 text-right">
                <button
                  onClick={() => deleteValue(v)}
                  className="text-xs text-rose-600 hover:underline"
                >
                  {v.isSystemDefault ? "Disable" : "Delete"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
