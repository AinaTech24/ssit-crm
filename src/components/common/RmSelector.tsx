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
  placeholder = "— Choose team member —",
  allowClear = true,
  disabled,
  required,
  className = "",
  id,
}: {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  /** Filter the list to one role (e.g. "rm"). Omit for all team members. */
  role?: string;
  placeholder?: string;
  /** Adds an "— Unassigned —" option that emits null on select. */
  allowClear?: boolean;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
}) {
  const cacheKey = role ?? "_all";
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
    if (role) params.set("role", role);
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
      {rows.map((e) => (
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
