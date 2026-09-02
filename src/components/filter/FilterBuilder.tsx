"use client";

/**
 * Self-contained visual Filter-AST builder (AND/OR groups + typed predicates),
 * driven entirely by the field catalog. Used by the custom report builder; the
 * segment builder keeps its own inline copy so this can evolve independently.
 */
import { Plus, X } from "lucide-react";
import { CATALOGS, type FieldDef, type SubjectCatalog } from "@/lib/filter/catalog";
import type { FilterOperator } from "@/lib/filter/ast";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";

type Group = { type: "group"; op: "AND" | "OR"; not?: boolean; children: Node[] };
type Predicate = { type: "predicate"; field: { kind: "attr"; path: string }; op: FilterOperator; value?: unknown; duration?: { amount: number; unit: string } };
type Node = Group | Predicate;

const OP_LABELS: Partial<Record<FilterOperator, string>> = {
  eq: "is", ne: "is not", gt: ">", gte: "≥", lt: "<", lte: "≤",
  contains: "contains", not_contains: "doesn't contain", starts_with: "starts with", ends_with: "ends with", matches: "matches regex",
  in: "is any of", not_in: "is none of", between: "between", not_between: "not between",
  is_empty: "is empty", is_not_empty: "is not empty", is_null: "is blank", is_not_null: "is set",
  is_true: "is true", is_false: "is false",
  date_within: "within last", date_in_last: "in last", date_in_next: "in next",
  date_before: "before", date_after: "after", date_today: "is today", date_yesterday: "was yesterday",
  date_tomorrow: "is tomorrow", date_is_anniversary: "is anniversary today",
};

const NO_VALUE_OPS = new Set<FilterOperator>(["is_empty", "is_not_empty", "is_null", "is_not_null", "is_true", "is_false", "date_today", "date_yesterday", "date_tomorrow", "date_is_anniversary"]);
const DURATION_OPS = new Set<FilterOperator>(["date_within", "date_in_last", "date_in_next"]);
const TWO_VALUE_OPS = new Set<FilterOperator>(["between", "not_between"]);
const LIST_OPS = new Set<FilterOperator>(["in", "not_in"]);

export function FilterBuilder({ subject, value, onChange }: { subject: string; value: Group; onChange: (g: Group) => void }) {
  const cat = CATALOGS[subject] ?? CATALOGS.investor;
  return <GroupEditor cat={cat} group={value} onChange={onChange} depth={0} />;
}

