"use client";

/**
 * Editor for the firm's onboarding field required/optional overrides.
 *
 * Renders every distinct KYC field grouped by section, each with a toggle that
 * flips required ↔ optional. The effective required value starts from the saved
 * override (if any) else the catalog default. Save PUTs the full state map; the
 * API sanitises + upserts. Reset returns every field to its catalog default.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, Save, Check } from "lucide-react";

type FieldRow = {
  key: string;
  label: string;
  section: string;
  required: boolean;
  backOffice: boolean;
};

export function OnboardingFieldsEditor({
  fields,
  overrides,
}: {
  fields: FieldRow[];
  overrides: Record<string, boolean>;
}) {
  const router = useRouter();

  // Effective "required" per field — override wins, else catalog default.
  const [state, setState] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const f of fields) init[f.key] = overrides[f.key] ?? f.required;
    return init;
  });
  const [busy, setBusy] = useState<null | "save" | "reset">(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Group fields by section, preserving catalog order.
  const sections = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, FieldRow[]>();
    for (const f of fields) {
      if (!map.has(f.section)) {
        map.set(f.section, []);
        order.push(f.section);
      }
      map.get(f.section)!.push(f);
    }
    return order.map((section) => ({ section, rows: map.get(section)! }));
  }, [fields]);

  const changedCount = useMemo(
    () => fields.filter((f) => state[f.key] !== f.required).length,
    [fields, state]
  );

  function toggle(key: string) {
    setState((p) => ({ ...p, [key]: !p[key] }));
    setOk(null);
  }

  async function persist(next: Record<string, boolean>, kind: "save" | "reset") {
    setBusy(kind);
    setErr(null);
    setOk(null);
    try {
      const res = await fetch("/api/settings/onboarding-fields", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ overrides: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to save");
      setState(next);
      setOk(kind === "reset" ? "Reset to defaults." : "Saved.");
      router.refresh();
    } catch (e: any) {
      setErr(e?.message || "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  function save() {
    void persist(state, "save");
  }

  function resetDefaults() {
    const defaults: Record<string, boolean> = {};
    for (const f of fields) defaults[f.key] = f.required;
    void persist(defaults, "reset");
  }

  return (
    <div className="space-y-5">
      {sections.map(({ section, rows }) => (
        <section key={section} className="card-surface p-5 space-y-3">
          <h2 className="font-semibold text-base">{section}</h2>
          <ul className="divide-y divide-border">
            {rows.map((f) => {
              const isRequired = state[f.key];
              const changed = isRequired !== f.required;
              return (
                <li
                  key={f.key}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium truncate">
                        {f.label}
                      </span>
                      {f.backOffice && (
                        <span className="chip text-[10px] bg-secondary text-muted-foreground">
                          back office
                        </span>
                      )}
                      {changed && (
                        <span
                          title="Changed from default"
                          className="inline-block size-1.5 rounded-full bg-amber-500"
                        />
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      default: {f.required ? "required" : "optional"}
                    </p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={isRequired}
                    aria-label={`${f.label} — ${isRequired ? "required" : "optional"}`}
                    onClick={() => toggle(f.key)}
                    className="flex items-center gap-2 flex-shrink-0"
                  >
                    <span
                      className={`text-[11px] font-medium w-14 text-right ${
                        isRequired ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {isRequired ? "Mandatory" : "Optional"}
                    </span>
                    <span
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        isRequired ? "bg-brand-cyan" : "bg-secondary"
                      }`}
                    >
                      <span
                        className={`inline-block size-4 transform rounded-full bg-white shadow transition-transform ${
                          isRequired ? "translate-x-4" : "translate-x-0.5"
                        }`}
                      />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {/* Footer actions */}
      <div className="sticky bottom-0 z-10 -mx-1 mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background/80 px-4 py-3 backdrop-blur">
        <button
          type="button"
          onClick={save}
          disabled={busy !== null}
          className="btn-primary inline-flex items-center gap-1.5"
        >
          {busy === "save" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Save changes
        </button>
        <button
          type="button"
          onClick={resetDefaults}
          disabled={busy !== null}
          className="btn-ghost inline-flex items-center gap-1.5"
        >
          {busy === "reset" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RotateCcw className="size-4" />
          )}
          Reset to defaults
        </button>

        <span className="text-xs text-muted-foreground">
          {changedCount > 0
            ? `${changedCount} field${changedCount === 1 ? "" : "s"} changed from default`
            : "All fields at default"}
        </span>

        {ok && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
            <Check className="size-3.5" /> {ok}
          </span>
        )}
        {err && (
          <span className="text-xs font-medium text-rose-600">{err}</span>
        )}
      </div>
    </div>
  );
}
