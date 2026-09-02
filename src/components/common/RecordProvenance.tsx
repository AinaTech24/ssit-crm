"use client";

/**
 * RecordProvenance — an at-a-glance "Created by X · date · Last modified by Y ·
 * date" line for any record. Reads the existing per-record audit trail
 * (GET /api/audit?entityType=&entityId=) and derives the first + latest *actor*,
 * ignoring read/PII-access events so "last modified" reflects a real change, not
 * whoever last opened the page. Falls back to the record's own created_at /
 * updated_at so the date/time always shows even before the trail has entries.
 *
 * Pairs with <ChangeLogButton/> (full history drawer). Drop on any detail page:
 *   <RecordProvenance entityType="lead" entityId={l.id}
 *     createdAt={l.createdAt} updatedAt={l.updatedAt} />
 */

import { useEffect, useState } from "react";
import { UserRound, PencilLine } from "lucide-react";

type Entry = { action: string; actor_type: string; at: string; actor_name: string | null };

// Actions that only READ a record (no mutation) — excluded when picking the
// "last modified" entry so a page view / export / download never looks like an edit.
const READ_ACTION = /(?:^|\.)(view|export|access|download|print|read|open|list|search)$/i;
const CREATE_ACTION = /(?:^|\.)create$/i;

function fmt(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(d);
}

export function RecordProvenance({
  entityType,
  entityId,
  createdAt,
  updatedAt,
  className = "",
}: {
  entityType: string;
  entityId: string;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  className?: string;
}) {
  const [entries, setEntries] = useState<Entry[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/audit?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive) setEntries(Array.isArray(j?.entries) ? j.entries : []); })
      .catch(() => { if (alive) setEntries([]); });
    return () => { alive = false; };
  }, [entityType, entityId]);

  // /api/audit returns newest-first. Keep only mutation events for attribution.
  const mutations = (entries ?? []).filter((e) => !READ_ACTION.test(e.action));
  const created = mutations.slice().reverse().find((e) => CREATE_ACTION.test(e.action)) ?? mutations[mutations.length - 1];
  const modified = mutations[0];
  const sameEvent = !!(modified && created && modified.at === created.at && modified.action === created.action);

  const createdWhen = fmt(created?.at) ?? fmt(createdAt);
  const createdBy = created?.actor_name ?? null;
  const modifiedWhen = (!sameEvent ? fmt(modified?.at) : null) ?? fmt(updatedAt);
  const modifiedBy = !sameEvent ? (modified?.actor_name ?? null) : null;

  if (!createdWhen && !modifiedWhen) return null;

  const showModified = !!modifiedWhen && (modifiedWhen !== createdWhen || !!modifiedBy);

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground ${className}`}>
      {createdWhen && (
        <span className="inline-flex items-center gap-1">
          <UserRound className="size-3 shrink-0" />
          Created{createdBy ? <> by <span className="font-medium text-foreground/80">{createdBy}</span></> : null}
          <span className="opacity-70"> · {createdWhen}</span>
        </span>
      )}
      {showModified && (
        <span className="inline-flex items-center gap-1">
          <PencilLine className="size-3 shrink-0" />
          Last modified{modifiedBy ? <> by <span className="font-medium text-foreground/80">{modifiedBy}</span></> : null}
          <span className="opacity-70"> · {modifiedWhen}</span>
        </span>
      )}
    </div>
  );
}
