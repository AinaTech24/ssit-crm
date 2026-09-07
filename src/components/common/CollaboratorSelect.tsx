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

type Member = { id: string; name: string | null; email: string | null };

/** Cached across mounts — the roster rarely changes within a session. */
let cache: Member[] | null = null;

export function CollaboratorSelect({
  values,
  onChange,
  max = 20,
  placeholder = "Add colleagues…",
  excludeUserId,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  max?: number;
  placeholder?: string;
  /** Usually the current user — they own the meeting, so listing them is noise. */
  excludeUserId?: string | null;
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

  const options = members
    .filter((m) => m.id !== excludeUserId)
    .map((m) => ({ value: m.id, label: m.name || m.email || "—" }));

  return (
    <MultiSelectField
      values={values}
      onChange={onChange}
      options={options}
      max={max}
      placeholder={placeholder}
    />
  );
}
