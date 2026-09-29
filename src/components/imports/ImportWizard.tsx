"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, FileSpreadsheet, Upload, Loader2, Check, AlertCircle } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";

/**
 * Reusable import wizard for any entity. Used by Investors, Leads, Transactions.
 *
 * Props:
 *   entityLabel    "leads" / "transactions" / etc.
 *   backHref       URL to return to after success
 *   parseUrl       POST endpoint returning {headers, ourFields, suggestedMapping, rows, total}
 *   commitUrl      POST endpoint accepting {mapping, rows}
 *   requiredOurFields the field keys that MUST be mapped before commit
 */
export function ImportWizard({
  entityLabel,
  backHref,
  parseUrl,
  commitUrl,
  requiredOurFields,
  welcomePrompt,
}: {
  entityLabel: string;
  backHref: string;
  parseUrl: string;
  commitUrl: string;
  requiredOurFields: string[];
  /**
   * When set, the mapping step offers a checkbox that runs the new-record
   * automation for every imported row — the welcome WhatsApp + email a lead
   * entered by hand already triggers. Off by default: an import is how a
   * 500-name event list arrives, and messaging 500 people should be a
   * decision rather than a default.
   */
  welcomePrompt?: { label: string; hint: string };
}) {
  const router = useRouter();
  const [parsed, setParsed] = useState<any>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [step, setStep] = useState<"upload" | "map" | "done">("upload");
  const [sendWelcome, setSendWelcome] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<any>(null);

  async function onFile(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(parseUrl, { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Parse failed");
        return;
      }
      setParsed(j);
      setMapping(j.suggestedMapping ?? {});
      setStep("map");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!parsed) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(commitUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mapping, rows: parsed.rows, ...(welcomePrompt ? { sendWelcome } : {}) }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Commit failed");
        return;
      }
      setCommitResult(j);
      setStep("done");
    } finally {
      setBusy(false);
    }
  }

  const mappedFields = new Set(Object.values(mapping).filter(Boolean));
  const canCommit = requiredOurFields.every((f) => mappedFields.has(f));

  // ourFields may be string[] (leads/transactions) or {key,label}[] (insurance).
  const ourFields: Array<{ key: string; label: string }> = ((parsed?.ourFields ?? []) as any[]).map((f) =>
    typeof f === "string" ? { key: f, label: f } : { key: f.key, label: f.label ?? f.key }
  );

  return (
    <div className="space-y-4 max-w-4xl">
      <Link href={backHref} className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back
      </Link>

      <h1 className="text-2xl font-bold tracking-tight">Import {entityLabel} from Excel</h1>
      <p className="text-sm text-muted-foreground">
        Upload a .xlsx or .csv file. Max 5,000 rows, 10MB. We auto-detect known column names.
      </p>

      <ol className="flex items-center gap-4 text-xs">
        <Step label="Upload" active={step === "upload"} done={step !== "upload"} />
        <Step label="Map columns" active={step === "map"} done={step === "done"} />
        <Step label="Done" active={step === "done"} done={false} />
      </ol>

      {step === "upload" && (
        <div className="border-2 border-dashed rounded-lg p-12 text-center">
          <FileSpreadsheet className="size-12 mx-auto text-muted-foreground" />
          <div className="mt-3 text-sm">Drop your file here</div>
          <label className="mt-4 inline-block">
            <span className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium cursor-pointer">
              {busy ? "Parsing…" : "Choose file"}
            </span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
          </label>
          {err && <div className="text-sm text-rose-600 mt-3">{err}</div>}
          <p className="text-xs text-muted-foreground mt-6">
            Required columns: {requiredOurFields.join(", ")}.
          </p>
        </div>
      )}

      {step === "map" && parsed && (
        <div className="border rounded-lg bg-card p-5">
          <div className="font-medium mb-3">Map columns</div>
          <p className="text-xs text-muted-foreground mb-3">{parsed.total} rows found.</p>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left py-2 font-medium">Your column</th>
                <th className="text-left py-2 font-medium">Sample</th>
                <th className="text-left py-2 font-medium">→ Field</th>
              </tr>
            </thead>
            <tbody>
              {parsed.headers.map((h: string) => (
                <tr key={h} className="border-b last:border-0">
                  <td className="py-2 font-medium">{h}</td>
                  <td className="py-2 text-xs text-muted-foreground truncate max-w-[200px]">
                    {String(parsed.rows[0]?.[h] ?? "")}
                  </td>
                  <td className="py-2">
                    <SelectField
                      value={mapping[h] ?? ""}
                      onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}
                      className="min-w-[220px]"
                      aria-label={`Map column ${h}`}
                      searchable
                      searchPlaceholder="Search fields…"
                    >
                      <option value="">(skip)</option>
                      {ourFields.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                          {requiredOurFields.includes(f.key) ? " *" : ""}
                        </option>
                      ))}
                    </SelectField>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {err && <div className="text-sm text-rose-600 mt-3">{err}</div>}
          <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
            <button
              onClick={() => {
                setParsed(null);
                setStep("upload");
              }}
              className="rounded-md border px-3 py-1.5 text-sm"
            >
              Re-upload
            </button>
            {welcomePrompt && (
              <label className="flex items-start gap-2 text-xs mr-auto max-w-md cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendWelcome}
                  onChange={(e) => setSendWelcome(e.target.checked)}
                  className="size-4 rounded mt-0.5"
                />
                <span>
                  <span className="font-medium">{welcomePrompt.label}</span>
                  <span className="block text-muted-foreground">{welcomePrompt.hint}</span>
                </span>
              </label>
            )}
            <button
              onClick={commit}
              disabled={busy || !canCommit}
              className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
              title={!canCommit ? `Map required fields: ${requiredOurFields.join(", ")}` : ""}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
              {busy ? "Importing…" : `Import ${parsed.total} rows`}
            </button>
          </div>
        </div>
      )}

      {step === "done" && commitResult && (
        <div className="border rounded-lg bg-card p-6 text-center">
          <Check className="size-12 mx-auto text-emerald-600" />
          <div className="text-lg font-semibold mt-2">Import complete</div>
          <div className="grid grid-cols-3 gap-3 mt-4 text-sm">
            <Tile label="Inserted" value={commitResult.inserted} tone="emerald" />
            <Tile label="Skipped" value={commitResult.skipped ?? 0} tone="muted" />
            <Tile label="Errored" value={commitResult.errored ?? 0} tone={commitResult.errored ? "rose" : "muted"} />
          </div>
          {commitResult.errors?.length > 0 && (
            <details className="mt-4 text-xs text-left">
              <summary className="cursor-pointer">View {commitResult.errors.length} errors</summary>
              <ul className="mt-2 space-y-1">
                {commitResult.errors.map((e: any, i: number) => (
                  <li key={i} className="flex items-center gap-2">
                    <AlertCircle className="size-3 text-rose-600" />
                    Row {e.rowIndex}: {e.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button
            onClick={() => router.push(backHref)}
            className="mt-6 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
          >
            View imported {entityLabel}
          </button>
        </div>
      )}
    </div>
  );
}

function Step({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <li className={`flex items-center gap-1.5 ${done ? "text-emerald-600" : active ? "text-foreground font-medium" : "text-muted-foreground"}`}>
      <span className={`size-5 rounded-full grid place-items-center text-[10px] ${done ? "bg-emerald-600 text-white" : active ? "bg-foreground text-background" : "bg-muted"}`}>
        {done ? "✓" : ""}
      </span>
      {label}
    </li>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone: "emerald" | "rose" | "muted" }) {
  const color = tone === "emerald" ? "text-emerald-600" : tone === "rose" ? "text-rose-600" : "text-muted-foreground";
  return (
    <div className="border rounded-md p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}
