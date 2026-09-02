/**
 * Registry of tenant feature flags — arbitrary capability toggles that can be
 * granted per PACKAGE (packages.feature_flags) and now OVERRIDDEN per tenant
 * (subscriptions.feature_flags_override). loadTenantLicense merges
 * { ...package.featureFlags, ...subscription.featureFlagsOverride }.
 *
 * Add a row here to make a flag appear in the SSIT-Admin per-tenant editor and
 * to document what it does. `type` drives the editor control.
 */

export type FeatureFlagDef = {
  key: string;
  label: string;
  description: string;
  type: "boolean" | "number";
  group: string;
};

export const FEATURE_FLAGS: FeatureFlagDef[] = [
  { key: "customDomain", label: "Custom domain", description: "Serve the CRM on the firm's own domain (crm.theirfirm.in), not just a vanity subdomain.", type: "boolean", group: "White-label" },
  { key: "whiteLabel", label: "White-label branding", description: "Remove SSIT branding from client-facing surfaces (emails, PDFs, portal).", type: "boolean", group: "White-label" },
  { key: "maxMessagesPerMonth", label: "Monthly message quota", description: "Cap on WhatsApp/SMS/email sends per month (0 or blank = plan default).", type: "number", group: "Limits" },
];

export const FEATURE_FLAG_KEYS = new Set(FEATURE_FLAGS.map((f) => f.key));

/** Only accept known flag keys (+ correct primitive types) from the admin editor. */
export function sanitizeFeatureFlagOverride(input: Record<string, unknown> | null | undefined): Record<string, boolean | number> {
  const out: Record<string, boolean | number> = {};
  if (!input) return out;
  for (const def of FEATURE_FLAGS) {
    const v = input[def.key];
    if (v === undefined || v === null || v === "") continue; // "inherit from package"
    if (def.type === "boolean") out[def.key] = !!v;
    else if (def.type === "number" && Number.isFinite(Number(v))) out[def.key] = Number(v);
  }
  return out;
}
