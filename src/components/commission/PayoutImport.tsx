"use client";

/**
 * Manual / CSV AMC payout entry — the bridge that lets an MFD reconcile today
 * without the automated CAMS/KFin feed. Paste payout-statement lines, post to
 * /api/commission/payouts, then click "Recompute reconciliation".
 *
 * CSV columns (header optional, comma-separated):
 *   amc_code, scheme_code, scheme_name, payout_type, gross, tds, net
 * Only amc_code + gross are required; net defaults to gross − tds.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2, Check, ChevronDown, ChevronRight } from "lucide-react";

type ParsedRow = {
  amcCode: string;
  schemeCode?: string;
  schemeName?: string;
  payoutType: string;
  grossAmount: number;
  tdsAmount: number;
  netAmount?: number;
};

const PAYOUT_TYPES = ["upfront", "trail", "transaction", "incentive", "other"];

function num(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(s.replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseCsv(text: string): { rows: ParsedRow[]; errors: number } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const rows: ParsedRow[] = [];
  let errors = 0;
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim());
    // skip a header row
    if (i === 0 && /amc/i.test(cells[0]) && !/^\d/.test(cells[4] ?? "")) continue;
    const amcCode = cells[0];
    const gross = num(cells[4]);
    if (!amcCode || gross <= 0) {
      errors++;
      continue;
    }
    const payoutType = PAYOUT_TYPES.includes((cells[3] ?? "").toLowerCase())
      ? (cells[3] ?? "").toLowerCase()
      : "trail";
    rows.push({
      amcCode,
      schemeCode: cells[1] || undefined,
      schemeName: cells[2] || undefined,
      payoutType,
      grossAmount: gross,
      tdsAmount: num(cells[5]),
      netAmount: cells[6] ? num(cells[6]) : undefined,
    });
  }
  return { rows, errors };
}

export function PayoutImport({ period }: { period: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const { rows, errors } = parseCsv(text);

  async function submit() {
    if (!rows.length) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/commission/payouts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ period, rows }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(j.error ?? "Import failed");
        return;
      }
      setMsg(`✓ Imported ${j.inserted} payout lines for ${period}. Now click "Recompute reconciliation".`);
      setText("");
      router.refresh();
    } catch (e: any) {
      setMsg(e.message ?? "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border rounded-lg bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium hover:bg-secondary/50"
      >
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <Upload className="size-4 text-brand-cyan" />
        Import AMC payout statement ({period})
        <span className="text-xs text-muted-foreground font-normal ml-1">
          — paste lines, then Recompute
        </span>
      </button>

      {open && (
        <div className="border-t p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            One line per scheme. Columns:{" "}
            <code className="bg-secondary px-1 rounded">
              amc_code, scheme_code, scheme_name, payout_type, gross, tds, net
            </code>
            . Only <strong>amc_code</strong> and <strong>gross</strong> are required.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            spellCheck={false}
            placeholder={`HDFC, 119551, HDFC Flexi Cap, trail, 18500, 1850, 16650\nICICI, , , trail, 9200, 920, 8280`}
            className="w-full border rounded-md px-3 py-2 text-xs font-mono bg-background"
          />
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {rows.length > 0 && (
                <span className="text-emerald-700 font-medium">{rows.length} valid line(s)</span>
              )}
              {errors > 0 && <span className="text-amber-700 ml-2">{errors} skipped</span>}
            </div>
            <button
              type="button"
              onClick={submit}
              disabled={busy || rows.length === 0}
              className="btn-primary disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Import {rows.length || ""} lines
            </button>
          </div>
          {msg && <div className="text-xs text-foreground bg-secondary/60 rounded-md p-2">{msg}</div>}
        </div>
      )}
    </div>
  );
}
