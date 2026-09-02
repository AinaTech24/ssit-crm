"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert, Save } from "lucide-react";
import { NAV_ACCESS_GROUPS, ALL_NAV_ITEMS } from "@/config/nav-access";
import { DASHBOARD_WIDGET_GROUPS, ALL_DASHBOARD_WIDGETS } from "@/config/dashboard-widgets";
import { FEATURE_FLAGS } from "@/config/feature-flags";

// All fields from catalog.ts grouped by subject
const AVAILABLE_FIELDS = {
  investor: [
    { key: "name", label: "Name" },
    { key: "pan", label: "PAN" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "city", label: "City" },
    { key: "state", label: "State" },
    { key: "pincode", label: "Pincode" },
    { key: "investor_category", label: "Category" },
    { key: "segment_tag", label: "Segment Tag" },
    { key: "status", label: "Status" },
    { key: "aum", label: "AUM (₹)" },
    { key: "active_sip_amount", label: "Active SIP (₹)" },
    { key: "lifetime_inflow", label: "Lifetime Inflow" },
    { key: "kyc_status", label: "KYC Status" },
    { key: "ckyc_expiry_at", label: "CKYC Expiry" },
    { key: "fatca_expiry_at", label: "FATCA Expiry" },
    { key: "risk_profile", label: "Risk Profile" },
    { key: "dob", label: "Date of Birth" },
    { key: "rm_id", label: "Relationship Manager" },
    { key: "branch_id", label: "Branch" },
  ],
  lead: [
    { key: "name", label: "Name" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "stage", label: "Stage" },
    { key: "source", label: "Source" },
    { key: "score", label: "Lead Score" },
    { key: "owner_id", label: "Owner" },
  ],
  task: [
    { key: "title", label: "Title" },
    { key: "type", label: "Type" },
    { key: "status", label: "Status" },
    { key: "priority", label: "Priority" },
    { key: "assignee_id", label: "Assignee" },
    { key: "due_at", label: "Due Date" },
  ],
  user: [
    { key: "name", label: "Name" },
    { key: "email", label: "Email" },
    { key: "status", label: "Status" },
    { key: "euin", label: "EUIN" },
    { key: "nism_expiry_at", label: "NISM Expiry" },
  ],
};

const ALL_NAV_KEYS = ALL_NAV_ITEMS.map((i) => i.key);
const ALL_WIDGET_KEYS = ALL_DASHBOARD_WIDGETS.map((w) => w.key);

/** Animated on/off switch — green when on, red when off. Presentational only;
 *  the wrapping element owns the click. */
