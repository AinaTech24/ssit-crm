import { headers } from "next/headers";
import { AuthShell } from "@/components/auth/AuthShell";
import { resolveLoginBrandingByHost } from "@/lib/tenant/host";

// Reads the request host to brand the login page for a firm's white-label domain
// (their logo + theme show before login when hit on their subdomain/custom domain).
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const branding = await resolveLoginBrandingByHost(host).catch(() => null);

  return (
    <>
      {branding?.themeCss ? <style dangerouslySetInnerHTML={{ __html: branding.themeCss }} /> : null}
      <AuthShell brandLogoUrl={branding?.logoUrl ?? null} brandName={branding?.name ?? null} />
    </>
  );
}
