"use client";

import { useMemo, useState } from "react";
import { Loader2, Save, CheckCircle2, XCircle, Search } from "lucide-react";

type State = "enabled" | "beta" | "disabled";
type Mod = { key: string; label: string; group: string; state: State };

const STATES: { value: State; label: string; cls: string; activeCls: string }[] = [
  { value: "enabled", label: "Enabled", cls: "text-emerald-700", activeCls: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300" },
  { value: "beta", label: "Beta", cls: "text-amber-700", activeCls: "bg-amber-100 text-amber-800 ring-1 ring-amber-300" },
  { value: "disabled", label: "Disabled", cls: "text-rose-700", activeCls: "bg-rose-100 text-rose-800 ring-1 ring-rose-300" },
];

export function ModuleControlsForm({ initial }: { initial: Mod[] }) {
  const [mods, setMods] = useState<Mod[]>(initial);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const dirty = useMemo(
    () => mods.some((m, i) => m.state !== initial[i]?.state),
    [mods, initial]
  );
  const counts = useMemo(() => {
    const c = { enabled: 0, beta: 0, disabled: 0 } as Record<State, number>;
    for (const m of mods) c[m.state]++;
    return c;
  }, [mods]);

  const filtered = q.trim()
    ? mods.filter((m) => m.label.toLowerCase().includes(q.toLowerCase()) || m.key.includes(q.toLowerCase()))
    : mods;
  // Preserve registry order of groups.
  const groups: { name: string; items: Mod[] }[] = [];
  for (const m of filtered) {
    let g = groups.find((x) => x.name === m.group);
    if (!g) { g = { name: m.group, items: [] }; groups.push(g); }
    g.items.push(m);
  }

  function setState(key: string, state: State) {
    setMods((prev) => prev.map((m) => (m.key === key ? { ...m, state } : m)));
    setMsg(null);
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const controls: Record<string, State> = {};
      for (const m of mods) controls[m.key] = m.state;
      const res = await fetch("/api/super-admin/module-controls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ controls }),
      });
      const data = await res.json();
      if (!res.ok) setMsg({ kind: "err", text: data.error || "Save failed." });
      else {
        setMsg({ kind: "ok", text: "Saved — applies to every tenant within ~30 seconds." });
      }
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Network error." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700">{counts.enabled} enabled</span>
        <span className="px-2 py-1 rounded-full bg-amber-50 text-amber-700">{counts.beta} beta</span>
        <span className="px-2 py-1 rounded-full bg-rose-50 text-rose-700">{counts.disabled} disabled</span>
        <div className="relative ml-auto w-full sm:w-auto">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a module…"
            className="rounded-md border pl-7 pr-2 py-1.5 text-xs w-full sm:w-48"
          />
        </div>
      </div>

      <div className="space-y-3">
        {groups.map((g) => (
          <div key={g.name} className="border rounded-lg bg-card overflow-hidden">
            <div className="px-4 py-1.5 bg-muted/40 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.name}</div>
            <div className="divide-y">
              {g.items.map((m) => (
                <div key={m.key} className="flex flex-wrap items-center gap-2 px-4 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{m.label}</div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate">{m.key}</div>
                  </div>
                  <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-0.5 shrink-0">
                    {STATES.map((st) => (
                      <button
                        key={st.value}
                        type="button"
                        onClick={() => setState(m.key, st.value)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                          m.state === st.value ? st.activeCls : `text-muted-foreground hover:${st.cls}`
                        }`}
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="border rounded-lg bg-card px-4 py-8 text-center text-sm text-muted-foreground">No modules match “{q}”.</div>}
      </div>

      {msg && (
        <div className={`flex items-start gap-2 text-sm rounded-md px-3 py-2 ${msg.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
          {msg.kind === "ok" ? <CheckCircle2 className="size-4 mt-0.5" /> : <XCircle className="size-4 mt-0.5" />}
          <span>{msg.text}</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3.5 py-2 text-sm font-medium disabled:opacity-60"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save changes
        </button>
        {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
      </div>
    </div>
  );
}
