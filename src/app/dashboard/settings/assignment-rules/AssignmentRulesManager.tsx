"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2, GitBranch } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";

type TeamMember = { id: string; name: string };
type Rule = {
  id: string;
  name: string;
  subject_type: string;
  strategy: string;
  target_user_ids: string[];
  target_names?: string[] | null;
  priority: number;
  is_active: boolean;
};

const STRATEGY_LABEL: Record<string, string> = {
  round_robin: "Round-robin",
  load_balanced: "Load-balanced (fewest open)",
  specific: "Specific person",
};

export default function AssignmentRulesManager({ team }: { team: TeamMember[] }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [subjectType, setSubjectType] = useState("lead");
  const [strategy, setStrategy] = useState("round_robin");
  const [targets, setTargets] = useState<string[]>([]);
  const [priority, setPriority] = useState(100);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/assignment-rules");
      if (res.ok) setRules((await res.json()).rules ?? []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function create() {
    setMsg(null);
    if (name.trim().length < 2) return setMsg("Give the rule a name");
    if (targets.length === 0) return setMsg("Pick at least one team member to assign to");
    setCreating(true);
    try {
      const res = await fetch("/api/assignment-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), subjectType, strategy, targetUserIds: targets, criteria: {}, priority, isActive: true }),
      });
      const data = await res.json();
      if (!res.ok) setMsg(data?.error ?? "Could not create rule");
      else { setName(""); setTargets([]); setPriority(100); await load(); }
    } finally {
      setCreating(false);
    }
  }

  async function toggle(r: Rule) {
    await fetch(`/api/assignment-rules/${r.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !r.is_active }),
    });
    load();
  }
  async function remove(r: Rule) {
    if (!confirm(`Delete rule "${r.name}"?`)) return;
    await fetch(`/api/assignment-rules/${r.id}`, { method: "DELETE" });
    load();
  }

  const field = "rounded-md border px-3 py-2 text-sm bg-background";

  return (
    <div className="space-y-6">
      {/* New rule */}
      <div className="border rounded-lg bg-card p-5 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-2"><Plus className="size-4" /> New auto-assignment rule</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <input className={field} placeholder="Rule name (e.g. Website leads → Sales team)" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <SelectField className="w-full" value={subjectType} onChange={(e) => setSubjectType(e.target.value)}>
              <option value="lead">Leads</option>
              <option value="investor">Clients</option>
            </SelectField>
            <SelectField className="w-full" value={strategy} onChange={(e) => setStrategy(e.target.value)}>
              <option value="round_robin">Round-robin</option>
              <option value="load_balanced">Load-balanced</option>
            </SelectField>
            <input className={field} type="number" min={0} max={1000} value={priority} onChange={(e) => setPriority(Number(e.target.value))} title="Priority (lower runs first)" />
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1.5">Assign to</div>
          <div className="flex flex-wrap gap-2">
            {team.map((m) => {
              const on = targets.includes(m.id);
              return (
                <button key={m.id} type="button"
                  onClick={() => setTargets((t) => on ? t.filter((x) => x !== m.id) : [...t, m.id])}
                  className={`text-xs px-2.5 py-1 rounded-full border ${on ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>
                  {m.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={create} disabled={creating} className="text-sm px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2">
            {creating && <Loader2 className="size-3.5 animate-spin" />} Create rule
          </button>
          {msg && <span className="text-sm text-red-600">{msg}</span>}
        </div>
      </div>

      {/* Existing rules */}
      <div className="border rounded-lg bg-card">
        <div className="px-5 py-3 border-b text-sm font-semibold">Active rules</div>
        {loading ? (
          <div className="p-8 text-center text-muted-foreground text-sm"><Loader2 className="size-5 mx-auto animate-spin" /></div>
        ) : rules.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <GitBranch className="size-7 mx-auto text-muted-foreground/40" />
            <div className="mt-2">No rules yet — new leads/clients won't be auto-assigned.</div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr><th className="text-left px-5 py-2">Rule</th><th className="text-left py-2">For</th><th className="text-left py-2">Strategy</th><th className="text-left py-2">Assigns to</th><th className="text-left py-2">Priority</th><th className="px-5 py-2"></th></tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-5 py-3 font-medium">{r.name}</td>
                  <td className="py-3 capitalize">{r.subject_type}</td>
                  <td className="py-3">{STRATEGY_LABEL[r.strategy] ?? r.strategy}</td>
                  <td className="py-3 text-xs text-muted-foreground">{(r.target_names ?? []).filter(Boolean).join(", ") || `${r.target_user_ids.length} member(s)`}</td>
                  <td className="py-3 tabular-nums">{r.priority}</td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <button onClick={() => toggle(r)} className={`text-xs px-2 py-1 rounded-md border mr-2 ${r.is_active ? "text-emerald-700 border-emerald-200 bg-emerald-50" : "text-muted-foreground"}`}>
                      {r.is_active ? "Active" : "Paused"}
                    </button>
                    <button onClick={() => remove(r)} className="text-muted-foreground hover:text-red-600"><Trash2 className="size-4 inline" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
