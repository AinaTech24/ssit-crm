import type { Metadata } from "next";
import { LegalShell, H2, P, UL } from "@/components/legal/LegalShell";
import { LEGAL } from "@/lib/legal/company";

export const metadata: Metadata = {
  title: `Refund & Cancellation Policy · ${LEGAL.brand}`,
  description: `Subscription cancellation and refund terms for ${LEGAL.brand}.`,
};

export default function RefundPage() {
  return (
    <LegalShell
      title="Refund & Cancellation Policy"
      intro={`This policy explains how subscriptions to the ${LEGAL.brand} platform are billed, cancelled, and refunded. It forms part of our Terms of Service.`}
    >
      <H2>1. Subscription model</H2>
      <P>
        {LEGAL.brand} is a subscription service billed in advance for each billing period (monthly or yearly),
        plus any applicable one-time setup fee and per-seat charges. All fees are exclusive of taxes, which are
        added at the prevailing rate (including GST).
      </P>

      <H2>2. Free trial</H2>
      <P>
        Where a free trial is offered, you can evaluate the platform at no charge for the stated period. If you
        do not cancel before the trial ends, your subscription begins and the applicable fee is charged. We
        recommend evaluating the platform fully during the trial, as this is the intended window to decide
        whether it fits your needs.
      </P>

      <H2>3. Cancellation</H2>
      <UL
        items={[
          "You may cancel your subscription at any time from your billing settings or by emailing us.",
          "On cancellation, your plan stays active until the end of the current paid billing period; it will not renew after that.",
          "You can continue to export your data until the end of the paid period.",
        ]}
      />

      <H2>4. Refunds</H2>
      <P>
        Because the platform is a digital service made available immediately, subscription fees are generally
        non-refundable, and we do not provide pro-rated refunds for the unused portion of a billing period
        after cancellation. We will, however, consider refunds in good faith in cases such as:
      </P>
      <UL
        items={[
          "a duplicate or accidental charge;",
          "a verified billing error on our side; or",
          "an extended service outage that materially prevented use and was not resolved within a reasonable time.",
        ]}
      />
      <P>
        One-time setup/onboarding fees are non-refundable once onboarding has begun. Approved refunds are made
        to the original payment method, normally within 5–7 business days of approval (your bank may take
        additional time to post the credit).
      </P>

      <H2>5. Failed payments</H2>
      <P>
        If a recurring payment fails, we may retry it and notify you. If payment is not completed after our
        retry window, access may be restricted or the subscription suspended until the outstanding amount is
        cleared. Your data is retained during a reasonable grace period before any deletion.
      </P>

      <H2>6. How to request a refund or cancellation</H2>
      <P>
        Email{" "}
        <a className="text-primary underline" href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a> from your
        registered account email with your firm name and the charge in question. We aim to acknowledge requests
        within 2 business days.
      </P>

      <H2>7. Changes</H2>
      <P>
        We may update this policy from time to time; the "Last updated" date above reflects the current
        version. Material changes will be notified through the platform or by email.
      </P>
    </LegalShell>
  );
}
