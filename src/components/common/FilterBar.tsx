"use client";

/**
 * Zoho-CRM-style filter bar — generic, drop-in for any list page.
 *
 * Renders a horizontal strip with:
 *   - Search input (full-text, free-form)
 *   - Multi-select chip filters (status, owner, source, segment …)
 *   - Single-select dropdowns (when needed)
 *   - Date-range pickers (created, due, etc.)
 *   - "Clear" button when any filter is active
 *
 * All state is encoded into URL search params so the SSR'd list page can
 * read them and apply WHERE clauses. URLs are shareable / bookmarkable.
 *
 * Designed to pair with <CustomViews> which saves filter combos by name.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, X, ChevronDown, Filter as FilterIcon, Loader2, ArrowDownUp } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { DateRangePicker } from "@/components/ui/DateRangePicker";

export type FilterDef =
  | { type: "search"; key: string; placeholder?: string }
  | { type: "select"; key: string; label: string; options: { value: string; label: string }[]; allLabel?: string }
  | { type: "multi"; key: string; label: string; options: { value: string; label: string }[] }
  // A sort control — like select, but options are directional (asc/desc) and there
  // is no empty "All" entry (a list is always sorted by *something*).
  | { type: "sort"; key: string; label: string; options: { value: string; label: string }[] }
  | { type: "date_range"; key: string; label: string };

export function FilterBar({
  filters,
  totalCount,
  rightSlot,
  leftSlot,
}: {
  filters: FilterDef[];
  /** Show "Showing N of M" — pass the count returned by the SSR'd query. */
  totalCount?: number;
  /** Optional slot for "Custom views" or other right-aligned controls. */
  rightSlot?: React.ReactNode;
  /** Optional slot rendered at the START of the row (e.g. a client typeahead). */
  leftSlot?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [busy, setBusy] = useState(false);

  // Read current values from the URL
  const values = useMemo(() => {
    const out: Record<string, any> = {};
    for (const f of filters) {
      if (f.type === "multi") {
        const v = sp.get(f.key);
        out[f.key] = v ? v.split(",").filter(Boolean) : [];
      } else if (f.type === "date_range") {
        out[`${f.key}_from`] = sp.get(`${f.key}_from`) ?? "";
        out[`${f.key}_to`] = sp.get(`${f.key}_to`) ?? "";
      } else {
        out[f.key] = sp.get(f.key) ?? "";
      }
    }
    return out;
  }, [sp, filters]);

  function pushParams(next: Record<string, any>) {
    setBusy(true);
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) {
        params.delete(k);
      } else if (Array.isArray(v)) {
        params.set(k, v.join(","));
      } else {
        params.set(k, String(v));
      }
    }
    // Any filter/search change resets paging — otherwise you can land on an
    // out-of-range page of a now-smaller result set and see nothing.
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
    // Keep "busy" on until route transition completes — Next.js refresh hooks
    // would expose this cleanly; for now a short timer is fine.
    setTimeout(() => setBusy(false), 600);
  }

  const activeCount = filters.reduce((n, f) => {
    if (f.type === "sort") return n; // sort isn't a "filter" — never counts / never cleared
    if (f.type === "multi") return n + ((values[f.key] as string[]).length > 0 ? 1 : 0);
    if (f.type === "date_range")
      return n + (values[`${f.key}_from`] || values[`${f.key}_to`] ? 1 : 0);
    return n + (values[f.key] ? 1 : 0);
  }, 0);

  function clearAll() {
    pushParams(
      filters.reduce((acc, f) => {
        if (f.type === "sort") return acc; // leave the sort order alone
        if (f.type === "multi") acc[f.key] = [];
        else if (f.type === "date_range") {
          acc[`${f.key}_from`] = "";
          acc[`${f.key}_to`] = "";
        } else acc[f.key] = "";
        return acc;
      }, {} as Record<string, any>)
    );
  }

  const searchFilter = filters.find((f) => f.type === "search") as
    | { type: "search"; key: string; placeholder?: string }
    | undefined;
  const otherFilters = filters.filter((f) => f.type !== "search");

  // `relative z-30` on the root gives the toolbar its own stacking context that
  // sits ABOVE the results table below it — otherwise the table (a later sibling
  // in the DOM) paints over any open filter / "View" dropdown, making the
  // dropdown look transparent / cut off.
  return (
    <div className="card-surface p-3 space-y-2 relative z-30">
      <div className="flex items-center gap-2 flex-wrap">
        {leftSlot}
        {searchFilter && (
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <SearchInput
              initial={values[searchFilter.key] ?? ""}
              placeholder={searchFilter.placeholder ?? "Search…"}
              onSubmit={(v) => pushParams({ [searchFilter.key]: v })}
            />
          </div>
        )}

        {otherFilters.map((f) =>
          f.type === "multi" ? (
            <MultiSelectChip
              key={f.key}
              label={f.label}
              options={f.options}
              value={values[f.key] as string[]}
              onChange={(v) => pushParams({ [f.key]: v })}
            />
          ) : f.type === "select" ? (
            <div key={f.key} className="inline-flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">{f.label}</span>
              <Select
                size="sm"
                value={values[f.key] as string}
                onChange={(v) => pushParams({ [f.key]: v })}
                options={[{ value: "", label: f.allLabel ?? "All" }, ...f.options]}
                placeholder={f.allLabel ?? "All"}
                ariaLabel={f.label}
                className="min-w-[7rem]"
              />
            </div>
          ) : f.type === "sort" ? (
            // Sort control: the directional glyph sits INSIDE the trigger and the
            // redundant "Sort" word is dropped — the options ("Newest first" …)
            // already say what's being ordered.
            <Select
              key={f.key}
              size="sm"
              leadingIcon={<ArrowDownUp className="size-3.5 text-muted-foreground" />}
              value={(values[f.key] as string) || f.options[0]?.value || ""}
              onChange={(v) => pushParams({ [f.key]: v })}
              options={f.options}
              ariaLabel={f.label}
              className="min-w-[9.5rem]"
            />
          ) : f.type === "date_range" ? (
            <DateRangePicker
              key={f.key}
              label={f.label}
              from={values[`${f.key}_from`] as string}
              to={values[`${f.key}_to`] as string}
              onChange={(from, to) =>
                pushParams({ [`${f.key}_from`]: from, [`${f.key}_to`]: to })
              }
            />
          ) : null
        )}

        {activeCount > 0 && (
          <button
            onClick={clearAll}
            className="btn-ghost text-xs text-muted-foreground hover:text-rose-600"
          >
            <X className="size-3" /> Clear ({activeCount})
          </button>
        )}

        <div className="flex-1" />

        {busy && <Loader2 className="size-3.5 animate-spin text-brand-cyan" />}
        {totalCount != null && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {totalCount.toLocaleString("en-IN")} result{totalCount === 1 ? "" : "s"}
          </span>
        )}
        {rightSlot}
      </div>
    </div>
  );
}

