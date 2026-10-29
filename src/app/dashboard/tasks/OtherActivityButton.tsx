"use client";

/**
 * "Other activity" — logs day-to-day work that isn't a client task. Pick a kind
 * (bank work, AMC work, BA service, other), type what it is, save: it is stored
 * as a task of type `other_activity` and listed under Tasks → Other activity.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, ChevronDown, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

const KINDS = [
  { key: "bank_work", label: "Bank work", hint: "e.g. Bank mandate added for DM025" },
  { key: "amc_work", label: "AMC work", hint: "e.g. Empanelment form submitted to the AMC" },
  { key: "ba_service", label: "BA service", hint: "e.g. Back-office service for a client" },
  { key: "other", label: "Other", hint: "Describe the activity" },
] as const;

type Kind = (typeof KINDS)[number];

export function OtherActivityButton() {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function close() {
    setOpen(false);
    setKind(null);
    setText("");
  }

  async function save() {
    const what = text.trim();
    if (!kind || what.length < 2 || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `${kind.label}: ${what}`.slice(0, 300), activityKind: kind.key }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "Couldn't save");
      toast.success(`${kind.label} added to Other activity`);
      close();
      router.push("/dashboard/tasks?view=other");
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save the activity", "Not saved");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        className="rounded-md border px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 hover:bg-accent"
      >
        <Briefcase className="size-4" /> Other activity <ChevronDown className="size-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-72 rounded-lg border bg-card p-2 shadow-lg">
          {!kind ? (
            <div className="flex flex-col">
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                What kind of activity?
              </div>
              {KINDS.map((k) => (
                <button
                  key={k.key}
                  type="button"
                  onClick={() => setKind(k)}
                  className="rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                >
                  {k.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-2 p-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{kind.label}</span>
                <button type="button" onClick={() => setKind(null)} className="text-xs text-muted-foreground hover:underline">
                  Change
                </button>
              </div>
              <textarea
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
                }}
                rows={3}
                maxLength={280}
                placeholder={kind.hint}
                className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={close} className="rounded-md border px-3 py-1 text-xs hover:bg-accent">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || text.trim().length < 2}
                  className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50 inline-flex items-center gap-1"
                >
                  {saving && <Loader2 className="size-3 animate-spin" />} Save
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
