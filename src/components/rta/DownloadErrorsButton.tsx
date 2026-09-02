"use client";

/**
 * Client-side "Download errors (CSV)" button for the RTA import detail page.
 * Builds a CSV (Row,Reason) from the row-level errors and triggers a browser
 * download via a Blob — no server round-trip.
 */
import { Download } from "lucide-react";

function csvEscape(value: string): string {
  // Quote-wrap and double up embedded quotes — RFC 4180 style.
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function DownloadErrorsButton({
  fileName,
  errors,
}: {
  fileName: string;
  errors: { row: number; reason: string }[];
}) {
  function download() {
    const header = "Row,Reason";
    const lines = errors.map(
      (e) => `${csvEscape(String(e.row))},${csvEscape(e.reason)}`
    );
    const csv = [header, ...lines].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}-errors.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <button onClick={download} className="btn-secondary text-xs">
      <Download className="size-3.5" /> Download errors (CSV)
    </button>
  );
}
