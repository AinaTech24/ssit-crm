"use client";

/**
 * CompactFilterBar — one clean row: a search box + a single "Filters" button
 * whose dropdown holds every filter as a collapsible sub-section (multi-select
 * or date range). Replaces a long strip of individual filter chips.
 *
 * All state lives in URL search params, so the SSR'd page reads them and the
 * URL stays shareable — same contract as the older FilterBar.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, X, ChevronDown, ChevronRight, SlidersHorizontal, Loader2, ArrowDownUp, Check } from "lucide-react";

/**
 * Accepts the full legacy `FilterDef` union so any page still on the old
 * <FilterBar> can move to this one by swapping the import — `search` becomes the
 * search box, `sort` becomes the icon-only sort dropdown, and select/multi/
 * date_range become sections inside the single Filters dropdown.
 */
export type CompactFilter =
  | { type: "search"; key: string; placeholder?: string }
  | { type: "select"; key: string; label: string; options: { value: string; label: string }[]; allLabel?: string }
  | { type: "multi"; key: string; label: string; options: { value: string; label: string }[] }
  | { type: "sort"; key: string; label: string; options: { value: string; label: string }[] }
  | { type: "date_range"; key: string; label: string }
  /** A set of INDEPENDENT boolean params (?mine=1&no_rm=1…), each with its
   *  own URL key — what a "quick filters" chip strip really is. */
  | {
      type: "flags";
      label: string;
      options: { key: string; label: string; count?: number }[];
    };