function ToggleVisual({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ${
        on ? "bg-emerald-500" : "bg-rose-400"
      }`}
    >
      <span
        className={`inline-block size-4 rounded-full bg-white shadow transition-transform duration-200 ${
          on ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </span>
  );
}

export function TenantAccessControl({
  tenantId,
  initialAllowedNav,
  initialAllowedFields,
  initialAllowedDashboardWidgets,
  initialFeatureFlags = null,
  packageNavKeys = [],
}: {
  tenantId: string;
  initialAllowedNav: string[] | null;
  initialAllowedFields: string[] | null;
  initialAllowedDashboardWidgets: string[] | null;
  /** Per-tenant feature-flag override (subscriptions.feature_flags_override). */
  initialFeatureFlags?: Record<string, any> | null;
  /** Nav keys the firm's PACKAGE grants — the default selection when there's
   *  no per-tenant override (so the toggles reflect the plan, not "all"). */
  packageNavKeys?: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What the package grants (fall back to everything only if the package lists
  // nothing, so an empty plan doesn't render a blank, broken-looking list).
  const packageDefault = packageNavKeys.length > 0 ? packageNavKeys : ALL_NAV_KEYS;

  // null grant = the firm inherits the package default; when customizing we
  // start from the current override, else the PACKAGE's granted modules.
  const [nav, setNav] = useState<string[]>(initialAllowedNav || packageDefault);
  const [customNavActive, setCustomNavActive] = useState(!!initialAllowedNav);

  // If allowed fields is null, all fields are allowed. We keep track of the selected fields list.
  const [allowedFields, setAllowedFields] = useState<string[]>(initialAllowedFields || []);
  const [customFieldsActive, setCustomFieldsActive] = useState(!!initialAllowedFields);

  // Dashboard widgets: null grant = all widgets visible; an array = exactly those.
  const [widgets, setWidgets] = useState<string[]>(initialAllowedDashboardWidgets || ALL_WIDGET_KEYS);
  const [customWidgetsActive, setCustomWidgetsActive] = useState(!!initialAllowedDashboardWidgets);

  // Per-tenant feature-flag overrides. A key present = override; absent = inherit
  // the package's flag. setFlag(key, undefined) clears the override.
  const [flags, setFlags] = useState<Record<string, any>>(initialFeatureFlags ?? {});
  const setFlag = (key: string, val: any) => {
    setFlags((prev) => {
      const next = { ...prev };
      if (val === undefined) delete next[key];
      else next[key] = val;
      return next;
    });
    setSaved(false);
  };

  const toggleNav = (key: string) => {
    setNav((prev) => (prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]));
    setSaved(false);
  };

  const toggleWidget = (key: string) => {
    setWidgets((prev) => (prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]));
    setSaved(false);
  };

  const toggleField = (fqName: string) => {
    setAllowedFields((prev) => (prev.includes(fqName) ? prev.filter((f) => f !== fqName) : [...prev, fqName]));
    setSaved(false);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/super-admin/tenants/${tenantId}/access`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          allowedNav: customNavActive ? nav : null,
          allowedFields: customFieldsActive ? allowedFields : null,
          allowedDashboardWidgets: customWidgetsActive ? widgets : null,
          featureFlags: Object.keys(flags).length ? flags : null,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed to save overrides");
      setSaved(true);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border rounded-lg bg-card p-6 space-y-6 mt-6">
      <div className="flex items-center justify-between border-b pb-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Module & Field Access Control</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure tenant-specific module availability and restricted data fields.
          </p>
        </div>
        <button
          onClick={save}
          disabled={busy}
          className="btn-primary text-xs flex items-center gap-1.5"
        >
          <Save className="size-3.5" /> {busy ? "Saving overrides..." : "Save overrides"}
        </button>
      </div>

      {error && (
        <div className="text-xs text-rose-700 bg-rose-50 rounded-md p-3 flex items-start gap-2">
          <ShieldAlert className="size-4 mt-0.5" /> {error}
        </div>
      )}

      {saved && <div className="text-xs text-emerald-700 bg-emerald-50 rounded-md p-2">✓ Overrides saved successfully</div>}

      {/* Per-tenant feature flags — override individual capabilities without
          changing the firm's package. Absent = inherit the plan's value. */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Feature flags</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Toggle a capability for just this firm. &quot;Inherit&quot; uses the package default.</p>
        </div>
        <div className="border rounded-md divide-y bg-secondary/10">
          {FEATURE_FLAGS.map((f) => {
            const has = Object.prototype.hasOwnProperty.call(flags, f.key);
            return (
              <div key={f.key} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{f.label} <span className="text-[10px] text-muted-foreground font-mono">{f.key}</span></div>
                  <div className="text-[11px] text-muted-foreground">{f.description}</div>
                </div>
                {f.type === "boolean" ? (
                  <div className="flex gap-1 text-[11px] font-medium shrink-0">
                    {([["inherit", undefined], ["on", true], ["off", false]] as const).map(([lbl, val]) => {
                      const active = val === undefined ? !has : has && flags[f.key] === val;
                      return (
                        <button key={lbl} type="button" onClick={() => setFlag(f.key, val)}
                          className={`px-2 py-1 rounded border capitalize ${active ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent"}`}>
                          {lbl}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 shrink-0">
                    <input type="number" min={0} placeholder="inherit"
                      value={has ? String(flags[f.key]) : ""}
                      onChange={(e) => setFlag(f.key, e.target.value === "" ? undefined : Number(e.target.value))}
                      className="input-base text-xs w-28" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Sidebar Access (admin → MFD) */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Sidebar Access</h3>
            <button
              type="button"
              onClick={() => {
                const next = !customNavActive;
                setCustomNavActive(next);
                if (next && nav.length === 0) setNav(packageDefault);
                setSaved(false);
              }}
              className="flex items-center gap-1.5 text-xs font-medium"
            >
              <ToggleVisual on={customNavActive} /> Customize Access
            </button>
          </div>
          {!customNavActive ? (
            <div className="text-xs text-muted-foreground bg-secondary/30 p-3 rounded-md border">
              This firm can open all sidebar items allowed by its package plan. Check &quot;Customize Access&quot;
              to pick exactly which sidebar items the MFD can use ({ALL_NAV_KEYS.length} available).
            </div>
          ) : (
            <div className="space-y-3 max-h-[440px] overflow-y-auto border rounded-md p-4 bg-secondary/10 scrollbar-thin">
              <div className="flex gap-3 text-[11px] font-medium">
                <button type="button" onClick={() => { setNav(ALL_NAV_KEYS); setSaved(false); }} className="text-primary hover:underline">
                  Select all
                </button>
                <button type="button" onClick={() => { setNav(packageDefault); setSaved(false); }} className="text-primary hover:underline">
                  Match package
                </button>
                <button type="button" onClick={() => { setNav([]); setSaved(false); }} className="text-muted-foreground hover:underline">
                  Clear all
                </button>
                <span className="text-muted-foreground ml-auto">{nav.length}/{ALL_NAV_KEYS.length} selected</span>
              </div>
              {NAV_ACCESS_GROUPS.map((grp) => {
                const groupKeys = grp.items.map((i) => i.key);
                const allOn = groupKeys.every((k) => nav.includes(k));
                return (
                <div key={grp.title} className="space-y-1.5">
                  <div className="flex items-center justify-between border-b pb-0.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {grp.title}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setNav((prev) => (allOn ? prev.filter((k) => !groupKeys.includes(k)) : [...new Set([...prev, ...groupKeys])]));
                        setSaved(false);
                      }}
                      className="text-[10px] font-medium text-primary hover:underline"
                    >
                      {allOn ? "Disable all" : "Enable all"}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {grp.items.map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => toggleNav(m.key)}
                        className="flex items-center gap-2 border rounded p-1.5 bg-card hover:bg-secondary/40 text-[11px] text-left w-full"
                      >
                        <ToggleVisual on={nav.includes(m.key)} />
                        <span>{m.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Field Access */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Allowed Data Fields</h3>
            <button
              type="button"
              onClick={() => { setCustomFieldsActive((v) => !v); setSaved(false); }}
              className="flex items-center gap-1.5 text-xs font-medium"
            >
              <ToggleVisual on={customFieldsActive} /> Customize Data Fields
            </button>
          </div>
          {!customFieldsActive ? (
            <div className="text-xs text-muted-foreground bg-secondary/30 p-3 rounded-md border">
              All catalog fields are currently available to this tenant. Check "Customize Data Fields" above to restrict access.
            </div>
          ) : (
            <div className="space-y-4 max-h-[350px] overflow-y-auto border rounded-md p-4 bg-secondary/10 scrollbar-thin">
              {Object.entries(AVAILABLE_FIELDS).map(([subject, fields]) => (
                <div key={subject} className="space-y-2">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b pb-1">
                    {subject} fields
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {fields.map((f) => {
                      const fqName = `${subject}.${f.key}`;
                      return (
                        <button
                          key={fqName}
                          type="button"
                          onClick={() => toggleField(fqName)}
                          className="flex items-center gap-2 border rounded p-1.5 bg-card hover:bg-secondary/40 text-[11px] text-left w-full"
                        >
                          <ToggleVisual on={allowedFields.includes(fqName) || allowedFields.includes(f.key)} />
                          <span>{f.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Dashboard Widgets (admin → MFD) — full width row */}
      <div className="space-y-4 border-t pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Dashboard Widgets</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Choose which cards &amp; sections appear on this firm&apos;s Dashboard home (KPIs,
              business breakdown, charts, insights).
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const next = !customWidgetsActive;
              setCustomWidgetsActive(next);
              if (next && widgets.length === 0) setWidgets(ALL_WIDGET_KEYS);
              setSaved(false);
            }}
            className="flex items-center gap-1.5 text-xs font-medium"
          >
            <ToggleVisual on={customWidgetsActive} /> Customize Widgets
          </button>
        </div>
        {!customWidgetsActive ? (
          <div className="text-xs text-muted-foreground bg-secondary/30 p-3 rounded-md border">
            This firm sees all dashboard widgets. Check &quot;Customize Widgets&quot; to pick exactly
            which cards/sections show on their Dashboard home ({ALL_WIDGET_KEYS.length} available).
          </div>
        ) : (
          <div className="space-y-3 max-h-[440px] overflow-y-auto border rounded-md p-4 bg-secondary/10 scrollbar-thin">
            <div className="flex gap-3 text-[11px] font-medium">
              <button type="button" onClick={() => { setWidgets(ALL_WIDGET_KEYS); setSaved(false); }} className="text-primary hover:underline">
                Select all
              </button>
              <button type="button" onClick={() => { setWidgets([]); setSaved(false); }} className="text-muted-foreground hover:underline">
                Clear all
              </button>
              <span className="text-muted-foreground ml-auto">{widgets.length}/{ALL_WIDGET_KEYS.length} selected</span>
            </div>
            {DASHBOARD_WIDGET_GROUPS.map((grp) => (
              <div key={grp.title} className="space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b pb-0.5">
                  {grp.title}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {grp.items.map((w) => (
                    <button
                      key={w.key}
                      type="button"
                      onClick={() => toggleWidget(w.key)}
                      className="flex items-center gap-2 border rounded p-1.5 bg-card hover:bg-secondary/40 text-[11px] text-left w-full"
                    >
                      <ToggleVisual on={widgets.includes(w.key)} />
                      <span>{w.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
