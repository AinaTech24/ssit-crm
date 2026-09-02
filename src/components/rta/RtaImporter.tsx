"use client";

/**
 * RTA reverse-feed importer — guided flow.
 *
 *   1. Select RTA        (Kfintech / CAMS …)
 *   2. Select file type  (the report, e.g. MFSD211 Folio Master)
 *   3. Choose file        (.csv or the password-protected .zip)
 *   4. Extract-zip password
 *   5. Preview (dry-run) / Import
 *
 * The RTA + file-type selections are sent so the API validates the upload
 * matches what you picked. The password is sent only with the request, never
 * stored.
 */

import { useRef, useState } from "react";
import { Upload, FileSpreadsheet, Eye, Database, Loader2, CheckCircle2, AlertTriangle, X, KeyRound } from "lucide-react";
import { Select } from "@/components/ui/Select";

const RTA_OPTIONS = [
  { value: "kfintech", label: "Kfintech (Karvy)" },
  { value: "cams", label: "CAMS" },
];

const FILE_TYPES: Record<string, { value: string; label: string; disabled?: boolean }[]> = {
  kfintech: [
    { value: "MFSD211", label: "MFSD211 — Folio / Investor Master" },
    { value: "MFSD203", label: "MFSD203 — Holdings / Valuation" },
  ],
  cams: [{ value: "R9", label: "Folio statement — holdings + master (.xls)" }],
};

