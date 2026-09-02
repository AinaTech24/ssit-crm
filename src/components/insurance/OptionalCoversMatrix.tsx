"use client";

import { Plus, Trash2, X } from "lucide-react";

/**
 * Optional-covers matrix — mirrors how insurers actually print it: members down
 * the rows, each optional cover as its OWN column, with the sum insured per
 * member×cover. Cover columns are dynamic (every policy has different ones), so
 * the column headers are editable and you can add/remove covers and members.
 *
 * Each row is { member, [coverName]: value }. Columns are derived from the union
 * of cover keys across rows — so AI-extracted data and manual edits share one
 * shape and the table renders whatever covers the document had.
 */

type Row = Record<string, any>;

const MEMBER_KEYS = new Set(["member", "memberName"]);
const cell = (v: any): string => (v == null ? "" : typeof v === "object" ? String(v.value ?? "") : String(v));
const memberOf = (r: Row) => cell(r.member ?? r.memberName);

const LONG_VALUE_KEYS = ["sumInsured", "sum_insured", "value", "amount"];

function coverColumns(rows: Row[]): string[] {
  const seen: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!MEMBER_KEYS.has(k) && !seen.includes(k)) seen.push(k);
  return seen;
}

/**
 * Accept BOTH shapes and always present the member×cover matrix:
 *   - matrix already: { member, [coverName]: value }  → used as-is
 *   - long format: { cover, member|memberName, sumInsured, notes }  → pivoted so
 *     each cover becomes a column and each member a row. A member cell that
 *     lists several people ("1. Harshad 2. Neha 3. Keval") is split into rows.
 */
function normalize(rows: Row[]): Row[] {
  if (!rows.length) return rows;
  const looksLong = rows.every((r) => "cover" in r || "Cover" in r);
  if (!looksLong) return rows;

  const order: string[] = [];
  const byMember: Record<string, Row> = {};
  for (const r of rows) {
    const coverName = cell(r.cover ?? r.Cover) || "Cover";
    const valueKey = LONG_VALUE_KEYS.find((k) => k in r);
    const value = valueKey ? cell(r[valueKey]) : "";
    const raw = memberOf(r);
    const members = raw
      .split(/\s*\d+[.)]\s*|\s*[,;/]\s*|\s*\n\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    const list = members.length ? members : [raw || "All members"];
    for (const m of list) {
      if (!byMember[m]) { byMember[m] = { member: m }; order.push(m); }
      byMember[m][coverName] = value;
    }
  }
  // Ensure every member row carries every cover key (blank where absent).
  const covers = order.length ? Object.keys(byMember[order[0]]).filter((k) => !MEMBER_KEYS.has(k)) : [];
  const allCovers = new Set<string>(covers);
  for (const m of order) for (const k of Object.keys(byMember[m])) if (!MEMBER_KEYS.has(k)) allCovers.add(k);
  return order.map((m) => {
    const row: Row = { member: m };
    for (const c of allCovers) row[c] = byMember[m][c] ?? "";
    return row;
  });
}

export function OptionalCoversMatrix({ rows: rawRows, onChange }: { rows: Row[]; onChange: (rows: Row[]) => void }) {
  const rows = normalize(rawRows);
  const covers = coverColumns(rows);

  const setMember = (i: number, val: string) => onChange(rows.map((r, idx) => (idx === i ? { ...stripMember(r), member: val } : r)));
  const setCell = (i: number, cov: string, val: string) => onChange(rows.map((r, idx) => (idx === i ? { ...r, [cov]: val } : r)));
  const addMember = () => onChange([...rows, { member: "", ...Object.fromEntries(covers.map((c) => [c, ""])) }]);
  const removeMember = (i: number) => onChange(rows.filter((_, idx) => idx !== i));

  const addCover = () => {
    const name = uniqueName("New cover", covers);
    onChange((rows.length ? rows : [{ member: "" }]).map((r) => ({ ...r, [name]: "" })));
  };
  const renameCover = (oldName: string, newName: string) => {
    if (!newName || newName === oldName || covers.includes(newName)) {
      // still allow typing intermediate states by keeping the key but updating order on blur; here just no-op on clash
      if (newName !== oldName && covers.includes(newName)) return;
    }
    onChange(rows.map((r) => {
      const { [oldName]: v, ...rest } = r;
      return { ...rest, [newName || oldName]: v ?? "" };
    }));
  };
  const removeCover = (name: string) => onChange(rows.map((r) => { const { [name]: _drop, ...rest } = r; return rest; }));

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b">
              <th className="px-2 py-1.5 font-medium w-44">Member name</th>
              {covers.map((c) => (
                <th key={c} className="px-2 py-1 font-medium align-top">
                  <div className="flex items-start gap-1">
                    <input
                      value={c}
                      onChange={(e) => renameCover(c, e.target.value)}
                      placeholder="Cover name"
                      className="input-base text-[11px] py-1 font-medium min-w-[8rem]"
                    />
                    <button type="button" onClick={() => removeCover(c)} className="text-muted-foreground hover:text-rose-600 mt-1" aria-label="Remove cover column">
                      <X className="size-3" />
                    </button>
                  </div>
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={covers.length + 2} className="px-2 py-3 text-xs text-muted-foreground">
                  No optional covers yet — add a cover column, then a member per row (or upload a policy PDF to auto-fill).
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className="border-b last:border-0 align-top">
                <td className="px-1 py-1 w-44">
                  <input value={memberOf(r)} onChange={(e) => setMember(i, e.target.value)} className="input-base text-xs py-1" placeholder="Member name" />
                </td>
                {covers.map((c) => (
                  <td key={c} className="px-1 py-1">
                    <input value={cell(r[c])} onChange={(e) => setCell(i, c, e.target.value)} className="input-base text-xs py-1" placeholder="Sum insured" />
                  </td>
                ))}
                <td className="px-1 py-1">
                  <button type="button" onClick={() => removeMember(i)} className="text-muted-foreground hover:text-rose-600 p-1" aria-label="Remove member row">
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={addMember} className="btn-ghost text-xs inline-flex items-center gap-1">
          <Plus className="size-3.5" /> Add member
        </button>
        <button type="button" onClick={addCover} className="text-xs text-brand-cyan-deep hover:underline inline-flex items-center gap-1">
          <Plus className="size-3.5" /> Add cover column
        </button>
      </div>
    </div>
  );
}

function stripMember(r: Row): Row {
  const { member: _m, memberName: _mn, ...rest } = r;
  return rest;
}
function uniqueName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
