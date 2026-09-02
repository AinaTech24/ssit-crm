import type { LicenseState } from "./license";

/**
 * Check if a field is allowed for a tenant under their current license.
 * If allowedFields is null or empty, everything is allowed by default.
 * Both fully qualified keys like 'investor.pan' and raw keys like 'pan' are evaluated.
 */
export function isFieldAllowed(license: LicenseState | null | undefined, subject: string, fieldKey: string): boolean {
  if (!license) return true;
  // Platform admins have bypass for everything
  if (license.packageKey === "platform_admin") return true;
  if (!license.allowedFields || license.allowedFields.length === 0) return true;
  
  const fqName = `${subject}.${fieldKey}`;
  return license.allowedFields.includes(fqName) || license.allowedFields.includes(fieldKey);
}