const inr = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`;

type Summary = {
  dryRun: boolean;
  rta: string;
  reportType: string;
  investors: { total: number; created: number; updated: number; minors: number };
  folios: { total: number; created: number; updated: number; skippedNoPan: number };
  schemes: number;
  aum?: number;
  amcs: { code: string; name: string; folios: number }[];
};
type ApiResult = {
  ok?: boolean;
  error?: string;
  source?: string;
  reportType?: string;
  totalRows?: number;
  missingPan?: number;
  summary?: Summary;
};
type Progress = { phase: string; pct: number; done?: number; total?: number; etaSec: number | null };

function fmtEta(sec: number | null): string {
  if (sec == null) return "estimating…";
  if (sec < 60) return `~${Math.max(1, sec)}s left`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `~${m}m ${s}s left` : `~${m}m left`;
}

export function RtaImporter() {
  const [rta, setRta] = useState("");
  const [fileType, setFileType] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [assignToMe, setAssignToMe] = useState(false);
  const [busy, setBusy] = useState<null | "preview" | "import">(null);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fileTypeOptions = rta ? FILE_TYPES[rta] ?? [] : [];
  const ready = !!rta && !!fileType && !!file;

  function reset() {
    setResult(null);
    setError(null);
    setProgress(null);
  }

  async function run(dryRun: boolean) {
    if (!ready) return;
    if (!dryRun && !window.confirm(`Import will create/update investors and folios from "${file!.name}". Continue?`)) return;
    setBusy(dryRun ? "preview" : "import");
    reset();
    try {
      const contentType = file!.type || "application/octet-stream";
      // 1) Presigned URL → 2) PUT the file DIRECTLY to S3 (bypasses the app body
      // limit) → 3) enqueue the parse for the worker (large CAMS R9 / KFintech
      // masters parse in the isolated worker, never blocking/OOM-ing the site)
      // → 4) poll for the result. Preview (dryRun) runs the same path read-only.
      const presRes = await fetch("/api/rta/import-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file!.name, contentType }),
      });
      const pres = await presRes.json();
      if (!presRes.ok) {
        setError(pres.error ?? "Could not get an upload URL.");
        return;
      }
      const putRes = await fetch(pres.url, { method: "PUT", body: file!, headers: { "content-type": contentType } });
      if (!putRes.ok) {
        setError(`Direct upload to storage failed (HTTP ${putRes.status}).`);
        return;
      }
      const enqRes = await fetch("/api/rta/import-async", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: pres.key,
          filename: file!.name,
          rta,
          reportType: fileType,
          password: password || undefined,
          dryRun,
          assignToMe,
        }),
      });
      const enq = await enqRes.json();
      if (!enqRes.ok || !enq.jobId) {
        setError(enq.error ?? "Could not start the import.");
        return;
      }

      const jobId: string = enq.jobId;
      const startedAt = Date.now();
      const TIMEOUT_MS = 10 * 60 * 1000; // big masters take a while on this box
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        let st: any = null;
        try {
          const sres = await fetch(`/api/rta/import-status?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
          if (sres.ok) st = await sres.json();
        } catch {
          // transient — keep polling
        }
        if (st?.state === "completed") {
          setProgress(null);
          const r = st.result as ApiResult | null;
          if (!r || r.ok === false) setError(r?.error ?? "Import failed.");
          else setResult(r);
          return;
        }
        if (st?.state === "failed") {
          setProgress(null);
          setError(st?.error ?? "Import failed.");
          return;
        }
        // Live progress: phase + pct from the worker; derive an ETA from elapsed.
        if (st?.progress && typeof st.progress.pct === "number") {
          const p = st.progress;
          const elapsed = Date.now() - startedAt;
          const etaSec = p.pct > 3 ? Math.round((elapsed / p.pct) * (100 - p.pct) / 1000) : null;
          setProgress({ phase: p.phase ?? "Working", pct: p.pct, done: p.done, total: p.total, etaSec });
        } else if (!progress) {
          setProgress({ phase: "Queued", pct: 2, etaSec: null });
        }
        // waiting | active | delayed | unknown → keep polling until the timeout
        if (Date.now() - startedAt > TIMEOUT_MS) {
          setError("Still processing in the background — large files can take a few minutes. Check back shortly.");
          return;
        }
      }
    } catch (e: any) {
      setError(e?.message ?? "Upload failed.");
    } finally {
      setBusy(null);
    }
  }

  const s = result?.summary;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="card-surface p-5 space-y-5">
        {/* 1 — Select RTA */}
        <Step n={1} label="Select RTA">
          <Select
            value={rta}
            onChange={(v) => {
              setRta(v);
              setFileType("");
              reset();
            }}
            options={RTA_OPTIONS}
            placeholder="Choose registrar…"
            className="w-72"
            ariaLabel="Select RTA"
          />
        </Step>

        {/* 2 — Select File Type */}
        <Step n={2} label="Select file type" disabled={!rta}>
          <Select
            value={fileType}
            onChange={(v) => {
              setFileType(v);
              reset();
            }}
            options={fileTypeOptions}
            placeholder={rta ? "Choose report…" : "Select an RTA first"}
            disabled={!rta}
            className="w-72"
            ariaLabel="Select file type"
          />
        </Step>

        {/* 3 — Choose file */}
        <Step n={3} label="Choose file" disabled={!fileType}>
          <div
            onClick={() => fileType && inputRef.current?.click()}
            className={`flex items-center gap-3 rounded-xl border-2 border-dashed px-4 py-4 transition-colors ${
              !fileType
                ? "border-border opacity-50"
                : "border-border hover:border-brand-cyan/50 hover:bg-brand-cyan-light/20 cursor-pointer"
            }`}
          >
            <div className="size-9 rounded-lg bg-brand-cyan-light/50 text-brand-cyan-deep grid place-items-center shrink-0">
              {file ? <FileSpreadsheet className="size-4" /> : <Upload className="size-4" />}
            </div>
            <div className="min-w-0">
              <div className="font-medium text-sm truncate">{file ? file.name : "Choose a .csv, .xls or .zip file"}</div>
              <div className="text-xs text-muted-foreground">
                {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "The raw CSV, or the password-protected zip from the RTA"}
              </div>
            </div>
            {file && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFile(null);
                  reset();
                  if (inputRef.current) inputRef.current.value = "";
                }}
                className="ml-auto text-muted-foreground hover:text-rose-600"
                aria-label="Clear file"
              >
                <X className="size-4" />
              </button>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.zip,.txt,.xls,.xlsx"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                reset();
              }}
            />
          </div>
        </Step>

        {/* 4 — Zip password */}
        <Step n={4} label="Extract-zip password" disabled={!fileType}>
          <div className="relative w-72">
            <KeyRound className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (leave blank for a plain CSV)"
              className="input-base text-sm w-full pl-8"
              autoComplete="off"
              disabled={!fileType}
            />
          </div>
        </Step>

        {/* 5 — Import */}
        <Step n={5} label="Import" disabled={!ready}>
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={assignToMe}
                onChange={(e) => setAssignToMe(e.target.checked)}
                className="size-4 rounded border-border accent-brand-cyan"
              />
              Assign newly-created clients to me
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => run(true)}
                disabled={!ready || busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-secondary/60 disabled:opacity-50"
              >
                {busy === "preview" ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
                Preview
              </button>
              <button
                onClick={() => run(false)}
                disabled={!ready || busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-cyan text-white px-3 py-2 text-sm font-medium hover:bg-brand-cyan-deep disabled:opacity-50"
              >
                {busy === "import" ? <Loader2 className="size-4 animate-spin" /> : <Database className="size-4" />}
                Import
              </button>
              <span className="text-xs text-muted-foreground ml-1">Preview is read-only — nothing is written.</span>
            </div>
          </div>
        </Step>
      </div>

      {busy && progress && (
        <div className="card-surface p-5 space-y-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="inline-flex items-center gap-2 font-medium">
              <Loader2 className="size-4 animate-spin text-brand-cyan" />
              {progress.phase}
              {progress.total ? (
                <span className="text-muted-foreground font-normal">
                  {progress.done != null
                    ? ` · ${progress.done.toLocaleString("en-IN")} / ${progress.total.toLocaleString("en-IN")}`
                    : ` · ${progress.total.toLocaleString("en-IN")} rows`}
                </span>
              ) : null}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {progress.pct}% · {fmtEta(progress.etaSec)}
            </span>
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full bg-brand-cyan transition-[width] duration-500 ease-out"
              style={{ width: `${Math.min(100, Math.max(2, progress.pct))}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Importing in the background — you can keep this open to watch progress, or close it and check the imports list later.
          </p>
        </div>
      )}

      {error && (
        <div className="card-surface p-4 border-rose-200 bg-rose-50/50 flex items-start gap-2 text-sm text-rose-700">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {s && (
        <div className="card-surface p-5 space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className={`size-5 ${s.dryRun ? "text-sky-500" : "text-emerald-500"}`} />
            <h3 className="font-semibold">
              {s.dryRun ? "Preview" : "Import complete"} — {result?.source?.toUpperCase()} {s.reportType}
            </h3>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat
              label="Clients"
              value={s.investors.total}
              sub={`${s.investors.created} new · ${s.investors.updated} updated${s.investors.minors ? ` · ${s.investors.minors} minors` : ""}`}
            />
            <Stat label="Folios" value={s.folios.total} sub={`${s.folios.created} new · ${s.folios.updated} updated`} />
            <Stat label="Schemes" value={s.schemes} sub={`${s.amcs.length} AMCs`} />
            <Stat
              label="Skipped"
              value={s.folios.skippedNoPan + (result?.missingPan ?? 0)}
              sub="rows without PAN"
              tone={s.folios.skippedNoPan ? "amber" : "muted"}
            />
          </div>

          {s.aum != null && (
            <div className="rounded-lg border border-brand-cyan/30 bg-brand-cyan-light/30 px-4 py-2.5 text-sm">
              <span className="text-muted-foreground">Total AUM {s.dryRun ? "in file" : "synced"}</span>{" "}
              <span className="font-bold text-brand-cyan-deep">{inr(s.aum)}</span>
            </div>
          )}

          {s.dryRun && (
            <p className="text-xs text-muted-foreground">
              Nothing was written. Click <strong>Import</strong> to apply these {s.investors.total} investors and {s.folios.total} folios.
            </p>
          )}

          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-1.5">AMC breakdown</div>
            <div className="max-h-64 overflow-y-auto scrollbar-thin rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-xs text-muted-foreground sticky top-0">
                  <tr>
                    <th className="text-left font-medium px-3 py-1.5">Code</th>
                    <th className="text-left font-medium px-3 py-1.5">AMC</th>
                    <th className="text-right font-medium px-3 py-1.5">Folios</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {s.amcs.map((a) => (
                    <tr key={a.code}>
                      <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{a.code}</td>
                      <td className="px-3 py-1.5">{a.name}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{a.folios.toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Step({ n, label, disabled, children }: { n: number; label: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex gap-3 ${disabled ? "opacity-55" : ""}`}>
      <div className="size-6 rounded-full bg-brand-cyan-light/60 text-brand-cyan-deep grid place-items-center text-xs font-bold shrink-0 mt-0.5">
        {n}
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="text-sm font-medium">{label}</div>
        {children}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: "amber" | "muted" }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${tone === "amber" ? "text-amber-600" : ""}`}>
        {value.toLocaleString("en-IN")}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
