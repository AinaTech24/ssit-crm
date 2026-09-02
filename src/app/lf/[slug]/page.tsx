/**
 * Public lead capture form — /lf/[slug]
 *
 * Server-rendered shell that loads the form definition from the API,
 * then renders a client-component form. The client component handles
 * submission + thank-you state. We avoid using cookies / dashboard
 * layout so the page is fast + embeddable in iframes from the MFD's
 * own website.
 */

import { LeadCaptureFormClient } from "@/components/lead-forms/LeadCaptureFormClient";

export const dynamic = "force-dynamic";

async function loadForm(slug: string) {
  // Inside Next.js we can't use a relative URL — read from env.
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    `http://localhost:${process.env.PORT ?? 3000}`;
  try {
    const res = await fetch(`${base}/api/public/lead-forms/${slug}`, {
      cache: "no-store",
    });
    if (!res.ok) return { error: res.status === 410 ? "retired" : "not-found" };
    return await res.json();
  } catch {
    return { error: "fetch-failed" };
  }
}

export default async function PublicLeadFormPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await loadForm(slug);

  if ("error" in data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <div className="text-5xl mb-3">
            {data.error === "retired" ? "📪" : "🤷"}
          </div>
          <h1 className="text-xl font-semibold text-slate-800 mb-1">
            {data.error === "retired"
              ? "This form is no longer active"
              : "Form not found"}
          </h1>
          <p className="text-sm text-slate-500">
            {data.error === "retired"
              ? "The MFD has retired this form. Please reach out to them directly."
              : "Double-check the link or contact the MFD who shared it with you."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <LeadCaptureFormClient
      slug={slug}
      form={data.form}
      tenant={data.tenant}
    />
  );
}
