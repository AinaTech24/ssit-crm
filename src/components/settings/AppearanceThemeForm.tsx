"use client";

/**
 * Appearance / theme picker — lets an MFD owner re-skin the whole CRM to their
 * brand. Pick a preset palette or two custom colours; a live preview re-skins a
 * mini-CRM mockup instantly. Saving PATCHes the tenant's primary/secondary
 * colours (the same fields the branding compositor uses), then refreshes so the
 * real layout picks up the new theme.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, RotateCcw, Check, Palette } from "lucide-react";
import {
  THEME_PRESETS,
  DEFAULT_THEME,
  buildThemeStyleObject,
  isHexColor,
  THEME_FONTS,
  UI_DENSITIES,
} from "@/lib/branding/theme";

export function AppearanceThemeForm({ tenant }: { tenant: any }) {
  const router = useRouter();
  // Stock equivalents of the app's light-mode --foreground / --secondary.
  const TEXT_DEFAULT = "#0f172a";
  const HOVER_DEFAULT = "#f1f5f9";
  const initialPrimary = isHexColor(tenant.primaryColor) ? tenant.primaryColor : DEFAULT_THEME.primary;
  const initialAccent = isHexColor(tenant.secondaryColor) ? tenant.secondaryColor : DEFAULT_THEME.accent;
  const initialText = isHexColor(tenant.textColor) ? tenant.textColor : TEXT_DEFAULT;
  const initialHover = isHexColor(tenant.hoverColor) ? tenant.hoverColor : HOVER_DEFAULT;

  const initialFont = (tenant.fontFamily as string) || "inter";
  const initialDensity = (tenant.uiDensity as string) || "comfortable";

  const [primary, setPrimary] = useState(initialPrimary);
  const [accent, setAccent] = useState(initialAccent);
  const [text, setText] = useState(initialText);
  const [hover, setHover] = useState(initialHover);
  const [font, setFont] = useState<string>(initialFont);
  const [density, setDensity] = useState<string>(initialDensity);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dirty =
    primary !== initialPrimary || accent !== initialAccent || text !== initialText || hover !== initialHover ||
    font !== initialFont || density !== initialDensity;
  const previewVars = useMemo(
    () => buildThemeStyleObject(primary, accent, text, hover) as React.CSSProperties,
    [primary, accent, text, hover]
  );

  const activePresetId = THEME_PRESETS.find(
    (p) => p.primary.toLowerCase() === primary.toLowerCase() && p.accent.toLowerCase() === accent.toLowerCase()
  )?.id;

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/tenant", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ primaryColor: primary, secondaryColor: accent, textColor: text, hoverColor: hover, fontFamily: font, uiDensity: density }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Save failed");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      router.refresh(); // re-render the layout so the live theme updates everywhere
    } catch (e: any) {
      setErr(e.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  }

  function resetDefault() {
    setPrimary(DEFAULT_THEME.primary);
    setAccent(DEFAULT_THEME.accent);
    setText(TEXT_DEFAULT);
    setHover(HOVER_DEFAULT);
    setFont("inter");
    setDensity("comfortable");
  }

  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-5 items-start">
      {/* ── Controls ── */}
      <div className="space-y-5">
        {/* Typography & density */}
        <div className="border rounded-xl bg-card p-5 space-y-3">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Typography &amp; density</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <div className="text-xs font-medium mb-1">Font</div>
              <select value={font} onChange={(e) => setFont(e.target.value)} className="input-base text-sm w-full">
                {THEME_FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </label>
            <label className="block">
              <div className="text-xs font-medium mb-1">Density</div>
              <select value={density} onChange={(e) => setDensity(e.target.value)} className="input-base text-sm w-full">
                {UI_DENSITIES.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground">Applies across the whole workspace for your firm. Compact tightens text &amp; spacing.</p>
        </div>

        {/* Presets */}
        <div className="border rounded-xl bg-card p-5 space-y-3">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground flex items-center gap-2">
            <Palette className="size-4" /> Preset palettes
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {THEME_PRESETS.map((p) => {
              const active = activePresetId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setPrimary(p.primary);
                    setAccent(p.accent);
                  }}
                  className={`relative rounded-lg border p-2.5 text-left transition ${
                    active ? "border-foreground/40 ring-2 ring-foreground/10" : "border-border hover:bg-secondary"
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="size-5 rounded-md border border-black/10" style={{ background: p.primary }} />
                    <span className="size-5 rounded-md border border-black/10" style={{ background: p.accent }} />
                    {active && <Check className="size-3.5 ml-auto text-emerald-600" />}
                  </div>
                  <div className="text-[11px] font-semibold">{p.label}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom colours */}
        <div className="border rounded-xl bg-card p-5 space-y-4">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Custom colours</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <Swatch
              label="Primary (chrome)"
              hint="Sidebar, primary buttons, headers"
              value={primary}
              onChange={setPrimary}
            />
            <Swatch
              label="Accent (highlights)"
              hint="Links, active items, focus, accents"
              value={accent}
              onChange={setAccent}
            />
            <Swatch
              label="Text colour"
              hint="Body text across the workspace"
              value={text}
              onChange={setText}
            />
            <Swatch
              label="Hover colour"
              hint="Hover & secondary surfaces (applied as a soft tint)"
              value={hover}
              onChange={setHover}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            For legibility, the chrome colour is automatically deepened where white text sits on top — your hue is
            preserved while contrast stays accessible. These colours also brand your downloaded creatives.
          </p>
        </div>

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex items-center gap-2">
          <button onClick={save} disabled={busy || !dirty} className="btn-primary disabled:opacity-50">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {busy ? "Saving…" : "Save theme"}
          </button>
          <button onClick={resetDefault} type="button" className="btn-secondary">
            <RotateCcw className="size-3.5" /> Reset to default
          </button>
          {saved && (
            <span className="text-xs text-emerald-600 flex items-center gap-1">
              <Check className="size-3.5" /> Saved — applied across the CRM
            </span>
          )}
        </div>
      </div>

      {/* ── Live preview (scoped theme via inline CSS vars) ── */}
      <div className="lg:sticky lg:top-4">
        <div className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground mb-2">Live preview</div>
        <div
          style={previewVars}
          className="rounded-2xl border border-border overflow-hidden shadow-lg bg-background"
        >
          <div className="flex h-[320px]">
            {/* Mini sidebar */}
            <div className="w-[44%] brand-mesh text-white p-3 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-lg bg-white/95 grid place-items-center text-sm font-extrabold" style={{ color: primary }}>
                  {(tenant.displayName ?? "M").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold truncate leading-tight">{tenant.displayName ?? "Your Firm"}</div>
                  <div className="text-[9px] text-white/70 font-mono truncate">{tenant.arn ?? "ARN —"}</div>
                </div>
              </div>
              <div className="space-y-1 mt-1">
                <div className="nav-link-active flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-medium">
                  <span className="size-2 rounded-full bg-brand-cyan" /> Dashboard
                </div>
                <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] text-white/70">
                  <span className="size-2 rounded-full bg-white/30" /> Clients
                </div>
                <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] text-white/70">
                  <span className="size-2 rounded-full bg-white/30" /> Reports
                </div>
              </div>
            </div>

            {/* Mini content */}
            <div className="flex-1 bg-background p-3 space-y-3 overflow-hidden">
              <div className="kpi-hero p-2.5">
                <div className="text-[9px] uppercase tracking-wide opacity-80">Total AUM</div>
                <div className="text-base font-bold">₹128.4 Cr</div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="chip bg-brand-cyan-light text-brand-cyan-deep text-[10px]">Active</span>
                <span className="chip bg-brand-navy-light text-brand-navy text-[10px]">SIP</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <button type="button" className="btn-primary text-[11px] py-1.5">Primary action</button>
                <button type="button" className="btn-accent text-[11px] py-1.5">Accent action</button>
              </div>
              <div className="text-gradient text-sm font-bold">Branded heading</div>
            </div>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2 text-center">
          Updates instantly as you choose colours. Save to apply across the whole CRM.
        </p>
      </div>
    </div>
  );
}

function Swatch({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="text-xs font-medium mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 border rounded-md cursor-pointer flex-shrink-0"
          aria-label={label}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
            onChange(v);
          }}
          className="w-full border rounded-md px-2.5 py-2 text-sm font-mono bg-background uppercase"
          maxLength={7}
          spellCheck={false}
        />
      </div>
      <div className="text-[10px] text-muted-foreground mt-1">{hint}</div>
    </div>
  );
}
