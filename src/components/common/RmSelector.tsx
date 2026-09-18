"use client";

/**
 * RmSelector — picks an employee (RM / owner / back-office user) from the
 * tenant's employee master. One reusable lookup for every form in the
 * CRM that needs an "assign to" or "RM" field:
 *
 *   - New / edit lead
 *   - New / edit investor
 *   - Schedule meeting
 *   - New task / SR / SIP rejection / proposal …
 *
 * Wire-up:
 *
 *   <RmSelector
 *     value={form.rmId}
 *     onChange={(id) => set("rmId", id)}
 *     role="rm"                 // optional — filter to a specific role
 *     placeholder="Choose RM"
 *     allowClear
 *   />
 *
 * Implementation notes:
 *   - The full employee list is fetched once and cached in a module-level
 *     Map keyed by role+search. Subsequent mounts on the same page reuse
 *     the cache; cross-page navigation triggers a re-fetch on first
 *     render but stays fast (< 50ms typical).
 *   - The picker is a native <select> for now (simple, accessible, fast).
 *     Can be upgraded to a Combobox if tenants grow past ~50 employees.
 */

import { useEffect, useState } from "react";
import { Loader2, Users } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { inDepartment } from "@/config/departments";

export type Employee = {
  id: string;
  name: string;
  email: string;
  roles: string[];
  department: string | null;
};

// In-memory cache so repeated mounts on the same page don't re-hit the API.
// Keyed by role param.
const cache = new Map<string, { rows: Employee[]; at: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute is plenty for a typing-speed form

export function RmSelector({
  value,
  onChange,
  role,
  department,
  placeholder = "— Choose team member —",
  allowClear = true,
  disabled,
  required,
  className = "",
  id,
}: {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  /** Filter the list to a role, or several (e.g. ["back_office", "marketing"]).
   *  Omit for all team members. IGNORED while `department` is set — a
   *  department is the more specific answer, and ANDing the two silently
   *  produces an empty picker (e.g. department "sales" against a back-office
   *  role list). */
  role?: string | string[];
  /**
   * Restrict to one department. Members are anyone whose ROLES belong to that
   * department (see config/departments.ts) or whose department column names it
   * — never narrowed by branch or desk. The picker follows the department
   * chosen on the form above it.
   */
  department?: string | null;
  placeholder?: string;
  /** Adds an "— Unassigned —" option that emits null on select. */
  allowClear?: boolean;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
}) {
  const roleList = Array.isArray(role) ? role : role ? [role] : [];
  const cacheKey = roleList.length ? roleList.join(",") : "_all";
  const [rows, setRows] = useState<Employee[] | null>(() => {
    const c = cache.get(cacheKey);
    return c && Date.now() - c.at < CACHE_TTL_MS ? c.rows : null;
  });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const c = cache.get(cacheKey);
    if (c && Date.now() - c.at < CACHE_TTL_MS) {
      setRows(c.rows);
      return;
    }
    const params = new URLSearchParams();
    // The API matches ANY of the listed roles.
    for (const r of roleList) params.append("role", r);
    fetch(`/api/employees${params.toString() ? `?${params}` : ""}`)
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}`);
        }
        const j = await r.json();
        if (cancelled) return;
        const list = (j.rows ?? []) as Employee[];
        cache.set(cacheKey, { rows: list, at: Date.now() });
        setRows(list);
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message ?? "Failed to load team");
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, role]);

  // Department wins over the role filter when both are supplied — see the prop
  // doc. Filtering here rather than in the request keeps one cached fetch
  // serving every department as the user flips between them.
  //
  // Matched on the department's ROLE SET as well as the department column:
  // users.department is optional and usually blank, so column-only matching
  // offered nobody. "Sales" means every RM and sub broker in the FIRM — no
  // branch or desk narrowing, since assigning work crosses sub-branches.
  const visible = department
    ? (rows ?? []).filter((e) => inDepartment(e, department))
    : rows;

  // A person picked before the department changed is no longer a valid answer;
  // clearing it stops the form submitting someone outside the department.
  useEffect(() => {
    if (!department || !visible || !value) return;
    if (!visible.some((e) => e.id === value)) onChange(null);
  }, [department, visible, value]); // eslint-disable-line react-hooks/exhaustive-deps

  if (rows == null) {
    // Skeleton, not text — a quiet shimmer instead of "Loading…" flashing in a form.
    return (
      <div className={`input-base flex items-center ${className}`} aria-busy="true" aria-label="Loading team">
        <div className="h-3.5 w-28 rounded bg-secondary animate-pulse" />
      </div>
    );
  }

  if (err) {
    return (
      <div className={`input-base text-destructive text-xs ${className}`}>
        Couldn't load team — {err}
      </div>
    );
  }

  if (department && visible && visible.length === 0) {
    return (
      <div className={`input-base flex items-center gap-2 text-muted-foreground text-xs ${className}`}>
        <Users className="size-3.5" />
        No one in this department yet —{" "}
        <a href="/dashboard/employees" className="text-brand-cyan hover:underline">
          assign someone
        </a>
        .
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div
        className={`input-base flex items-center gap-2 text-muted-foreground text-xs ${className}`}
      >
        <Users className="size-3.5" />
        No team members yet —{" "}
        <a
          href="/dashboard/employees"
          className="text-brand-cyan hover:underline"
        >
          add one
        </a>
        .
      </div>
    );
  }

  return (
    <SelectField
      id={id}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled}
      required={required}
      placeholder={placeholder}
      className={className}
    >
      {allowClear && <option value="">{placeholder}</option>}
      {!allowClear && !value && <option value="" disabled>{placeholder}</option>}
      {(visible ?? []).map((e) => (
        <option key={e.id} value={e.id}>
          {e.name}
          {e.roles.length > 0 ? ` · ${primaryRole(e.roles)}` : ""}
          {e.department ? ` · ${e.department}` : ""}
        </option>
      ))}
    </SelectField>
  );
}

/** Pick a human-readable primary role from the stacked roles array. */
function primaryRole(roles: string[]): string {
  const priority = ["owner", "branch_head", "rm", "back_office", "ops", "compliance", "marketing"];
  for (const p of priority) {
    if (roles.includes(p)) return p.replace(/_/g, " ");
  }
  return roles[0]?.replace(/_/g, " ") ?? "team";
}
