"use client";

/**
 * SalesOpsManager — config UI for the four Zoho-style platform rules:
 * Assignment Rules, Macros, Validation Rules, and Cadences. Compact list +
 * create drawer per tab. (Edit = recreate for v1; delete supported on
 * assignment rules.)
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X, Save, Trash2, Users, Zap, ShieldCheck, Repeat } from "lucide-react";

type User = { id: string; name: string };
type Row = Record<string, any>;
const TABS = [
  { key: "assignment", label: "Assignment", icon: Users },
  { key: "macros", label: "Macros", icon: Zap },
  { key: "validation", label: "Validation", icon: ShieldCheck },
  { key: "cadences", label: "Cadences", icon: Repeat },
] as const;

export function SalesOpsManager({ users, assignment, macros, validation, cadences }: { users: User[]; assignment: Row[]; macros: Row[]; validation: Row[]; cadences: Row[] }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("assignment");
  const [drawer, setDrawer] = useState<string | null>(null);
  const lists: Record<string, Row[]> = { assignment, macros, validation, cadences };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`px-3 py-1.5 rounded-md text-sm font-medium border inline-flex items-center gap-1.5 ${tab === t.key ? "bg-brand-cyan text-white border-brand-cyan" : "border-border text-muted-foreground hover:bg-secondary"}`}>
            <t.icon className="size-4" /> {t.label} <span className="opacity-70">{lists[t.key].length}</span>
          </button>
        ))}
      </div>

      <div className="flex justify-end">
        <button onClick={() => setDrawer(tab)} className="btn-primary text-sm inline-flex items-center gap-1"><Plus className="size-4" /> New {tab}</button>
      </div>

      <div className="card-surface divide-y">
        {lists[tab].length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No {tab} rules yet.</div>
        ) : lists[tab].map((r) => <RuleRow key={r.id} tab={tab} row={r} users={users} />)}
      </div>

      {drawer === "assignment" && <AssignmentDrawer users={users} onClose={() => setDrawer(null)} />}
      {drawer === "macros" && <MacroDrawer onClose={() => setDrawer(null)} />}
      {drawer === "validation" && <ValidationDrawer onClose={() => setDrawer(null)} />}
      {drawer === "cadences" && <CadenceDrawer onClose={() => setDrawer(null)} />}
    </div>
  );
}

function RuleRow({ tab, row, users }: { tab: string; row: Row; users: User[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? "—";
  async function del() {
    if (tab !== "assignment") return;
    if (!confirm(`Delete "${row.name}"?`)) return;
    setBusy(true);
    try { await fetch(`/api/assignment-rules/${row.id}`, { method: "DELETE" }); router.refresh(); } finally { setBusy(false); }
  }
  let detail = "";
  if (tab === "assignment") detail = `${String(row.strategy).replace(/_/g, " ")} · ${(row.target_user_ids ?? []).map(nameOf).join(", ")}`;
  else if (tab === "macros") detail = `${(row.steps ?? []).length} step(s) · ${row.subject_type}`;
  else if (tab === "validation") detail = `${row.field} ${String(row.operator).replace(/_/g, " ")} · ${row.severity}`;
  else if (tab === "cadences") detail = `${(row.steps ?? []).length} step(s) · ${row.subject_type}`;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-sm">{row.name} {!row.is_active && <span className="chip text-[10px] bg-slate-100 text-slate-500">inactive</span>}</div>
        <div className="text-[11px] text-muted-foreground truncate">{detail}{tab === "validation" && row.error_message ? ` · "${row.error_message}"` : ""}</div>
      </div>
      {tab === "assignment" && <button onClick={del} disabled={busy} className="rounded p-1.5 hover:bg-rose-50 text-rose-500" title="Delete">{busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}</button>}
    </div>
  );
}

function Drawer({ title, onClose, onSave, busy, children }: { title: string; onClose: () => void; onSave: () => void; busy: boolean; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg h-full bg-card border-l shadow-2xl flex flex-col">
        <div className="px-5 py-3 border-b flex items-center justify-between"><div className="font-semibold">{title}</div><button onClick={onClose} className="rounded p-1 hover:bg-accent"><X className="size-4" /></button></div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">{children}</div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t"><button onClick={onClose} className="btn-secondary text-xs">Cancel</button><button onClick={onSave} disabled={busy} className="btn-primary text-xs inline-flex items-center gap-1">{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save</button></div>
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><div className="text-[11px] text-muted-foreground mb-0.5">{label}</div>{children}</label>; }

async function post(url: string, body: any, onDone: () => void, setBusy: (b: boolean) => void, setErr: (s: string | null) => void) {
  setBusy(true); setErr(null);
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.error ?? `Failed (${res.status})`); return; }
    onDone();
  } finally { setBusy(false); }
}

function AssignmentDrawer({ users, onClose }: { users: User[]; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(""); const [strategy, setStrategy] = useState("round_robin");
  const [targets, setTargets] = useState<string[]>([]); const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const toggle = (id: string) => setTargets((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  function save() {
    if (name.length < 2 || !targets.length) { setErr("Name + at least one RM required."); return; }
    post("/api/assignment-rules", { name, subjectType: "lead", strategy, targetUserIds: targets, criteria: source ? { source } : {} }, () => { onClose(); router.refresh(); }, setBusy, setErr);
  }
  return (
    <Drawer title="New assignment rule" onClose={onClose} onSave={save} busy={busy}>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className="input-base" placeholder="e.g. Website leads → round robin" /></Field>
      <Field label="Strategy"><select value={strategy} onChange={(e) => setStrategy(e.target.value)} className="input-base"><option value="round_robin">Round robin</option><option value="load_balanced">Load balanced (fewest open)</option><option value="specific">Specific RM</option></select></Field>
      <Field label="Only when lead source = (optional)"><input value={source} onChange={(e) => setSource(e.target.value)} className="input-base" placeholder="Website" /></Field>
      <div><div className="text-[11px] text-muted-foreground mb-1">RMs to assign</div>
        <div className="flex flex-wrap gap-1.5">{users.map((u) => <button key={u.id} type="button" onClick={() => toggle(u.id)} className={`px-2.5 py-1 rounded-md text-xs border ${targets.includes(u.id) ? "bg-brand-cyan text-white border-brand-cyan" : "border-border text-muted-foreground hover:bg-secondary"}`}>{u.name}</button>)}</div>
      </div>
      {err && <div className="text-sm text-rose-600">{err}</div>}
    </Drawer>
  );
}

function MacroDrawer({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(""); const [subjectType, setSubjectType] = useState("lead");
  const [steps, setSteps] = useState<Array<{ type: string; config: any }>>([{ type: "log_activity", config: { kind: "call", subject: "" } }]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const update = (i: number, patch: any) => setSteps((s) => s.map((st, j) => j === i ? { ...st, config: { ...st.config, ...patch } } : st));
  const setType = (i: number, type: string) => setSteps((s) => s.map((st, j) => j === i ? { type, config: {} } : st));
  function save() {
    if (name.length < 2 || !steps.length) { setErr("Name + a step required."); return; }
    post("/api/macros", { name, subjectType, steps }, () => { onClose(); router.refresh(); }, setBusy, setErr);
  }
  return (
    <Drawer title="New macro" onClose={onClose} onSave={save} busy={busy}>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className="input-base" placeholder="e.g. After first call" /></Field>
      <Field label="For"><select value={subjectType} onChange={(e) => setSubjectType(e.target.value)} className="input-base"><option value="lead">Leads</option><option value="investor">Clients</option></select></Field>
      <div className="space-y-2">
        <div className="text-[11px] text-muted-foreground">Steps (run in order)</div>
        {steps.map((st, i) => (
          <div key={i} className="rounded-lg border p-2 space-y-1.5">
            <div className="flex items-center gap-2">
              <select value={st.type} onChange={(e) => setType(i, e.target.value)} className="input-base text-xs flex-1">
                <option value="log_activity">Log activity</option><option value="create_task">Create task</option><option value="add_note">Add note</option>
                {subjectType === "lead" && <option value="advance_stage">Advance stage</option>}
                {subjectType === "lead" && <option value="set_followup">Set follow-up</option>}
              </select>
              <button onClick={() => setSteps((s) => s.filter((_, j) => j !== i))} className="text-rose-500"><Trash2 className="size-3.5" /></button>
            </div>
            {st.type === "create_task" && <div className="flex gap-2"><input placeholder="Task title" className="input-base text-xs flex-1" onChange={(e) => update(i, { title: e.target.value })} /><input type="number" placeholder="due in days" className="input-base text-xs w-24" onChange={(e) => update(i, { dueInDays: Number(e.target.value) })} /></div>}
            {(st.type === "log_activity") && <div className="flex gap-2"><select className="input-base text-xs w-28" onChange={(e) => update(i, { kind: e.target.value })}><option value="call">call</option><option value="note">note</option><option value="visit">visit</option></select><input placeholder="subject" className="input-base text-xs flex-1" onChange={(e) => update(i, { subject: e.target.value })} /></div>}
            {st.type === "add_note" && <input placeholder="Note text" className="input-base text-xs" onChange={(e) => update(i, { text: e.target.value })} />}
            {st.type === "advance_stage" && <input placeholder="stage key (e.g. contacted)" className="input-base text-xs" onChange={(e) => update(i, { stage: e.target.value })} />}
            {st.type === "set_followup" && <input type="number" placeholder="days from now" className="input-base text-xs w-32" onChange={(e) => update(i, { days: Number(e.target.value) })} />}
          </div>
        ))}
        <button onClick={() => setSteps((s) => [...s, { type: "log_activity", config: {} }])} className="btn-ghost text-xs"><Plus className="size-3.5" /> Add step</button>
      </div>
      {err && <div className="text-sm text-rose-600">{err}</div>}
    </Drawer>
  );
}

function ValidationDrawer({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({ name: "", subjectType: "lead", field: "phone", operator: "required", value: "", errorMessage: "", severity: "block", whenStage: "" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  function save() {
    if (f.name.length < 2 || !f.field || !f.errorMessage) { setErr("Name, field, and message required."); return; }
    post("/api/validation-rules", { name: f.name, subjectType: f.subjectType, field: f.field, operator: f.operator, value: f.value || null, errorMessage: f.errorMessage, severity: f.severity, appliesWhen: f.whenStage ? { stage: f.whenStage } : {} }, () => { onClose(); router.refresh(); }, setBusy, setErr);
  }
  return (
    <Drawer title="New validation rule" onClose={onClose} onSave={save} busy={busy}>
      <Field label="Name"><input value={f.name} onChange={(e) => set("name", e.target.value)} className="input-base" placeholder="e.g. PAN required at onboarding" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="For"><select value={f.subjectType} onChange={(e) => set("subjectType", e.target.value)} className="input-base"><option value="lead">Leads</option><option value="investor">Clients</option></select></Field>
        <Field label="Field key"><input value={f.field} onChange={(e) => set("field", e.target.value)} className="input-base" placeholder="phone / email / pan" /></Field>
        <Field label="Rule"><select value={f.operator} onChange={(e) => set("operator", e.target.value)} className="input-base"><option value="required">required</option><option value="is_email">is email</option><option value="is_phone">is phone</option><option value="is_pan">is PAN</option><option value="min_length">min length</option><option value="regex">regex</option></select></Field>
        <Field label="Value (min/regex)"><input value={f.value} onChange={(e) => set("value", e.target.value)} className="input-base" /></Field>
        <Field label="Severity"><select value={f.severity} onChange={(e) => set("severity", e.target.value)} className="input-base"><option value="block">block</option><option value="warn">warn</option></select></Field>
        <Field label="Only at stage (optional)"><input value={f.whenStage} onChange={(e) => set("whenStage", e.target.value)} className="input-base" placeholder="onboarding" /></Field>
      </div>
      <Field label="Error message"><input value={f.errorMessage} onChange={(e) => set("errorMessage", e.target.value)} className="input-base" placeholder="PAN is required before onboarding." /></Field>
      {err && <div className="text-sm text-rose-600">{err}</div>}
    </Drawer>
  );
}

function CadenceDrawer({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(""); const [subjectType, setSubjectType] = useState("lead");
  const [steps, setSteps] = useState<Array<{ dayOffset: number; action: string; title: string }>>([{ dayOffset: 0, action: "log_touch", title: "" }]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const update = (i: number, patch: any) => setSteps((s) => s.map((st, j) => j === i ? { ...st, ...patch } : st));
  function save() {
    if (name.length < 2 || steps.some((s) => !s.title)) { setErr("Name + step titles required."); return; }
    post("/api/cadences", { name, subjectType, steps }, () => { onClose(); router.refresh(); }, setBusy, setErr);
  }
  return (
    <Drawer title="New cadence" onClose={onClose} onSave={save} busy={busy}>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className="input-base" placeholder="e.g. New-lead 5-day nurture" /></Field>
      <Field label="For"><select value={subjectType} onChange={(e) => setSubjectType(e.target.value)} className="input-base"><option value="lead">Leads</option><option value="investor">Clients</option></select></Field>
      <div className="space-y-2">
        <div className="text-[11px] text-muted-foreground">Steps</div>
        {steps.map((st, i) => (
          <div key={i} className="flex items-center gap-2">
            <input type="number" value={st.dayOffset} onChange={(e) => update(i, { dayOffset: Number(e.target.value) })} className="input-base text-xs w-20" title="day" />
            <select value={st.action} onChange={(e) => update(i, { action: e.target.value })} className="input-base text-xs w-28"><option value="log_touch">Log touch</option><option value="task">Task</option><option value="reminder">Reminder</option></select>
            <input value={st.title} onChange={(e) => update(i, { title: e.target.value })} placeholder="Step title" className="input-base text-xs flex-1" />
            <button onClick={() => setSteps((s) => s.filter((_, j) => j !== i))} className="text-rose-500"><Trash2 className="size-3.5" /></button>
          </div>
        ))}
        <button onClick={() => setSteps((s) => [...s, { dayOffset: 0, action: "log_touch", title: "" }])} className="btn-ghost text-xs"><Plus className="size-3.5" /> Add step</button>
      </div>
      {err && <div className="text-sm text-rose-600">{err}</div>}
    </Drawer>
  );
}
