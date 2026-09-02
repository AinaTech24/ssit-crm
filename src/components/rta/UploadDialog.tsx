"use client";

/**
 * RTA file upload dialog.
 *
 * Two-step:
 *   1. Pick source (CAMS / KFintech / MFU / BSE / NSE) + kind (file type)
 *   2. Drag-drop or browse for the file → POST multipart to
 *      /api/rta-imports/upload → display per-row outcome
 *
 * The dialog is the *only* way a non-technical MFD interacts with the
 * registry feed. Layout is wizard-style with plain-English hints under
 * every field — no jargon assumed.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Upload, CheckCircle2, AlertCircle, Loader2, Download } from "lucide-react";
import { RTA_FILE_TYPES, cadenceLabel, type RtaFileTypeDef } from "@/lib/rta/file-types";
import { RTA_SOURCES, type RtaSource } from "@/db/schema/rta_imports";
import { SelectField } from "@/components/ui/SelectField";

type Outcome = {
  importId?: string;
  status: "completed" | "partial" | "failed";
  duplicate?: boolean;
  rowsTotal?: number;
  rowsImported?: number;
  rowsSkipped?: number;
  rowsFailed?: number;
  errors?: Array<{ row: number; reason: string }>;
  error?: string;
};

/**
 * Sources a user can pick. Excludes "fintech_primitives": that integration
 * was removed, and the value survives in RtaSource only so historical import
 * rows still type-check. Nothing should offer it as a choice again.
 */
type UploadSource = Exclude<RtaSource, "fintech_primitives">;

const SOURCE_LABELS: Record<UploadSource, string> = {
  cams: "CAMS",
  kfintech: "KFintech",
  mfu: "MF Utility",
  bse_star_mf: "BSE Star MF",
  nse_nmf2: "NSE NMF II",
};

/** Compact pattern(s) for the dropdown <option>, e.g. " — MFSD211_… / …R9". */
function optionSuffix(def: RtaFileTypeDef): string {
  const pats = def.fileNames ? Object.values(def.fileNames) : [];
  if (!pats.length) return "";
  return ` — ${pats.join(" / ")}${def.fileNamesApprox ? " (approx)" : ""}`;
}

/** Per-registrar file-name hint for the detail box, e.g. "KFintech MFSD211_…". */
function fileNameHint(def: RtaFileTypeDef): string {
  if (def.fileNames && Object.keys(def.fileNames).length) {
    const s = Object.entries(def.fileNames)
      .map(([src, pat]) => `${SOURCE_LABELS[src as UploadSource] ?? src} ${pat}`)
      .join(" · ");
    return def.fileNamesApprox ? `${s} — confirm on your first download` : s;
  }
  return def.acronyms.length ? `known as ${def.acronyms.join(", ")}` : "—";
}

