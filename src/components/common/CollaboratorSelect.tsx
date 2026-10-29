"use client";

/**
 * Multi-select of firm team members, for "who else is on this meeting".
 *
 * Replaces the old single "Assigned RM" picker: a meeting is owned by whoever
 * scheduled it, and anyone listed here can also open and edit it (the API
 * ownership check accepts creator OR collaborator).
 *
 *   <CollaboratorSelect values={ids} onChange={setIds} />
 */

import { useEffect, useState } from "react";
import { MultiSelectField } from "@/components/ui/MultiSelectField";
import { DEPARTMENT_LABEL, departmentOf } from "@/lib/team/departments";

type Member = { id: string; name: string | null; email: string | null; roles?: string[] | null; department?: string | null };

/** Cached across mounts — the roster rarely changes within a session. */
let cache: Member[] | null = null;

export function CollaboratorSelect({
  values,
  onChange,
  max = 20,
  placeholder = "Add colleagues…",
  excludeUserId,
  byDepartment = false,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  max?: number;
  placeholder?: string;
  /** Usually the current user — they own the meeting, so listing them is noise. */
  excludeUserId?: string | null;
  /** Add a department dropdown above the list: pick a department, then tick people or add the whole team. */
  byDepartment?: boolean;
}) {
  const [members, setMembers] = useState<Member[]>(cache ?? []);

  useEffect(() => {
    if (cache) return;
    let alive = true;
    fetch("/api/employees")
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((j) => {
        // /api/employees responds { rows }. Tolerate a bare array too.
        const list: Member[] = Array.isArray(j?.rows) ? j.rows : Array.isArray(j) ? j : [];
        cache = list;
        if (alive) setMembers(list);
      })
      .catch(() => {
        /* leave the list empty rather than breaking the form */
      });
    return () => {
      alive = false;
    };
  }, []);

  const [dept, setDept] = useState("");
  const pool = members.filter((m) => m.id !== excludeUserId);
  // People already ticked stay in the list when the department filter moves on, so their chips do not vanish.
  const shown = byDepartment && dept ? pool.filter((m) => departmentOf(m) === dept || values.includes(m.id)) : pool;
  const options = shown.map((m) => ({ value: m.id, label: m.name || m.email || "—" }));
  const deptOptions = [...new Set(pool.map((m) => departmentOf(m)).filter((d): d is string => !!d))].sort();
  const deptMembers = dept ? pool.filter((m) => departmentOf(m) === dept).map((m) => m.id) : [];

  const picker = (
    <MultiSelectField
      values={values}
      onChange={onChange}
      options={options}
      max={max}
      placeholder={placeholder}
    />
  );
  if (!byDepartment) return picker;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <select value={dept} onChange={(e) => setDept(e.target.value)} className="input-base flex-1" aria-label="Department">
          <option value="">All departments</option>
          {deptOptions.map((d) => (
            <option key={d} value={d}>
              {DEPARTMENT_LABEL[d] ?? d}
            </option>
          ))}
        </select>
        {dept && (
          <button
            type="button"
            onClick={() => onChange([...new Set([...values, ...deptMembers])].slice(0, max))}
            className="text-xs text-brand-cyan-deep hover:underline whitespace-nowrap"
          >
            Add all ({deptMembers.length})
          </button>
        )}
      </div>
      {picker}
    </div>
  );
}
