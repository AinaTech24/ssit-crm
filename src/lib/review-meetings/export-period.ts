const pad = (n: number) => String(n).padStart(2, "0");

/** The inclusive yyyy-mm-dd range for the period picked in the export dialog, or null for "all time". */
export function periodRange(
  mode: "month" | "year" | "custom" | "all",
  year: number,
  month: number,
  from: string,
  to: string
): { from: string; to: string } | null {
  if (mode === "month") {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
  }
  if (mode === "year") return { from: `${year}-01-01`, to: `${year}-12-31` };
  if (mode === "custom") return { from, to };
  return null;
}
