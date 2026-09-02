"use client";

/**
 * Daily Job Tracker — the editable half: today's focus list + the reflective
 * fields (key learning, breakdown, breakthrough). The "completed yesterday" /
 * "carried over" lists are rendered server-side on the page (read-only, derived
 * from tasks). Owners viewing someone else's day get `readOnly`.
 */

import { useState } from "react";
import { Plus, X, Loader2, Save, CheckCircle2, Lightbulb, AlertTriangle, Sparkles } from "lucide-react";
import type { FocusItem } from "@/lib/daily-tracker";

type Due = { id: string; title: string; priority: string; for: string | null };
const TYPE_STYLE: Record<string, string> = {
  client: "bg-brand-cyan-light/60 text-brand-cyan-deep",
  lead: "bg-amber-50 text-amber-700",
  other: "bg-slate-100 text-slate-600",
};

export function DailyTrackerForm({
  date,
  initial,
  dueToday,
  readOnly = false,
}: {
  date: string;
  initial: { keyLearning: string; breakdown: string; breakthrough: string; todayFocus: FocusItem[] };
  dueToday: Due[];
  readOnly?: boolean;
}) {
  const [keyLearning, setKeyLearning] = useState(initial.keyLearning);
  const [breakdown, setBreakdown] = useState(initial.breakdown);
  const [breakthrough, setBreakthrough] = useState(initial.breakthrough);
  const [focus, setFocus] = useState<FocusItem[]>(initial.todayFocus ?? []);
  const [text, setText] = useState("");
  const [type, setType] = useState<"client" | "lead" | "other">("client");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const dirty = () => state !== "saving" && setState("idle");
  function add(t: string, forType: FocusItem["forType"], taskId?: string) {
    const v = t.trim();
    if (!v) return;
    setFocus((f) => [...f, { text: v, forType, taskId }]);
    setText("");
    dirty();
  }
  const usedTasks = new Set(focus.map((f) => f.taskId).filter(Boolean));

  async function save() {
    setState("saving");
    try {
      const r = await fetch("/api/daily-tracker", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date, keyLearning, breakdown, breakthrough, todayFocus: focus }),
      });
      setState(r.ok ? "saved" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="space-y-4">
      {/* 4. Today's important & productive work */}
      <section className="card-surface p-4 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Sparkles className="size-4 text-brand-cyan" /> Today&apos;s important &amp; productive work
        </h3>

        {focus.length > 0 && (
          <ul className="space-y-1.5">
            {focus.map((f, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!f.done}
                  disabled={readOnly}
                  onChange={() => {
                    setFocus((x) => x.map((y, j) => (j === i ? { ...y, done: !y.done } : y)));
                    dirty();
                  }}
                  className="size-4 rounded border-border accent-brand-cyan"
                />
                <span className={`${f.done ? "line-through text-muted-foreground" : ""}`}>{f.text}</span>
                {f.forType && <span className={`chip text-[10px] ${TYPE_STYLE[f.forType]}`}>{f.forType}</span>}
                {!readOnly && (
                  <button
                    onClick={() => {
                      setFocus((x) => x.filter((_, j) => j !== i));
                      dirty();
                    }}
                    className="ml-auto text-muted-foreground hover:text-rose-600"
                    aria-label="Remove"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {!readOnly && (
          <>
            <div className="flex items-center gap-1.5">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add(text, type)}
                placeholder="Add a focus item for today…"
                className="input-base h-8 text-xs flex-1"
              />
              <div className="inline-flex rounded-lg border border-border p-0.5 gap-0.5">
                {(["client", "lead", "other"] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setType(k)}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-medium capitalize ${type === k ? TYPE_STYLE[k] : "text-muted-foreground"}`}
                  >
                    {k}
                  </button>
                ))}
              </div>
              <button onClick={() => add(text, type)} className="btn-ghost text-xs" aria-label="Add">
                <Plus className="size-4" />
              </button>
            </div>

            {dueToday.filter((d) => !usedTasks.has(d.id)).length > 0 && (
              <div className="text-xs text-muted-foreground space-y-1">
                <div className="font-medium">Due today — tap to add:</div>
                <div className="flex flex-wrap gap-1.5">
                  {dueToday
                    .filter((d) => !usedTasks.has(d.id))
                    .map((d) => (
                      <button
                        key={d.id}
                        onClick={() => add(d.title, d.for ? "client" : "other", d.id)}
                        className="chip bg-secondary hover:bg-brand-cyan-light/50 text-[11px]"
                      >
                        <Plus className="size-3" /> {d.title}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* 3 / 5 / 6 — reflection */}
      <div className="grid md:grid-cols-3 gap-3">
        <ReflectField icon={Lightbulb} tone="text-sky-600" label="One key learning" value={keyLearning} onChange={(v) => { setKeyLearning(v); dirty(); }} readOnly={readOnly} />
        <ReflectField icon={AlertTriangle} tone="text-amber-600" label="Breakdown" value={breakdown} onChange={(v) => { setBreakdown(v); dirty(); }} readOnly={readOnly} />
        <ReflectField icon={CheckCircle2} tone="text-emerald-600" label="Breakthrough" value={breakthrough} onChange={(v) => { setBreakthrough(v); dirty(); }} readOnly={readOnly} />
      </div>

      {!readOnly && (
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={state === "saving"}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-cyan text-white px-3 py-2 text-sm font-medium hover:bg-brand-cyan-deep disabled:opacity-50"
          >
            {state === "saving" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save today&apos;s tracker
          </button>
          {state === "saved" && <span className="text-xs text-emerald-600 inline-flex items-center gap-1"><CheckCircle2 className="size-3.5" /> Saved</span>}
          {state === "error" && <span className="text-xs text-rose-600">Couldn&apos;t save — try again.</span>}
        </div>
      )}
    </div>
  );
}

function ReflectField({
  icon: Icon,
  tone,
  label,
  value,
  onChange,
  readOnly,
}: {
  icon: any;
  tone: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  readOnly: boolean;
}) {
  return (
    <div className="card-surface p-3 space-y-1.5">
      <div className={`text-xs font-semibold flex items-center gap-1.5 ${tone}`}>
        <Icon className="size-3.5" /> {label}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        rows={4}
        placeholder={readOnly ? "—" : "…"}
        className="input-base text-xs w-full resize-none read-only:bg-secondary/30"
      />
    </div>
  );
}