export function UploadDialog({
  open,
  onClose,
  defaultKind,
}: {
  open: boolean;
  onClose: () => void;
  defaultKind?: string;
}) {
  const router = useRouter();
  const [source, setSource] = useState<RtaSource>("cams");
  const [kind, setKind] = useState<string>(defaultKind ?? "daily_transaction_feed");
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [uploading, setUploading] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Set true when the dialog closes so the background-status poll loop stops.
  const cancelPollRef = useRef(false);

  // Reset the form every time the dialog opens — the component stays mounted
  // when closed, so otherwise a previous file's password/selection carries over
  // (which then fails the next zip with "Invalid password").
  useEffect(() => {
    if (open) {
      if (defaultKind) setKind(defaultKind);
      setPassword("");
      setFile(null);
      setOutcome(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [open, defaultKind]);

  if (!open) return null;

  const def = RTA_FILE_TYPES.find((t) => t.kind === kind);
  const availableSources: RtaSource[] = def?.sources ?? Array.from(RTA_SOURCES);

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setOutcome(null);
    cancelPollRef.current = false;
    try {
      const contentType = file.type || "application/octet-stream";
      // 1) Get a presigned S3 URL. 2) PUT the file DIRECTLY to S3 (bypasses the
      // app server's ~10MB body limit that truncated large zips). 3) Tell the
      // backend to QUEUE the parse — the heavy work runs in the background
      // worker so a large file never blocks/crashes the web server.
      const presRes = await fetch("/api/rta-imports/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType }),
      });
      const pres = await presRes.json();
      if (!presRes.ok) {
        setOutcome({ status: "failed", error: pres.error ?? "Could not get an upload URL" });
        return;
      }
      const putRes = await fetch(pres.url, {
        method: "PUT",
        body: file,
        headers: { "content-type": contentType },
      });
      if (!putRes.ok) {
        setOutcome({ status: "failed", error: `Direct upload to storage failed (HTTP ${putRes.status})` });
        return;
      }
      const res = await fetch("/api/rta-imports/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, kind, key: pres.key, filename: file.name, password: password || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOutcome({ status: "failed", error: data.error ?? "Upload failed" });
        return;
      }

      // 4) The parse runs in the background worker. Poll the import row until
      //    it reaches a terminal status, then show the outcome.
      const importId = data.importId as string;
      const startedAt = Date.now();
      const TIMEOUT_MS = 8 * 60 * 1000; // give big masters time on a small box
      while (!cancelPollRef.current) {
        await new Promise((r) => setTimeout(r, 2000));
        if (cancelPollRef.current) return;
        let row: any = null;
        try {
          const sres = await fetch(`/api/rta-imports/${importId}`, { cache: "no-store" });
          if (sres.ok) row = await sres.json();
        } catch {
          // transient network blip — keep polling
        }
        const st = row?.status as string | undefined;
        if (st === "completed" || st === "partial" || st === "failed" || st === "rejected") {
          setOutcome({
            importId,
            // 'rejected' = duplicate; OutcomePanel renders the duplicate panel
            // off the `duplicate` flag, so status here just needs to be non-success.
            status: st === "rejected" ? "failed" : (st as Outcome["status"]),
            duplicate: st === "rejected",
            rowsTotal: row.rows_total ?? undefined,
            rowsImported: row.rows_imported ?? undefined,
            rowsSkipped: row.rows_skipped ?? undefined,
            rowsFailed: row.rows_failed ?? undefined,
            errors: row.errors ?? undefined,
            error: row.remarks ?? undefined,
          });
          if (st === "completed" || st === "partial") router.refresh();
          return;
        }
        if (Date.now() - startedAt > TIMEOUT_MS) {
          setOutcome({
            status: "failed",
            error:
              "Still processing in the background. Large files can take a few minutes — close this and check the imports list shortly.",
          });
          return;
        }
      }
    } catch (e: any) {
      setOutcome({ status: "failed", error: e?.message ?? "Network error" });
    } finally {
      setUploading(false);
    }
  }

  function handleClose() {
    cancelPollRef.current = true; // stop any in-flight status poll
    onClose();
  }

  function reset() {
    cancelPollRef.current = true;
    setFile(null);
    setPassword("");
    setOutcome(null);
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-fade-in"
      onClick={handleClose}
    >
      <div
        className="bg-card rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-start justify-between sticky top-0 bg-card z-10">
          <div>
            <h2 className="text-lg font-bold tracking-tight">Upload RTA file</h2>
          </div>
          <button
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {!outcome ? (
            <>
              {/* Step 1 — file kind */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  1. Which file are you uploading?
                </label>
                <SelectField
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  className="w-full"
                  aria-label="RTA file type"
                >
                  {RTA_FILE_TYPES.map((t) => (
                    <option key={t.kind} value={t.kind}>
                      {t.label}
                      {optionSuffix(t)}
                    </option>
                  ))}
                </SelectField>
                {def && (
                  <div className="mt-2 text-xs text-muted-foreground leading-relaxed bg-secondary/40 rounded-lg p-3 border border-border/60">
                    <div className="font-semibold text-foreground">{def.short}</div>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                      <span>📅 <strong>Cadence:</strong> {cadenceLabel(def.cadence)}</span>
                      <span>📂 <strong>Populates:</strong> {def.populates.join(", ")}</span>
                      <span>📄 <strong>File name:</strong> {fileNameHint(def)}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Step 2 — source */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  2. Which registrar sent it?
                </label>
                <div className="flex flex-wrap gap-2">
                  {availableSources.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSource(s)}
                      className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${source === s
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background hover:bg-secondary/70 border-border"
                        }`}
                    >
                      {SOURCE_LABELS[s as UploadSource] ?? s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Step 3 — file */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    3. Pick the file from your computer
                  </label>
                  {def?.sampleFiles?.[source] && (
                    <a
                      href={def.sampleFiles[source]}
                      download
                      className="text-[11px] inline-flex items-center gap-1 text-brand-cyan-deep hover:underline"
                      title="Download a synthetic sample wired to your demo investors — use it to verify the upload pipeline end-to-end."
                    >
                      <Download className="size-3" /> Download sample
                    </a>
                  )}
                </div>
                <div
                  onClick={() => inputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
                  }}
                  className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:bg-secondary/40 transition-colors"
                >
                  <Upload className="size-8 mx-auto text-muted-foreground/70" />
                  {file ? (
                    <div className="mt-3 text-sm">
                      <div className="font-medium truncate">{file.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {(file.size / 1024).toFixed(1)} KB · click to replace
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="mt-3 text-sm font-medium">Click to browse or drag a file here</div>
                      {/* There is no upload cap: the browser PUTs straight to S3
                          on a presigned URL, so the app server never buffers the
                          file. The old "Max 25 MB" was never enforced anywhere —
                          it just made people split files that would have imported
                          whole. The one real limit is on BINARY spreadsheets,
                          which SheetJS must hold in memory to parse. */}
                      <div className="text-xs text-muted-foreground mt-0.5">
                        CSV, TXT, XLS, or password-protected ZIP — <strong>any size</strong>.
                      </div>
                      <div className="text-[11px] text-muted-foreground/80 mt-0.5">
                        Very large .xls/.xlsx/.dbf files are the one exception — ask the
                        registrar for CSV, which imports at any size.
                      </div>
                    </>
                  )}
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".csv,.txt,.dat,.tsv,.zip,.xls,.xlsx"
                    onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])}
                    hidden
                  />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Zip password (only if it's a password-protected .zip)"
                  autoComplete="off"
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-background mt-2"
                />
              </div>

              {/* Submit */}
              <div className="pt-2 flex justify-end gap-2">
                <button onClick={handleClose} className="btn-secondary text-sm">
                  Cancel
                </button>
                <button
                  onClick={handleUpload}
                  disabled={!file || uploading}
                  className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Parsing…
                    </>
                  ) : (
                    <>
                      <Upload className="size-4" /> Upload and parse
                    </>
                  )}
                </button>
              </div>
            </>
          ) : (
            <OutcomePanel outcome={outcome} onAnother={reset} onClose={handleClose} />
          )}
        </div>
      </div>
    </div>
  );
}

function OutcomePanel({
  outcome,
  onAnother,
  onClose,
}: {
  outcome: Outcome;
  onAnother: () => void;
  onClose: () => void;
}) {
  if (outcome.duplicate) {
    return (
      <div className="text-center py-6">
        <div className="size-14 rounded-2xl bg-amber-100 grid place-items-center mx-auto">
          <AlertCircle className="size-7 text-amber-700" />
        </div>
        <h3 className="font-bold mt-4">This file is already imported</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          We&apos;ve seen this exact file before (matching checksum) — no
          rows were re-inserted to keep your data clean.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={onAnother} className="btn-secondary text-sm">
            Upload another
          </button>
          <button onClick={onClose} className="btn-primary text-sm">
            Done
          </button>
        </div>
      </div>
    );
  }

  if (outcome.status === "failed") {
    return (
      <div className="text-center py-6">
        <div className="size-14 rounded-2xl bg-rose-100 grid place-items-center mx-auto">
          <AlertCircle className="size-7 text-rose-700" />
        </div>
        <h3 className="font-bold mt-4">Upload failed</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto break-words max-h-40 overflow-y-auto scrollbar-none">
          {outcome.error ?? "We couldn't parse this file. Confirm the source + kind match the layout, then retry."}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={onAnother} className="btn-secondary text-sm">
            Try again
          </button>
          <button onClick={onClose} className="btn-primary text-sm">
            Close
          </button>
        </div>
      </div>
    );
  }

  const total = outcome.rowsTotal ?? 0;
  const imported = outcome.rowsImported ?? 0;
  const skipped = outcome.rowsSkipped ?? 0;
  const failed = outcome.rowsFailed ?? 0;

  return (
    <div>
      <div className="text-center">
        <div className="size-14 rounded-2xl bg-emerald-100 grid place-items-center mx-auto">
          <CheckCircle2 className="size-7 text-emerald-700" />
        </div>
        <h3 className="font-bold mt-4">
          {outcome.status === "partial" ? "Imported with warnings" : "Import complete"}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {imported} of {total} rows were added to your records.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-2 mt-5">
        <Stat label="Total" value={total} tone="muted" />
        <Stat label="Imported" value={imported} tone="emerald" />
        <Stat label="Skipped" value={skipped} tone="amber" />
        <Stat label="Failed" value={failed} tone="rose" />
      </div>

      {outcome.errors && outcome.errors.length > 0 && (
        <div className="mt-4 bg-secondary/40 rounded-lg p-3 border border-border/60">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            First {outcome.errors.length} issues
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground max-h-32 overflow-y-auto">
            {outcome.errors.map((e, i) => (
              <li key={i}>
                <span className="font-mono text-foreground">Row {e.row}:</span> {e.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onAnother} className="btn-secondary text-sm">
          Upload another
        </button>
        <button onClick={onClose} className="btn-primary text-sm">
          Done
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "emerald" | "amber" | "rose" | "muted" }) {
  const toneCls =
    tone === "emerald"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "amber"
        ? "bg-amber-50 text-amber-700"
        : tone === "rose"
          ? "bg-rose-50 text-rose-700"
          : "bg-secondary text-muted-foreground";
  return (
    <div className={`rounded-lg px-3 py-2 text-center ${toneCls}`}>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-[10px] uppercase tracking-wider">{label}</div>
    </div>
  );
}