function GroupEditor({ cat, group, onChange, depth }: { cat: SubjectCatalog; group: Group; onChange: (g: Group) => void; depth: number }) {
  const setChild = (i: number, n: Node | null) => {
    const children = group.children.slice();
    if (n === null) children.splice(i, 1);
    else children[i] = n;
    onChange({ ...group, children });
  };
  const firstField = cat.fields[0];

  return (
    <div className={`rounded-xl border border-border ${depth === 0 ? "bg-secondary/20" : "bg-card"} p-3 space-y-2`}>
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-xs font-semibold">
          {(["AND", "OR"] as const).map((op) => (
            <button
              key={op}
              type="button"
              onClick={() => onChange({ ...group, op })}
              className={`px-2.5 py-1 rounded-md transition-colors ${group.op === op ? "bg-brand-navy text-white" : "text-muted-foreground hover:text-foreground"}`}
            >
              {op}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-muted-foreground">
          {group.op === "AND" ? "all of these match" : "any of these match"}
        </span>
      </div>

      <div className="space-y-2 pl-1">
        {group.children.map((child, i) =>
          child.type === "group" ? (
            <div key={i} className="relative">
              <GroupEditor cat={cat} group={child} onChange={(g) => setChild(i, g)} depth={depth + 1} />
              <button type="button" onClick={() => setChild(i, null)} className="absolute -top-2 -right-2 size-5 rounded-full bg-card border border-border grid place-items-center hover:bg-rose-50 hover:text-rose-600" aria-label="Remove group">
                <X className="size-3" />
              </button>
            </div>
          ) : (
            <PredicateEditor key={i} cat={cat} predicate={child} onChange={(p) => setChild(i, p)} onRemove={() => setChild(i, null)} />
          )
        )}
        {group.children.length === 0 && <div className="text-[11px] text-muted-foreground italic px-1">No conditions — matches everything.</div>}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() =>
            onChange({ ...group, children: [...group.children, { type: "predicate", field: { kind: "attr", path: firstField.key }, op: firstField.ops[0] }] })
          }
          className="text-xs inline-flex items-center gap-1 text-brand-cyan-deep hover:underline font-medium"
        >
          <Plus className="size-3" /> Add condition
        </button>
        {depth < 2 && (
          <button
            type="button"
            onClick={() => onChange({ ...group, children: [...group.children, { type: "group", op: "AND", children: [] }] })}
            className="text-xs inline-flex items-center gap-1 text-muted-foreground hover:text-foreground font-medium"
          >
            <Plus className="size-3" /> Add group
          </button>
        )}
      </div>
    </div>
  );
}

function PredicateEditor({ cat, predicate, onChange, onRemove }: { cat: SubjectCatalog; predicate: Predicate; onChange: (p: Predicate) => void; onRemove: () => void }) {
  const field = cat.fields.find((f) => f.key === predicate.field.path) ?? cat.fields[0];
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5">
      <SelectField
        value={field.key}
        onChange={(e) => {
          const nf = cat.fields.find((f) => f.key === e.target.value)!;
          onChange({ type: "predicate", field: { kind: "attr", path: nf.key }, op: nf.ops[0] });
        }}
        size="sm"
        className="max-w-[180px] shrink-0"
      >
        {cat.fields.map((f) => (
          <option key={f.key} value={f.key}>{f.label}</option>
        ))}
      </SelectField>

      <SelectField
        value={predicate.op}
        onChange={(e) => onChange({ ...predicate, op: e.target.value as FilterOperator, value: undefined, duration: undefined })}
        size="sm"
        className="shrink-0"
      >
        {field.ops.map((op) => (
          <option key={op} value={op}>{OP_LABELS[op] ?? op}</option>
        ))}
      </SelectField>

      <ValueInput field={field} predicate={predicate} onChange={onChange} />

      <button type="button" onClick={onRemove} className="ml-auto text-muted-foreground hover:text-rose-600" aria-label="Remove condition">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function ValueInput({ field, predicate, onChange }: { field: FieldDef; predicate: Predicate; onChange: (p: Predicate) => void }) {
  const op = predicate.op;
  if (NO_VALUE_OPS.has(op)) return null;

  const cls = "text-xs rounded-md border border-border bg-card px-2 py-1";
  const set = (value: unknown) => onChange({ ...predicate, value });

  const isDate = field.type === "date" || field.type === "datetime";

  if (DURATION_OPS.has(op)) {
    const d = predicate.duration ?? { amount: 7, unit: "day" };
    return (
      <span className="flex items-center gap-1">
        <input type="number" value={d.amount} onChange={(e) => onChange({ ...predicate, duration: { ...d, amount: Number(e.target.value) || 0 } })} className={`${cls} w-16`} />
        <SelectField value={d.unit} onChange={(e) => onChange({ ...predicate, duration: { ...d, unit: e.target.value } })} size="sm" className="shrink-0">
          {["day", "week", "month", "year"].map((u) => <option key={u} value={u}>{u}s</option>)}
        </SelectField>
      </span>
    );
  }

  if (TWO_VALUE_OPS.has(op)) {
    const arr = Array.isArray(predicate.value) ? predicate.value : ["", ""];
    if (isDate) {
      return (
        <span className="flex items-center gap-1">
          <DateField value={String(arr[0] ?? "")} onChange={(e) => set([e.target.value, arr[1]])} size="sm" className="w-32" />
          <span className="text-[11px] text-muted-foreground">and</span>
          <DateField value={String(arr[1] ?? "")} onChange={(e) => set([arr[0], e.target.value])} size="sm" className="w-32" />
        </span>
      );
    }
    const it = field.type === "number" || field.type === "integer" || field.type === "currency" ? "number" : "text";
    return (
      <span className="flex items-center gap-1">
        <input type={it} value={String(arr[0] ?? "")} onChange={(e) => set([e.target.value, arr[1]])} className={`${cls} w-28`} />
        <span className="text-[11px] text-muted-foreground">and</span>
        <input type={it} value={String(arr[1] ?? "")} onChange={(e) => set([arr[0], e.target.value])} className={`${cls} w-28`} />
      </span>
    );
  }

  if (LIST_OPS.has(op)) {
    const val = Array.isArray(predicate.value) ? predicate.value.join(", ") : "";
    return <input value={val} onChange={(e) => set(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} placeholder="a, b, c" className={`${cls} min-w-[160px]`} />;
  }

  if (field.type === "enum" && field.enumValues?.length) {
    return (
      <SelectField value={String(predicate.value ?? "")} onChange={(e) => set(e.target.value)} size="sm" className="shrink-0">
        <option value="">Select…</option>
        {field.enumValues.map((v) => <option key={v} value={v}>{v}</option>)}
      </SelectField>
    );
  }

  if (isDate) {
    return <DateField value={String(predicate.value ?? "")} onChange={(e) => set(e.target.value)} size="sm" className="w-40" />;
  }
  const inputType = field.type === "number" || field.type === "integer" || field.type === "currency" ? "number" : "text";
  return <input type={inputType} value={String(predicate.value ?? "")} onChange={(e) => set(e.target.value)} placeholder="value" className={`${cls} min-w-[140px]`} />;
}
