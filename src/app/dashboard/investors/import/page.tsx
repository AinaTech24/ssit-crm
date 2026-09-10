"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Upload, FileSpreadsheet, Loader2, Check, AlertCircle } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";

type FieldDef = { key: string; label: string; group: string };
type Parsed = {
  headers: string[];
  ourFields: FieldDef[];
  suggestedMapping: Record<string, string>;
  rows: any[];
  total: number;
};

type Mode = "add" | "update" | "both";
type MatchBy = "none" | "clientId" | "email" | "phone" | "pan";

export default function ImportPage() {
  const router = useRouter();
  const toast = useToast();
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [step, setStep] = useState<"upload" | "map" | "commit" | "done">("upload");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<any>(null);

  // How the file's rows are processed (mirrors Zoho's import dialog).
  const [mode, setMode] = useState<Mode>("add");
  const [skipBy, setSkipBy] = useState<MatchBy>("none"); // add mode: skip duplicates on…
  const [findBy, setFindBy] = useState<Exclude<MatchBy, "none">>("email"); // update/both: find existing on…
  const [dontUpdateEmpty, setDontUpdateEmpty] = useState(true);

  // The effective match key sent to the API for the chosen mode.
  const matchBy: MatchBy = mode === "add" ? skipBy : findBy;
  // Which mapping field a given match key reads from (to validate it's mapped).
  const matchField = matchBy === "none" ? "" : matchBy === "clientId" ? "clientId" : matchBy;
  const matchMapped = matchField ? Object.values(mapping).includes(matchField) : true;

  async function onFile(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/investors/import/parse", { method: "POST", body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? "Parse failed");
        return;
      }
      const j: Parsed = await res.json();
      setParsed(j);
      setMapping(j.suggestedMapping);
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
      const res = await fetch("/api/investors/import/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mapping, rows: parsed.rows, mode, matchBy, dontUpdateEmpty }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Commit failed");
        toast.error(j.error ?? "Import failed", "Import");
        return;
      }
      setCommitResult(j);
      setStep("done");
      const ins = Number(j.inserted ?? 0);
      const upd = Number(j.updated ?? 0);
      const parts = [
        ins ? `${ins} added` : "",
        upd ? `${upd} updated` : "",
        j.errored ? `${j.errored} errored` : "",
      ].filter(Boolean);
      toast.success(parts.join(" · ") || "Nothing to import", "Import complete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <Link
        href="/dashboard/investors"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to investors
      </Link>

      <h1 className="text-2xl font-bold tracking-tight">Import clients from Excel</h1>
      <p className="text-sm text-muted-foreground">
        Upload a .xlsx or .csv file, then choose to <strong>add new</strong> clients, <strong>update existing</strong>{" "}
        clients, or <strong>both</strong> — matching existing clients on Client ID, Email, PAN or Mobile.
      </p>

      <ol className="flex items-center gap-4 text-xs">
        <Step label="Upload file" active={step === "upload"} done={step !== "upload"} />
        <Step label="Map columns" active={step === "map"} done={step === "commit" || step === "done"} />
        <Step label="Commit" active={step === "commit"} done={step === "done"} />
      </ol>

      {step === "upload" && (
        <div className="border-2 border-dashed rounded-lg p-12 text-center">
          <FileSpreadsheet className="size-12 mx-auto text-muted-foreground" />
          <div className="mt-3 text-sm">Drop your .xlsx or .csv file here</div>
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
            Max 10,000 rows, 10MB. Headers in row 1. Only a Name (or PAN / email / mobile) is needed — every other
            column is optional and imported as-is. Rows without a PAN are kept blank, and odd date formats
            (DD-MM-YYYY, Excel dates) are handled automatically.
          </p>
        </div>
      )}

      {step === "map" && parsed && (
        <>
          {/* How should the records in this file be processed? */}
          <div className="border rounded-lg bg-card p-5 space-y-3">
            <div className="font-medium">How should the records in this file be processed?</div>

            <ModeCard
              active={mode === "add"}
              onSelect={() => setMode("add")}
              title="Add as new Client Contacts"
            >
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm text-muted-foreground">Skip Client Contacts based on</span>
                <SelectField
                  value={skipBy}
                  onChange={(e) => setSkipBy(e.target.value as MatchBy)}
                  className="min-w-[200px]"
                  aria-label="Skip duplicates based on"
                >
                  <option value="none">None</option>
                  <option value="email">Email</option>
                  <option value="phone">Mobile Number</option>
                  <option value="pan">PAN</option>
                </SelectField>
              </div>
              {mode === "add" && skipBy !== "none" && !matchMapped && (
                <MatchHint matchBy={skipBy} />
              )}
            </ModeCard>

            <ModeCard
              active={mode === "update"}
              onSelect={() => setMode("update")}
              title="Update existing Client Contacts only"
            >
              <FindExistingRow value={findBy} onChange={setFindBy} mapped={mode !== "update" || matchMapped} />
              <DontUpdateEmptyRow checked={dontUpdateEmpty} onChange={setDontUpdateEmpty} />
              <UpdateNote />
            </ModeCard>

            <ModeCard
              active={mode === "both"}
              onSelect={() => setMode("both")}
              title="Both (Add new & Update existing)"
            >
              <FindExistingRow value={findBy} onChange={setFindBy} mapped={mode !== "both" || matchMapped} />
              <DontUpdateEmptyRow checked={dontUpdateEmpty} onChange={setDontUpdateEmpty} />
              <UpdateNote />
            </ModeCard>
          </div>

          <div className="border rounded-lg bg-card p-5">
            <div className="font-medium mb-3">Map columns</div>
            <p className="text-xs text-muted-foreground mb-3">
              {parsed.total} rows found. Map each of your columns to a field. Leave as &quot;(skip)&quot; to ignore.
            </p>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2 font-medium">Your column</th>
                  <th className="text-left py-2 font-medium">Sample</th>
                  <th className="text-left py-2 font-medium">→ Field</th>
                </tr>
              </thead>
              <tbody>
                {parsed.headers.map((h) => (
                  <tr key={h} className="border-b last:border-0">
                    <td className="py-2 font-medium">{h}</td>
                    <td className="py-2 text-xs text-muted-foreground truncate max-w-[200px]">
                      {String(parsed.rows[0]?.[h] ?? "")}
                    </td>
                    <td className="py-2">
                      <SelectField
                        value={mapping[h] ?? ""}
                        onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}
                        className="w-full min-w-[200px]"
                        placeholder="(skip)"
                        aria-label={`Map column ${h}`}
                        searchable
                        searchPlaceholder="Search fields…"
                      >
                        <option value="">(skip)</option>
                        {[...new Set(parsed.ourFields.map((f) => f.group))].map((group) => (
                          <optgroup key={group} label={group}>
                            {parsed.ourFields
                              .filter((f) => f.group === group)
                              .map((f) => (
                                <option key={f.key} value={f.key}>
                                  {f.label}
                                </option>
                              ))}
                          </optgroup>
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
              <button
                onClick={commit}
                disabled={
                  busy ||
                  !["name", "pan", "email", "phone"].some((f) => Object.values(mapping).includes(f)) ||
                  !matchMapped
                }
                className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                {busy
                  ? mode === "update" ? "Updating…" : "Importing…"
                  : mode === "update"
                    ? `Update matching of ${parsed.total} rows`
                    : mode === "both"
                      ? `Add & update ${parsed.total} rows`
                      : `Import ${parsed.total} rows`}
              </button>
            </div>
          </div>
        </>
      )}

      {step === "done" && commitResult && (
        <div className="border rounded-lg bg-card p-6 text-center">
          <Check className="size-12 mx-auto text-emerald-600" />
          <div className="text-lg font-semibold mt-2">Import complete</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-sm max-w-2xl mx-auto">
            <Tile label="Added" value={commitResult.inserted ?? 0} tone="emerald" />
            <Tile label="Updated" value={commitResult.updated ?? 0} tone={commitResult.updated ? "emerald" : "muted"} />
            <Tile label="Skipped" value={commitResult.skipped ?? 0} tone={commitResult.skipped ? "amber" : "muted"} />
            <Tile label="Errored" value={commitResult.errored ?? 0} tone={commitResult.errored ? "rose" : "muted"} />
          </div>
          {commitResult.quotaMessage && (
            <div className="text-xs text-amber-600 mt-3">{commitResult.quotaMessage}</div>
          )}
          {commitResult.errors?.length > 0 && (
            <details className="mt-4 text-xs text-left">
              <summary className="cursor-pointer">View {commitResult.errors.length} errored row{commitResult.errors.length === 1 ? "" : "s"}</summary>
              <ul className="mt-2 space-y-1 max-h-[20rem] overflow-y-auto scrollbar-none">
                {commitResult.errors.map((e: any, i: number) => (
                  <li key={i} className="flex items-start gap-2">
                    <AlertCircle className="size-3 text-rose-600 mt-0.5 shrink-0" />
                    <span>
                      Row {e.rowIndex + 1}
                      {e.name ? ` (${e.name})` : ""}: {e.error}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button
            onClick={() => router.push("/dashboard/investors")}
            className="mt-6 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
          >
            View imported investors
          </button>
        </div>
      )}
    </div>
  );
}

function Step({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <li
      className={`flex items-center gap-1.5 ${
        done ? "text-emerald-600" : active ? "text-foreground font-medium" : "text-muted-foreground"
      }`}
    >
      <span
        className={`size-5 rounded-full grid place-items-center text-[10px] ${
          done ? "bg-emerald-600 text-white" : active ? "bg-foreground text-background" : "bg-muted"
        }`}
      >
        {done ? "✓" : ""}
      </span>
      {label}
    </li>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone: "emerald" | "rose" | "amber" | "muted" }) {
  const color =
    tone === "emerald"
      ? "text-emerald-600"
      : tone === "rose"
        ? "text-rose-600"
        : tone === "amber"
          ? "text-amber-600"
          : "text-muted-foreground";
  return (
    <div className="border rounded-md p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}

/** A selectable processing-mode card (radio + body that only shows when active). */
function ModeCard({
  active,
  onSelect,
  title,
  children,
}: {
  active: boolean;
  onSelect: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onSelect}
      className={`rounded-lg border p-4 cursor-pointer transition-colors ${
        active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
      }`}
    >
      <label className="flex items-center gap-2.5 cursor-pointer">
        <span
          className={`size-4 rounded-full border-2 grid place-items-center shrink-0 ${
            active ? "border-primary" : "border-muted-foreground/40"
          }`}
        >
          {active && <span className="size-2 rounded-full bg-primary" />}
        </span>
        <span className="font-medium text-sm">{title}</span>
      </label>
      {active && <div className="mt-3 pl-[26px] space-y-3" onClick={(e) => e.stopPropagation()}>{children}</div>}
    </div>
  );
}

function FindExistingRow({
  value,
  onChange,
  mapped,
}: {
  value: Exclude<MatchBy, "none">;
  onChange: (v: Exclude<MatchBy, "none">) => void;
  mapped: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-muted-foreground">Find existing Client Contacts based on</span>
        <SelectField
          value={value}
          onChange={(e) => onChange(e.target.value as Exclude<MatchBy, "none">)}
          className={`min-w-[200px] ${mapped ? "" : "ring-1 ring-rose-400"}`}
          aria-label="Find existing based on"
        >
          <option value="email">Email</option>
          <option value="clientId">Client ID</option>
          <option value="pan">PAN</option>
          <option value="phone">Mobile Number</option>
        </SelectField>
      </div>
      {!mapped && <MatchHint matchBy={value} />}
    </div>
  );
}

function DontUpdateEmptyRow({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded accent-[#841F21]"
      />
      Don&apos;t update empty values for existing Client Contacts
      <span className="text-muted-foreground" title="When ticked, a blank cell in the file leaves the existing value untouched. Untick to let blanks clear the field.">
        ⓘ
      </span>
    </label>
  );
}

function UpdateNote() {
  return (
    <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
      <strong>Note:</strong> Records updated through import can&apos;t be undone.
    </div>
  );
}

function MatchHint({ matchBy }: { matchBy: MatchBy }) {
  const label =
    matchBy === "clientId" ? "Client ID" : matchBy === "pan" ? "PAN" : matchBy === "phone" ? "Mobile Number" : "Email";
  return (
    <div className="flex items-center gap-1.5 text-xs text-rose-600">
      <AlertCircle className="size-3" />
      Map one of your columns to <strong>{label}</strong> above — that&apos;s the field used to match.
    </div>
  );
}
