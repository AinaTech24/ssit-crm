/**
 * Global module controls — platform-admin switches that gate every tenant's
 * access to a SIDEBAR item, on top of the per-package / per-user grants.
 *
 *   enabled  — normal (default for any item not explicitly set)
 *   beta     — accessible, but shown with a "Beta" tag in the sidebar
 *   disabled — hidden everywhere, for every tenant (a global kill-switch)
 *
 * Keyed by the sidebar item's `href` (so even items without a package `module`
 * are controllable). Stored in platform_settings('modules') as
 * { [href]: 'beta' | 'disabled' } — 'enabled' is the default so it's omitted.
 */
import { pool } from "@/db/client";
import { SIDEBAR_REGISTRY } from "@/lib/nav/sidebar-registry";

export type ModuleState = "enabled" | "beta" | "disabled";
export type ModuleControls = Record<string, ModuleState>;

const VALID_HREFS = new Set(SIDEBAR_REGISTRY.map((s) => s.href));
const TTL_MS = 30_000;
let _cache: { map: ModuleControls; at: number } | null = null;

export async function loadModuleControls(force = false): Promise<ModuleControls> {
  if (!force && _cache && Date.now() - _cache.at < TTL_MS) return _cache.map;
  let stored: Record<string, unknown> = {};
  try {
    const r = await pool.query("SELECT value FROM platform_settings WHERE key = 'modules' LIMIT 1");
    const v = r.rows?.[0]?.value;
    if (v && typeof v === "object") stored = v as Record<string, unknown>;
  } catch {
    // Table missing (pre-migration) → everything defaults to enabled.
  }
  const map: ModuleControls = {};
  for (const href of VALID_HREFS) {
    const s = stored[href];
    map[href] = s === "beta" || s === "disabled" ? s : "enabled";
  }
  _cache = { map, at: Date.now() };
  return map;
}

export function invalidateModuleControlsCache(): void {
  _cache = null;
}

export async function saveModuleControls(input: ModuleControls, adminUserId: string): Promise<void> {
  const clean: ModuleControls = {};
  for (const href of VALID_HREFS) {
    const s = input[href];
    if (s === "beta" || s === "disabled") clean[href] = s; // 'enabled' is the default → omit
  }
  await pool.query(
    `INSERT INTO platform_settings (key, value, updated_at, updated_by)
     VALUES ('modules', $1::jsonb, now(), $2::uuid)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(clean), adminUserId]
  );
  invalidateModuleControlsCache();
}

/** Shape for the admin UI — every sidebar item with its label + group + state. */
export function moduleControlsForAdmin(map: ModuleControls): Array<{ key: string; label: string; group: string; state: ModuleState }> {
  return SIDEBAR_REGISTRY.map((s) => ({ key: s.href, label: s.label, group: s.group, state: map[s.href] ?? "enabled" }));
}
