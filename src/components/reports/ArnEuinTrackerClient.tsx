"use client";

/**
 * ARN/EUIN/NISM/DSC tracker — client-side filtering, sorting, CSV export.
 *
 * Why client-side filter rather than re-fetch: typical MFD has 5-30
 * employees, the whole list fits in a single page. Filtering in JS keeps
 * the UI snappy + simplifies the URL state to one knob (`within`).
 *
 * Colour bands per expiry column:
 *   no data  → gray
 *   > 90d    → green
 *   30-90d   → amber
 *   < 30d    → rose (urgent)
 *   expired  → rose + strike-through
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Download, FileText } from "lucide-react";
import { DownloadButton } from "@/components/common/SecureLinkButtons";

type Row = {
  id: string;
  name: string;
  email: string;
  employeeCode: string | null;
  roles: string[];
  department: string | null;
  status: string;
  joiningDate: string | null;
  distributingAmcs: string[];
  nismCertificateNo: string | null;
  nismExamDate: string | null;
  nismExpiryAt: string | null;
  nismCategory: string | null;
  personalArn: string | null;
  arnRegistrationDate: string | null;
  arnExpiryAt: string | null;
  euin: string | null;
  euinExpiryAt: string | null;
  dscSubmitted: boolean | null;
  dscLastSubmittedAt: string | null;
  dscExpiryAt: string | null;
  docs?: Array<{ id: string; category: string; name: string }>;
};

const WITHIN_OPTIONS = [
  { value: 30, label: "next 30d" },
  { value: 60, label: "next 60d" },
  { value: 90, label: "next 90d" },
];

export function ArnEuinTrackerClient({
  initialRows,
  initialWithin,
}: {
  initialRows: Row[];
  initialWithin: number | null;
}) {
  const [within, setWithin] = useState<number | null>(initialWithin);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = within != null ? new Date(today) : null;
    if (cutoff) cutoff.setDate(cutoff.getDate() + within!);

    return initialRows.filter((r) => {
      if (term) {
        const hay = [
          r.name,
          r.email,
          r.employeeCode,
          r.personalArn,
          r.euin,
          r.nismCertificateNo,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(term)) return false;
      }
      if (cutoff) {
        // Match if ANY of the four expiry dates is within the window
        // (including already-expired which we treat as "urgent").
        const dates = [
          r.nismExpiryAt,
          r.arnExpiryAt,
          r.euinExpiryAt,
          r.dscExpiryAt,
        ]
          .filter(Boolean)
          .map((d) => new Date(d!));
        if (!dates.length) return false;
        return dates.some((d) => d <= cutoff);
      }
      return true;
    });
  }, [initialRows, within, q]);

  function exportCsv() {
    const headers = [
      "Employee Code",
      "Employee Name",
      "Email",
      "Department",
      "Distributing AMCs",
      "NISM Cert No",
      "NISM Exam Date",
      "NISM Expiry",
      "NISM Category",
      "Personal ARN",
      "ARN Reg Date",
      "ARN Expiry",
      "EUIN",
      "EUIN Expiry",
      "DSC Submitted",
      "DSC Last Submitted",
      "DSC Expiry",
    ];
    const lines = [
      headers.join(","),
      ...filtered.map((r) =>
        [
          r.employeeCode ?? "",
          r.name,
          r.email,
          r.department ?? "",
          (r.distributingAmcs ?? []).join("; "),
          r.nismCertificateNo ?? "",
          r.nismExamDate ?? "",
          r.nismExpiryAt ?? "",
          r.nismCategory ?? "",
          r.personalArn ?? "",
          r.arnRegistrationDate ?? "",
          r.arnExpiryAt ?? "",
          r.euin ?? "",
          r.euinExpiryAt ?? "",
          r.dscSubmitted ? "Yes" : "No",
          r.dscLastSubmittedAt ?? "",
          r.dscExpiryAt ?? "",
        ]
          .map(csvEscape)
          .join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `arn-euin-tracker-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      {/* Filter bar */}
      <div className="card-surface p-4 flex items-center gap-3 flex-wrap">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name / code / ARN / EUIN / NISM…"
          className="input-base flex-1 min-w-[240px]"
        />
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground mr-1">
            Expiring in:
          </span>
          <button
            onClick={() => setWithin(null)}
            className={`chip text-xs ${
              within == null ? "bg-slate-900 text-white" : "bg-slate-100"
            }`}
          >
            any
          </button>
          {WITHIN_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setWithin(o.value)}
              className={`chip text-xs ${
                within === o.value
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button onClick={exportCsv} className="btn-ghost text-xs ml-auto">
          <Download className="size-3.5" /> Export CSV
        </button>
      </div>

      {/* Summary stats */}
      <SummaryStats rows={initialRows} />

      {/* Table */}
      <div className="card-surface overflow-x-auto">
        <table className="w-full text-xs min-w-[1280px]">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <Th>Employee</Th>
              <Th>Code</Th>
              <Th>Distributing AMCs</Th>
              <Th group="nism">NISM cert</Th>
              <Th group="nism">Exam date</Th>
              <Th group="nism">Expiry</Th>
              <Th group="arn">Personal ARN</Th>
              <Th group="arn">Reg date</Th>
              <Th group="arn">Expiry</Th>
              <Th group="euin">EUIN</Th>
              <Th group="euin">Expiry</Th>
              <Th group="dsc">DSC?</Th>
              <Th group="dsc">Last filed</Th>
              <Th group="dsc">Expiry</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={14}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  No matching employees.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr
                  key={r.id}
                  className="border-t hover:bg-slate-50/60 align-top"
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/dashboard/employees/${r.id}`}
                      className="font-medium hover:underline"
                    >
                      {r.name}
                    </Link>
                    <div className="text-[10px] text-muted-foreground">
                      {r.email}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {(r.roles ?? []).slice(0, 2).join(" · ")}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {r.employeeCode ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    {r.distributingAmcs?.length ? (
                      <div className="flex flex-wrap gap-1">
                        {r.distributingAmcs.slice(0, 4).map((a) => (
                          <span
                            key={a}
                            className="chip bg-slate-100 text-slate-700 text-[10px]"
                          >
                            {a}
                          </span>
                        ))}
                        {r.distributingAmcs.length > 4 && (
                          <span className="text-[10px] text-muted-foreground">
                            +{r.distributingAmcs.length - 4}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>

                  <td className="px-3 py-2 font-mono text-[11px]">
                    <div className="flex items-center gap-1">
                      <span>{r.nismCertificateNo ?? "—"}</span>
                      {(() => {
                        const doc = r.docs?.find((d) => d.category === "nism");
                        return doc ? (
                          <DownloadButton
                            url={`/api/compliance/documents/download?id=${doc.id}`}
                            title="Download NISM certificate"
                            className="text-primary hover:text-primary-focus inline-flex items-center shrink-0"
                          >
                            <FileText className="size-3" />
                          </DownloadButton>
                        ) : null;
                      })()}
                    </div>
                    {r.nismCategory && (
                      <div className="text-[10px] text-muted-foreground font-sans">
                        {r.nismCategory}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {fmt(r.nismExamDate)}
                  </td>
                  <td className="px-3 py-2">
                    <ExpiryCell date={r.nismExpiryAt} />
                  </td>

                  <td className="px-3 py-2 font-mono text-[11px]">
                    <div className="flex items-center gap-1">
                      <span>{r.personalArn ?? "—"}</span>
                      {(() => {
                        const doc = r.docs?.find((d) => d.category === "arn");
                        return doc ? (
                          <DownloadButton
                            url={`/api/compliance/documents/download?id=${doc.id}`}
                            title="Download Personal ARN"
                            className="text-primary hover:text-primary-focus inline-flex items-center shrink-0"
                          >
                            <FileText className="size-3" />
                          </DownloadButton>
                        ) : null;
                      })()}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {fmt(r.arnRegistrationDate)}
                  </td>
                  <td className="px-3 py-2">
                    <ExpiryCell date={r.arnExpiryAt} />
                  </td>

                  <td className="px-3 py-2 font-mono text-[11px]">
                    <div className="flex items-center gap-1">
                      <span>{r.euin ?? "—"}</span>
                      {(() => {
                        const doc = r.docs?.find((d) => d.category === "euin");
                        return doc ? (
                          <DownloadButton
                            url={`/api/compliance/documents/download?id=${doc.id}`}
                            title="Download EUIN Card"
                            className="text-primary hover:text-primary-focus inline-flex items-center shrink-0"
                          >
                            <FileText className="size-3" />
                          </DownloadButton>
                        ) : null;
                      })()}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <ExpiryCell date={r.euinExpiryAt} />
                  </td>

                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {r.dscSubmitted ? (
                        <span className="chip bg-emerald-50 text-emerald-700 text-[10px]">
                          Yes
                        </span>
                      ) : (
                        <span className="chip bg-rose-50 text-rose-700 text-[10px]">
                          No
                        </span>
                      )}
                      {(() => {
                        const doc = r.docs?.find(
                          (d) => d.category === "other" && d.name.toLowerCase().includes("dsc")
                        );
                        return doc ? (
                          <DownloadButton
                            url={`/api/compliance/documents/download?id=${doc.id}`}
                            title="Download DSC Certificate"
                            className="text-primary hover:text-primary-focus inline-flex items-center shrink-0"
                          >
                            <FileText className="size-3" />
                          </DownloadButton>
                        ) : null;
                      })()}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {fmt(r.dscLastSubmittedAt)}
                  </td>
                  <td className="px-3 py-2">
                    <ExpiryCell date={r.dscExpiryAt} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Click an employee name to update licensing fields. The colour band on
        each expiry: <span className="text-emerald-600">green</span> &gt; 90
        days, <span className="text-amber-600">amber</span> 30–90 days,{" "}
        <span className="text-rose-600">rose</span> &lt; 30 days or expired,
        gray = no data.
      </p>
    </>
  );
}

function Th({ children, group }: { children: React.ReactNode; group?: string }) {
  const tone =
    group === "nism"
      ? "bg-blue-50/60"
      : group === "arn"
        ? "bg-violet-50/60"
        : group === "euin"
          ? "bg-cyan-50/60"
          : group === "dsc"
            ? "bg-amber-50/60"
            : "";
  return (
    <th
      className={`px-3 py-2 text-left text-[11px] uppercase tracking-wide font-medium ${tone}`}
    >
      {children}
    </th>
  );
}

function ExpiryCell({ date }: { date: string | null }) {
  if (!date) return <span className="text-muted-foreground">—</span>;
  const d = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
  const tone =
    diffDays < 0
      ? "bg-rose-100 text-rose-800 line-through"
      : diffDays < 30
        ? "bg-rose-50 text-rose-700"
        : diffDays < 90
          ? "bg-amber-50 text-amber-700"
          : "bg-emerald-50 text-emerald-700";
  return (
    <span className={`chip text-[10px] ${tone}`} title={date}>
      {fmt(date)}
      <span className="ml-1 text-[9px] opacity-70">
        {diffDays < 0
          ? "expired"
          : diffDays === 0
            ? "today"
            : `${diffDays}d`}
      </span>
    </span>
  );
}

function fmt(d: string | null): string {
  if (!d) return "—";
  // YYYY-MM-DD → DD MMM YYYY for human reading
  try {
    const dt = new Date(d);
    return dt.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return d;
  }
}

function csvEscape(v: string): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function SummaryStats({ rows }: { rows: Row[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  function countWithin(field: keyof Row, days: number): number {
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() + days);
    return rows.filter((r) => {
      const v = r[field] as string | null;
      if (!v) return false;
      const d = new Date(v);
      return d <= cutoff;
    }).length;
  }
  function countMissing(field: keyof Row): number {
    return rows.filter((r) => !r[field]).length;
  }
  const stats = [
    { label: "NISM ≤ 60d", count: countWithin("nismExpiryAt", 60), tone: "rose" },
    { label: "ARN ≤ 60d", count: countWithin("arnExpiryAt", 60), tone: "rose" },
    { label: "EUIN ≤ 60d", count: countWithin("euinExpiryAt", 60), tone: "rose" },
    { label: "DSC ≤ 60d", count: countWithin("dscExpiryAt", 60), tone: "rose" },
    {
      label: "No EUIN on file",
      count: countMissing("euin"),
      tone: "amber",
    },
    {
      label: "DSC not submitted",
      count: rows.filter((r) => !r.dscSubmitted).length,
      tone: "amber",
    },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
      {stats.map((s) => (
        <div
          key={s.label}
          className={`card-surface p-3 ${
            s.count > 0 && s.tone === "rose"
              ? "border-rose-200 bg-rose-50/40"
              : s.count > 0 && s.tone === "amber"
                ? "border-amber-200 bg-amber-50/40"
                : ""
          }`}
        >
          <div className="text-[11px] text-muted-foreground">{s.label}</div>
          <div className="text-lg font-semibold">{s.count}</div>
        </div>
      ))}
    </div>
  );
}