/* ─────────────────── Sub-components ─────────────────── */

function SearchInput({
  initial,
  placeholder,
  onSubmit,
}: {
  initial: string;
  placeholder: string;
  onSubmit: (v: string) => void;
}) {
  const [v, setV] = useState(initial);
  // `dirty` distinguishes a user keystroke from the URL-driven `initial` sync,
  // so we only push for what the user actually typed.
  const dirty = useRef(false);
  useEffect(() => {
    setV(initial);
    dirty.current = false;
  }, [initial]);
  // Live search: debounce-push ~300ms after the user stops typing. Enter still
  // submits immediately (the form onSubmit).
  useEffect(() => {
    if (!dirty.current || v === initial) return;
    const t = setTimeout(() => onSubmit(v), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
    >
      <input
        value={v}
        onChange={(e) => {
          dirty.current = true;
          setV(e.target.value);
        }}
        placeholder={placeholder}
        className="input-base pl-9 text-xs h-8"
      />
    </form>
  );
}

function MultiSelectChip({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (el && typeof window !== "undefined") {
      const rect = el.getBoundingClientRect();
      setAlignRight(window.innerWidth - rect.left < 240); // popup ~200px + margin
    }
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const active = value.length > 0;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 h-8 text-xs font-medium transition ${
          active
            ? "bg-brand-cyan-light/40 border-brand-cyan/40 text-brand-cyan-deep"
            : "bg-card border-border hover:bg-brand-cyan-light/40"
        }`}
      >
        <FilterIcon className="size-3" />
        <span>{label}</span>
        {active && (
          <span className="bg-brand-cyan text-white rounded-full px-1.5 text-[10px] font-bold tabular-nums">
            {value.length}
          </span>
        )}
        <ChevronDown className="size-3 opacity-60" />
      </button>
      {open && (
        <div className={`absolute top-full ${alignRight ? "right-0" : "left-0"} mt-1 z-50 card-elevated bg-card p-1.5 min-w-[200px] max-h-64 overflow-y-auto scrollbar-thin`}>
          {options.length === 0 ? (
            <div className="text-[11px] text-muted-foreground p-2">No options</div>
          ) : (
            <ul className="space-y-0.5">
              {options.map((o) => {
                const checked = value.includes(o.value);
                return (
                  <li key={o.value}>
                    <label className={`flex items-center gap-2 px-2 py-1.5 text-xs rounded cursor-pointer transition ${checked ? "bg-brand-cyan-light/40 text-brand-cyan-deep font-medium" : "hover:bg-brand-cyan-light/40"}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = checked
                            ? value.filter((v) => v !== o.value)
                            : [...value, o.value];
                          onChange(next);
                        }}
                        className="size-3.5 rounded border-border accent-brand-cyan focus:ring-brand-cyan"
                      />
                      <span className="capitalize">{o.label}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* SingleSelect + DateRange now live in src/components/ui/{Select,DateRangePicker}. */