export function CompactFilterBar({
  searchKey: searchKeyProp,
  searchPlaceholder: searchPlaceholderProp,
  filters: allFilters,
  sort: sortProp,
  totalCount,
  rightSlot,
  leftSlot,
  bare = false,
}: {
  searchKey?: string;
  searchPlaceholder?: string;
  filters: CompactFilter[];
  /** Optional sort control rendered inline (a list is always sorted by something). */
  sort?: { key: string; options: { value: string; label: string }[] };
  totalCount?: number;
  rightSlot?: React.ReactNode;
  /** Slot rendered at the START of the row (parity with the legacy FilterBar). */
  leftSlot?: React.ReactNode;
  /** Render without the card wrapper (e.g. embedded inside a table header). */
  bare?: boolean;
}) {
  // Split the incoming defs: search + sort get their own controls, the rest are
  // sections inside the Filters dropdown.
  const searchDef = allFilters.find((f) => f.type === "search") as Extract<CompactFilter, { type: "search" }> | undefined;
  const sortDef = allFilters.find((f) => f.type === "sort") as Extract<CompactFilter, { type: "sort" }> | undefined;
  const filters = allFilters.filter(
    (f) => f.type === "multi" || f.type === "select" || f.type === "date_range" || f.type === "flags"
  ) as Array<Extract<CompactFilter, { type: "multi" | "select" | "date_range" | "flags" }>>;
  const searchKey = searchKeyProp ?? searchDef?.key ?? "q";
  const searchPlaceholder = searchPlaceholderProp ?? searchDef?.placeholder ?? "Search…";
  const sort = sortProp ?? (sortDef ? { key: sortDef.key, options: sortDef.options } : undefined);
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  const values = useMemo(() => {
    const out: Record<string, any> = {};
    for (const f of allFilters) {
      if (f.type === "multi") {
        const v = sp.get(f.key);
        out[f.key] = v ? v.split(",").filter(Boolean) : [];
      } else if (f.type === "select") {
        out[f.key] = sp.get(f.key) ?? "";
      } else if (f.type === "date_range") {
        out[`${f.key}_from`] = sp.get(`${f.key}_from`) ?? "";
        out[`${f.key}_to`] = sp.get(`${f.key}_to`) ?? "";
      } else if (f.type === "flags") {
        for (const o of f.options) out[o.key] = sp.get(o.key) === "1";
      }
    }
    return out;
  }, [sp, allFilters]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!sortOpen) return;
    function onDown(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [sortOpen]);

  function pushParams(next: Record<string, any>) {
    setBusy(true);
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) params.delete(k);
      else if (Array.isArray(v)) params.set(k, v.join(","));
      else params.set(k, String(v));
    }
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
    setTimeout(() => setBusy(false), 600);
  }

  /** How many distinct filters are active (search excluded). */
  const activeCount = filters.reduce((n, f) => {
    if (f.type === "flags") return n + f.options.filter((o) => values[o.key]).length;
    if (f.type === "multi") return n + ((values[f.key] as string[]).length > 0 ? 1 : 0);
    if (f.type === "select") return n + (values[f.key] ? 1 : 0);
    return n + (values[`${f.key}_from`] || values[`${f.key}_to`] ? 1 : 0);
  }, 0);

  function clearAll() {
    const next: Record<string, any> = {};
    for (const f of filters) {
      if (f.type === "flags") for (const o of f.options) next[o.key] = "";
      else if (f.type === "multi") next[f.key] = [];
      else if (f.type === "select") next[f.key] = "";
      else {
        next[`${f.key}_from`] = "";
        next[`${f.key}_to`] = "";
      }
    }
    pushParams(next);
  }

  /** Short summary of a section's active selection, shown on its collapsed row. */
  function summaryFor(f: (typeof filters)[number]): string {
    if (f.type === "flags") {
      const on = f.options.filter((o) => values[o.key]);
      if (!on.length) return "";
      return on.length === 1 ? on[0].label : `${on.length} selected`;
    }
    if (f.type === "multi") {
      const v = values[f.key] as string[];
      if (!v.length) return "";
      const labels = v.map((x) => f.options.find((o) => o.value === x)?.label ?? x);
      return labels.length <= 2 ? labels.join(", ") : `${labels.length} selected`;
    }
    if (f.type === "select") {
      const v = values[f.key] as string;
      return v ? f.options.find((o) => o.value === v)?.label ?? v : "";
    }
    const from = values[`${f.key}_from`];
    const to = values[`${f.key}_to`];
    if (!from && !to) return "";
    return `${from || "…"} → ${to || "…"}`;
  }

  return (
    <div className={bare ? "relative z-30 w-full" : "card-surface p-2.5 relative z-30"}>
      <div className="flex items-center gap-2 flex-wrap">
        {leftSlot}
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <SearchInput
            initial={sp.get(searchKey) ?? ""}
            placeholder={searchPlaceholder}
            onSubmit={(v) => pushParams({ [searchKey]: v })}
          />
        </div>

        {/* Push the filter / sort / view controls to the right, grouped. */}
        <div className="flex-1" />

        {/* Single Filters dropdown — hidden when there are no filters to show,
            otherwise the button opens an empty panel (search-only callers). */}
        <div className={`relative ${filters.length === 0 ? "hidden" : ""}`} ref={panelRef}>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            title="Filters"
            aria-label="Filters"
            className={`relative inline-flex items-center justify-center rounded-lg border size-8 transition ${
              activeCount > 0
                ? "bg-brand-cyan-light/40 border-brand-cyan/40 text-brand-cyan-deep"
                : "bg-card border-border hover:bg-brand-cyan-light/40"
            }`}
          >
            <SlidersHorizontal className="size-4" />
            {activeCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-brand-cyan text-white rounded-full min-w-[15px] h-[15px] px-1 text-[9px] font-bold tabular-nums flex items-center justify-center">{activeCount}</span>
            )}
          </button>

          {open && (
            <div className="absolute right-0 top-full mt-1 z-50 w-[300px] card-elevated bg-card p-1.5">
              <div className="max-h-[60vh] overflow-y-auto scrollbar-thin">
                {filters.map((f) => {
                  // A flags section owns several URL keys, so it is identified
                  // by its label rather than a single key.
                  const sectionId = f.type === "flags" ? `flags:${f.label}` : f.key;
                  const isOpen = openSection === sectionId;
                  const summary = summaryFor(f);
                  return (
                    <div key={sectionId} className="border-b border-slate-100 last:border-0">
                      <button
                        type="button"
                        onClick={() => setOpenSection(isOpen ? null : sectionId)}
                        className="w-full flex items-center gap-1.5 px-2 py-2 text-xs hover:bg-secondary/60 rounded"
                      >
                        {isOpen ? <ChevronDown className="size-3 opacity-60" /> : <ChevronRight className="size-3 opacity-60" />}
                        <span className="font-medium">{f.label}</span>
                        {summary && <span className="ml-auto text-[10px] text-brand-cyan-deep truncate max-w-[120px]">{summary}</span>}
                      </button>

                      {isOpen && (
                        <div className="px-2 pb-2 pt-0.5">
                          {f.type === "flags" ? (
                            <ul className="space-y-0.5 max-h-60 overflow-y-auto scrollbar-thin">
                              {f.options.map((o) => {
                                const checked = !!values[o.key];
                                return (
                                  <li key={o.key}>
                                    <label
                                      className={`flex items-center gap-2 px-2 py-1.5 text-xs rounded cursor-pointer transition ${
                                        checked ? "bg-brand-cyan-light/40 text-brand-cyan-deep font-medium" : "hover:bg-secondary/60"
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => pushParams({ [o.key]: checked ? "" : "1" })}
                                        className="size-3.5 rounded border-border accent-brand-cyan"
                                      />
                                      <span className="truncate">{o.label}</span>
                                      {typeof o.count === "number" && (
                                        <span className="ml-auto tabular-nums text-[10px] text-muted-foreground">{o.count}</span>
                                      )}
                                    </label>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : f.type === "multi" ? (
                            <ul className="space-y-0.5 max-h-52 overflow-y-auto scrollbar-thin">
                              {f.options.length === 0 && <li className="text-[11px] text-muted-foreground px-1 py-1">No options</li>}
                              {f.options.map((o) => {
                                const cur = values[f.key] as string[];
                                const checked = cur.includes(o.value);
                                return (
                                  <li key={o.value}>
                                    <label
                                      className={`flex items-center gap-2 px-2 py-1.5 text-xs rounded cursor-pointer transition ${
                                        checked ? "bg-brand-cyan-light/40 text-brand-cyan-deep font-medium" : "hover:bg-secondary/60"
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() =>
                                          pushParams({ [f.key]: checked ? cur.filter((v) => v !== o.value) : [...cur, o.value] })
                                        }
                                        className="size-3.5 rounded border-border accent-brand-cyan"
                                      />
                                      <span className="capitalize truncate">{o.label}</span>
                                    </label>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : f.type === "select" ? (
                            <ul className="space-y-0.5 max-h-52 overflow-y-auto scrollbar-thin">
                              <li>
                                <button
                                  type="button"
                                  onClick={() => pushParams({ [f.key]: "" })}
                                  className={`w-full text-left flex items-center gap-2 px-2 py-1.5 text-xs rounded transition ${
                                    !values[f.key] ? "bg-brand-cyan-light/40 text-brand-cyan-deep font-medium" : "hover:bg-secondary/60"
                                  }`}
                                >
                                  {!values[f.key] ? <Check className="size-3.5 shrink-0" /> : <span className="size-3.5 shrink-0" />}
                                  {f.allLabel ?? `All ${f.label.toLowerCase()}`}
                                </button>
                              </li>
                              {f.options.map((o) => {
                                const checked = values[f.key] === o.value;
                                return (
                                  <li key={o.value}>
                                    <button
                                      type="button"
                                      onClick={() => pushParams({ [f.key]: checked ? "" : o.value })}
                                      className={`w-full text-left flex items-center gap-2 px-2 py-1.5 text-xs rounded transition ${
                                        checked ? "bg-brand-cyan-light/40 text-brand-cyan-deep font-medium" : "hover:bg-secondary/60"
                                      }`}
                                    >
                                      {checked ? <Check className="size-3.5 shrink-0" /> : <span className="size-3.5 shrink-0" />}
                                      <span className="capitalize truncate">{o.label}</span>
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="date"
                                value={values[`${f.key}_from`]}
                                onChange={(e) => pushParams({ [`${f.key}_from`]: e.target.value })}
                                className="input-base h-7 text-[11px] flex-1"
                                aria-label={`${f.label} from`}
                              />
                              <span className="text-slate-400 text-xs">→</span>
                              <input
                                type="date"
                                value={values[`${f.key}_to`]}
                                onChange={(e) => pushParams({ [`${f.key}_to`]: e.target.value })}
                                className="input-base h-7 text-[11px] flex-1"
                                aria-label={`${f.label} to`}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {activeCount > 0 && (
                <div className="border-t border-slate-100 pt-1.5 mt-1">
                  <button onClick={clearAll} className="w-full text-xs text-rose-600 hover:bg-rose-50 rounded py-1.5 font-medium">
                    Clear all filters
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {sort && (
          <div className="relative" ref={sortRef}>
            <button
              type="button"
              onClick={() => setSortOpen((o) => !o)}
              title="Sort"
              aria-label="Sort"
              className={`inline-flex items-center justify-center rounded-lg border size-8 transition ${
                sp.get(sort.key)
                  ? "bg-brand-cyan-light/40 border-brand-cyan/40 text-brand-cyan-deep"
                  : "bg-card border-border hover:bg-brand-cyan-light/40"
              }`}
            >
              <ArrowDownUp className="size-4" />
            </button>
            {sortOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 w-52 card-elevated bg-card p-1 animate-scale-in">
                <div className="px-2 py-1 text-[10px] uppercase font-bold tracking-wide text-muted-foreground">Sort by</div>
                {sort.options.map((o) => {
                  const active = o.value === (sp.get(sort.key) || sort.options[0]?.value || "");
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => { pushParams({ [sort.key]: o.value }); setSortOpen(false); }}
                      className={`w-full text-left flex items-center gap-2 rounded px-2 py-1.5 text-xs transition ${
                        active ? "bg-brand-cyan-light/50 text-brand-cyan-deep font-semibold" : "hover:bg-secondary/60"
                      }`}
                    >
                      {active ? <Check className="size-3.5 shrink-0" /> : <span className="size-3.5 shrink-0" />}
                      {o.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeCount > 0 && (
          <button onClick={clearAll} className="btn-ghost text-xs text-muted-foreground hover:text-rose-600">
            <X className="size-3" /> Clear
          </button>
        )}

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

function SearchInput({ initial, placeholder, onSubmit }: { initial: string; placeholder: string; onSubmit: (v: string) => void }) {
  const [v, setV] = useState(initial);
  const dirty = useRef(false);
  useEffect(() => {
    setV(initial);
    dirty.current = false;
  }, [initial]);
  useEffect(() => {
    if (!dirty.current || v === initial) return;
    const t = setTimeout(() => onSubmit(v), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(v); }}>
      <input
        value={v}
        onChange={(e) => { dirty.current = true; setV(e.target.value); }}
        placeholder={placeholder}
        className="input-base pl-9 text-xs h-8"
      />
    </form>
  );
}
