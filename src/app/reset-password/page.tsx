import { headers } from "next/headers";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { AuthPanelLayout } from "@/components/auth/AuthPanelLayout";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { resolveLoginBrandingByHost } from "@/lib/tenant/host";

// The token arrives in the query string, so this page is per-request anyway.
// Reading it server-side removes the useSearchParams/Suspense dance the old
// version needed and lets the missing-token case render without a flash.
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const branding = await resolveLoginBrandingByHost(host).catch(() => null);

  const shell = (children: React.ReactNode) => (
    <>
      {branding?.themeCss ? <style dangerouslySetInnerHTML={{ __html: branding.themeCss }} /> : null}
      <AuthPanelLayout
        eyebrow="Account recovery"
        title="Choose a new password."
        sub="Pick something you don't use anywhere else. We'll sign you straight back in once it's saved."
        points={[
          "At least 8 characters",
          "Signs you in immediately",
          "Other sessions stay as they are",
          "The reset link can't be reused",
        ]}
        brandLogoUrl={branding?.logoUrl ?? null}
        brandName={branding?.name ?? null}
      >
        {children}
      </AuthPanelLayout>
    </>
  );

  if (!token) {
    return shell(
      <>
        <div className="size-12 rounded-2xl bg-amber-50 border border-amber-200 grid place-items-center">
          <TriangleAlert className="size-6 text-amber-600" />
        </div>
        <h1 className="mt-5 text-[1.9rem] font-extrabold tracking-tight text-foreground leading-tight">
          Link looks incomplete
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          This page needs the reset token from your email. Some mail apps trim long links — try
          opening it from the email again, or request a fresh one.
        </p>
        <Link href="/forgot-password" className="btn-primary w-full mt-6">
          Request a new link
        </Link>
        <p className="mt-4 text-center">
          <Link href="/login" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            Back to sign in
          </Link>
        </p>
      </>
    );
  }

  return shell(<ResetPasswordForm token={token} />);
}
