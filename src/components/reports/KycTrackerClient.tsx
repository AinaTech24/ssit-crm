"use client";

/**
 * KYC tracker — client-side filtering, sorting, CSV export. Same
 * traffic-light pattern as the ARN/EUIN tracker — CKYC expiry gets a
 * coloured chip (green > 90d, amber 30-90d, rose < 30d).
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";

type Row = {
  id: string;
  name: string;
  nameAsPerPan: string | null;
  pan: string;
  email: string | null;
  phone: string | null;
  kycStatus: string;
  panAadhaarLinkStatus: string | null;
  residencyStatus: string | null;
  investorCategory: string;
  aadhaarLast4: string | null;
  kycValidatedAt: string | null;
  ckycNumber: string | null;
  ckycExpiryAt: string | null;
  kycLastUpdatedBy: string | null;
  kycLastUpdatedByName: string | null;
  rmId: string | null;
  rmName: string | null;
  status: string;
  notes: string | null;
  updatedAt: string | null;
};

const KYC_LABELS: Record<string, string> = {
  pending: "Pending",
  registered: "KYC Registered",
  verified: "KYC Validated",
  hold: "On Hold",
  rejected: "Rejected",
  expired: "Expired",
  re_kyc_required: "Re-KYC Required",
};

const KYC_TONE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  registered: "bg-blue-50 text-blue-700",
  verified: "bg-emerald-50 text-emerald-700",
  hold: "bg-amber-50 text-amber-700",
  rejected: "bg-rose-100 text-rose-800",
  expired: "bg-rose-50 text-rose-700",
  re_kyc_required: "bg-rose-50 text-rose-700",
};

const LINK_LABELS: Record<string, string> = {
  linked: "Linked",
  not_linked: "Not Linked",
  pending: "Pending",
  not_applicable: "N/A",
};
const LINK_TONE: Record<string, string> = {
  linked: "bg-emerald-50 text-emerald-700",
  not_linked: "bg-rose-50 text-rose-700",
  pending: "bg-amber-50 text-amber-700",
  not_applicable: "bg-slate-100 text-slate-600",
};

const RESIDENCY_LABELS: Record<string, string> = {
  indian_resident: "Indian Resident",
  nri: "NRI",
  oci: "OCI",
  pio: "PIO",
  foreign_national: "Foreign National",
};

export function KycTrackerClient({
  initialRows,
  summary,
}: {
  initialRows: Row[];
  summary: Record<string, number>;
}) {
  const [q, setQ] = useState("");
  const [kycFilter, setKycFilter] = useState<string>("all");
  const [linkFilter, setLinkFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return initialRows.filter((r) => {
      if (kycFilter !== "all" && r.kycStatus !== kycFilter) return false;
      if (linkFilter !== "all") {
        const v = r.panAadhaarLinkStatus ?? "pending";
        if (linkFilter === "linked" && v !== "linked") return false;
        if (linkFilter === "not_linked" && v !== "not_linked") return false;
        if (linkFilter === "unknown" && v !== "pending" && v !== null)
          return false;
      }
      if (term) {
        const hay = [
          r.name,
          r.nameAsPerPan,
          r.pan,
          r.email,
          r.phone,
          r.ckycNumber,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [initialRows, q, kycFilter, linkFilter]);

  function exportCsv() {
    const headers = [
      "Sr No",
      "Client Name (Display)",
      "Client Name (as per PAN)",
      "PAN",
      "Aadhaar Last4",
      "KYC Status",
      "PAN-Aadhaar Link",
      "Residency",
      "Category",
      "CKYC No",
      "CKYC Expiry",
      "KYC Validated On",
      "RM",
      "Last Updated By",
      "Notes",
    ];
    const lines = [
      headers.join(","),
      ...filtered.map((r, i) =>
        [
          i + 1,
          r.name,
          r.nameAsPerPan ?? "",
          r.pan,
          r.aadhaarLast4 ? `XXXX${r.aadhaarLast4}` : "",
          KYC_LABELS[r.kycStatus] ?? r.kycStatus,
          r.panAadhaarLinkStatus
            ? LINK_LABELS[r.panAadhaarLinkStatus] ?? r.panAadhaarLinkStatus
            : "",
          r.residencyStatus
            ? RESIDENCY_LABELS[r.residencyStatus] ?? r.residencyStatus
            : "",
          r.investorCategory,
          r.ckycNumber ?? "",
          r.ckycExpiryAt ?? "",
          r.kycValidatedAt ?? "",
          r.rmName ?? "",
          r.kycLastUpdatedByName ?? "",
          r.notes ?? "",
        ]
          .map(csvEscape)
          .join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kyc-tracker-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <Tile label="Total active" value={summary.total} />
        <Tile
          label="KYC Validated"
          value={summary.validated}
          pct={pct(summary.validated, summary.total)}
          tone="emerald"
        />
        <Tile
          label="KYC Registered"
          value={summary.registered}
          pct={pct(summary.registered, summary.total)}
        />
        <Tile
          label="KYC Pending/Hold"
          value={summary.pending}
          tone={summary.pending > 0 ? "amber" : undefined}
        />
        <Tile
          label="PAN-Aadhaar linked"
          value={summary.pan_aadhaar_linked}
          pct={pct(summary.pan_aadhaar_linked, summary.total)}
          tone="emerald"
        />
        <Tile
          label="Aadhaar not linked"
          value={summary.pan_aadhaar_not_linked}
          tone={summary.pan_aadhaar_not_linked > 0 ? "rose" : undefined}
        />
      </div>

      {/* Filter bar */}
      <div className="card-surface p-4 flex items-center gap-3 flex-wrap">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name / PAN / CKYC / mobile…"
          className="input-base flex-1 min-w-[240px]"
        />
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground mr-1">KYC:</span>
          <ChipBtn
            on={kycFilter === "all"}
            onClick={() => setKycFilter("all")}
          >
            All
          </ChipBtn>
          {Object.entries(KYC_LABELS).map(([k, label]) => (
            <ChipBtn
              key={k}
              on={kycFilter === k}
              onClick={() => setKycFilter(k)}
            >
              {label}
            </ChipBtn>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground mr-1">Link:</span>
          {[
            { v: "all", l: "All" },
            { v: "linked", l: "Linked" },
            { v: "not_linked", l: "Not Linked" },
            { v: "unknown", l: "Unknown" },
          ].map((o) => (
            <ChipBtn
              key={o.v}
              on={linkFilter === o.v}
              onClick={() => setLinkFilter(o.v)}
            >
              {o.l}
            </ChipBtn>
          ))}
        </div>
        <button onClick={exportCsv} className="btn-ghost text-xs ml-auto">
          <Download className="size-3.5" /> Export CSV
        </button>
      </div>

      {/* Table */}
      <div className="card-surface overflow-x-auto">
        <table className="w-full text-xs min-w-[1200px]">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">Client</th>
              <th className="px-3 py-2 text-left">PAN</th>
              <th className="px-3 py-2 text-left">KYC Status</th>
              <th className="px-3 py-2 text-left">PAN-Aadhaar</th>
              <th className="px-3 py-2 text-left">Residency</th>
              <th className="px-3 py-2 text-left">CKYC No</th>
              <th className="px-3 py-2 text-left">CKYC Expiry</th>
              <th className="px-3 py-2 text-left">Validated</th>
              <th className="px-3 py-2 text-left">Updated By</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  No matching clients.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="border-t hover:bg-slate-50/60">
                  <td className="px-3 py-2 align-top">
                    <Link
                      href={`/dashboard/investors/${r.id}`}
                      className="font-medium hover:underline"
                    >
                      {r.name}
                    </Link>
                    {r.nameAsPerPan && r.nameAsPerPan !== r.name && (
                      <div className="text-[10px] text-muted-foreground">
                        PAN name: {r.nameAsPerPan}
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground">
                      {r.email ?? ""}
                      {r.email && r.phone && " · "}
                      {r.phone ?? ""}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono">{r.pan}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`chip text-[10px] ${
                        KYC_TONE[r.kycStatus] ?? "bg-slate-100"
                      }`}
                    >
                      {KYC_LABELS[r.kycStatus] ?? r.kycStatus}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {r.panAadhaarLinkStatus ? (
                      <span
                        className={`chip text-[10px] ${
                          LINK_TONE[r.panAadhaarLinkStatus] ?? "bg-slate-100"
                        }`}
                      >
                        {LINK_LABELS[r.panAadhaarLinkStatus] ??
                          r.panAadhaarLinkStatus}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-[10px]">
                        Unknown
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.residencyStatus
                      ? RESIDENCY_LABELS[r.residencyStatus] ??
                        r.residencyStatus
                      : r.investorCategory === "nri"
                        ? "NRI"
                        : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {r.ckycNumber ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <ExpiryBadge date={r.ckycExpiryAt} />
                  </td>
                  <td className="px-3 py-2">
                    {r.kycValidatedAt
                      ? new Date(r.kycValidatedAt).toLocaleDateString(
                          "en-GB",
                          {
                            day: "2-digit",
                            month: "short",
                            year: "2-digit",
                          }
                        )
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {r.kycLastUpdatedByName ?? "—"}
                    {r.updatedAt && (
                      <div className="text-[10px] text-muted-foreground">
                        {new Date(r.updatedAt).toLocaleDateString("en-GB")}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Tile({
  label,
  value,
  pct,
  tone,
}: {
  label: string;
  value: number;
  pct?: string;
  tone?: "emerald" | "amber" | "rose";
}) {
  const cardTone =
    value > 0 && tone === "rose"
      ? "border-rose-200 bg-rose-50/40"
      : value > 0 && tone === "amber"
        ? "border-amber-200 bg-amber-50/40"
        : value > 0 && tone === "emerald"
          ? "border-emerald-200 bg-emerald-50/40"
          : "";
  return (
    <div className={`card-surface p-3 ${cardTone}`}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">
        {value}
        {pct && (
          <span className="text-xs text-muted-foreground ml-1 font-normal">
            ({pct})
          </span>
        )}
      </div>
    </div>
  );
}

function ChipBtn({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`chip text-xs ${
        on ? "bg-slate-900 text-white" : "bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
}

function ExpiryBadge({ date }: { date: string | null }) {
  if (!date) return <span className="text-muted-foreground">—</span>;
  const d = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  const tone =
    days < 0
      ? "bg-rose-100 text-rose-800 line-through"
      : days < 30
        ? "bg-rose-50 text-rose-700"
        : days < 90
          ? "bg-amber-50 text-amber-700"
          : "bg-emerald-50 text-emerald-700";
  return (
    <span className={`chip text-[10px] ${tone}`}>
      {new Date(date).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "2-digit",
      })}
    </span>
  );
}

function pct(n: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

function csvEscape(v: any): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
