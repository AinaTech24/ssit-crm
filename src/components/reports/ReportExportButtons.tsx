"use client";

import { FileUp, Printer } from "lucide-react";

export function ReportExportButtons({
  rows,
  columns,
  filename,
}: {
  rows: any[];
  columns: { key: string; label: string }[];
  filename: string;
}) {
  function downloadCsv() {
    const escape = (v: any): string => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const header = columns.map((c) => escape(c.label)).join(",");
    const body = rows.map((r) => columns.map((c) => escape(r[c.key])).join(",")).join("\n");
    const csv = "﻿" + header + "\n" + body; // BOM for Excel
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex gap-2">
      <button
        onClick={downloadCsv}
        className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-accent"
      >
        <FileUp className="size-3.5" /> Export CSV
      </button>
      <button
        onClick={() => window.print()}
        className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-accent"
      >
        <Printer className="size-3.5" /> Print / PDF
      </button>
    </div>
  );
}
