"use client";

/**
 * "Which event did this lead come from?" - the dropdown of the firm's events, with
 * "+ Add event" and a remove (bin) on each row. Same behaviour as the New-lead form.
 *
 * `value` is the event's NAME (what a lead stores in its campaign field). Picking one
 * is what makes a lead an "event lead".
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { EventSelect, type LeadEvent } from "@/components/leads/EventSelect";

export function LeadEventPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (label: string) => void;
  disabled?: boolean;
}) {
  const [events, setEvents] = useState<LeadEvent[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [newEvent, setNewEvent] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/lead-events")
      .then((r) => r.json())
      .then((j) => { if (alive) setEvents(Array.isArray(j.events) ? j.events : []); })
      .catch(() => { if (alive) setEvents([]); });
    return () => { alive = false; };
  }, []);

  const remove = useCallback(
    async (ev: LeadEvent) => {
      // The lead's current event, kept in the list only so it shows as chosen - not a stored event.
      if (ev.key.startsWith("__current_")) {
        if (value === ev.label) onChange("");
        return;
      }
      const ok = confirm(`Remove "${ev.label}" from the event list?\n\nLeads already tagged with it keep their attribution.`);
      if (!ok) return;
      const res = await fetch(`/api/lead-events?key=${encodeURIComponent(ev.key)}`, { method: "DELETE" });
      if (!res.ok) {
        setErr((await res.json().catch(() => ({})))?.error ?? "Could not remove the event.");
        return;
      }
      setErr(null);
      setEvents((list) => (list ?? []).filter((e) => e.key !== ev.key));
      if (value === ev.label) onChange("");
    },
    [value, onChange]
  );

  async function save() {
    const label = newEvent.trim();
    if (label.length < 2) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/lead-events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Could not add the event");
        return;
      }
      const ev = j.event as LeadEvent;
      setEvents((prev) => [...(prev ?? []).filter((e) => e.key !== ev.key), ev].sort((a, b) => a.label.localeCompare(b.label)));
      onChange(ev.label);
      setNewEvent("");
      setAdding(false);
    } finally {
      setSaving(false);
    }
  }

  // An event already on the lead that is no longer in the firm's list still shows as chosen.
  const shown =
    events && value && !events.some((e) => e.label === value) ? [...events, { key: `__current_${value}`, label: value }] : events;

  return (
    <div className="space-y-1">
      {adding ? (
        <div className="flex gap-2">
          <input
            autoFocus
            value={newEvent}
            onChange={(e) => setNewEvent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); save(); }
              if (e.key === "Escape") { setAdding(false); setNewEvent(""); }
            }}
            placeholder="e.g. Andheri Investor Meet 2026"
            className="w-full border rounded-md px-2 py-1 text-sm bg-background"
          />
          <button
            type="button"
            onClick={save}
            disabled={saving || newEvent.trim().length < 2}
            className="rounded-md bg-primary text-primary-foreground px-3 text-xs font-medium disabled:opacity-50 inline-flex items-center gap-1"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />} Save
          </button>
          <button type="button" onClick={() => { setAdding(false); setNewEvent(""); }} className="rounded-md border px-3 text-xs hover:bg-accent">
            Cancel
          </button>
        </div>
      ) : (
        <>
          <EventSelect events={shown} value={value} onChange={onChange} onDelete={remove} disabled={disabled} />
          <button type="button" onClick={() => { setAdding(true); setNewEvent(""); }} className="text-[11px] font-semibold text-brand-cyan hover:underline">
            + Add event
          </button>
        </>
      )}
      {err && <div className="text-[11px] text-destructive">{err}</div>}
    </div>
  );
}
