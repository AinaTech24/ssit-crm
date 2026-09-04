import { headers } from "next/headers";
import { AuthPanelLayout } from "@/components/auth/AuthPanelLayout";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { resolveLoginBrandingByHost } from "@/lib/tenant/host";

// Same host-based white-label resolution as /login — a firm on its own domain
// kept seeing the Equitywala wordmark the moment it clicked "Forgot?", which broke the
// illusion mid-flow.
export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const branding = await resolveLoginBrandingByHost(host).catch(() => null);

  return (
    <>
      {branding?.themeCss ? <style dangerouslySetInnerHTML={{ __html: branding.themeCss }} /> : null}
      <AuthPanelLayout
        eyebrow="Account recovery"
        title="Locked out? You'll be back in a minute."
        sub="We'll email a single-use link to your work address. It expires in an hour, so nobody can dig it out of an old inbox later."
        points={[
          "One-time link, valid for 1 hour",
          "Sent only to your registered work email",
          "Your data stays exactly as you left it",
          "Need help? Ask your firm admin",
        ]}
        brandLogoUrl={branding?.logoUrl ?? null}
        brandName={branding?.name ?? null}
      >
        <ForgotPasswordForm />
      </AuthPanelLayout>
    </>
  );
}
