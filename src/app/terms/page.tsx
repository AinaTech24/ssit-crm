import type { Metadata } from "next";
import { LegalShell, H2, P, UL } from "@/components/legal/LegalShell";
import { LEGAL } from "@/lib/legal/company";

export const metadata: Metadata = {
  title: `Terms of Service · ${LEGAL.brand}`,
  description: `Terms governing use of the ${LEGAL.brand} platform.`,
};

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms of Service"
      intro={`These Terms of Service ("Terms") govern your access to and use of the ${LEGAL.brand} platform operated by ${LEGAL.legalEntity} ("${LEGAL.brand}", "we", "us"). By creating an account or using the platform you agree to these Terms.`}
    >
      <H2>1. Who can use the platform</H2>
      <P>
        {LEGAL.brand} is a business tool intended solely for mutual fund distributors (MFDs) and their staff
        who hold a valid AMFI Registration Number (ARN), and for persons they authorise. You confirm that you
        are at least 18 years old, are authorised to bind the firm you register, and will keep your ARN and
        regulatory registrations current while using the platform.
      </P>

      <H2>2. What the platform is — and is not</H2>
      <P>
        {LEGAL.brand} is software that helps you manage clients, run compliant communications, and automate
        routine workflows. {LEGAL.brand} is <strong>not</strong> an investment adviser, broker, stock
        exchange, depository, or registered intermediary, and nothing in the platform constitutes investment,
        legal, tax, or financial advice. You remain solely responsible for the suitability, accuracy, and
        regulatory compliance of every recommendation, message, and transaction you make using the platform.
      </P>

      <H2>3. Accounts and security</H2>
      <UL
        items={[
          "You are responsible for all activity under your account and for keeping your credentials confidential.",
          "You must promptly notify us of any unauthorised use of your account.",
          "You are responsible for the acts and omissions of every user you invite into your firm's workspace.",
          "We may suspend access where we reasonably believe an account is compromised or is being used unlawfully.",
        ]}
      />

      <H2>4. Subscriptions, trials, and billing</H2>
      <P>
        Paid plans are billed in advance on a recurring basis (monthly or yearly) through our payment
        processor. Free trials, where offered, convert to a paid subscription unless cancelled before the
        trial ends. Prices are exclusive of applicable taxes (including GST), which will be added at the
        prevailing rate. Cancellation, renewal, and refunds are governed by our{" "}
        <a className="text-primary underline" href="/refund">Refund &amp; Cancellation Policy</a>.
      </P>

      <H2>5. Your data and your clients' data</H2>
      <P>
        You retain ownership of the data you and your clients put into the platform ("Customer Data"). As
        between you and us, you are the data fiduciary/controller for your clients' personal data and we act
        as your data processor, handling Customer Data only to provide the service and on your instructions.
        You represent that you have the necessary consents and lawful basis to upload and process Customer
        Data (including under SEBI/AMFI norms and the Digital Personal Data Protection Act, 2023). Our handling
        of personal data is described in our{" "}
        <a className="text-primary underline" href="/privacy">Privacy Policy</a>.
      </P>

      <H2>6. Acceptable use</H2>
      <P>You agree not to:</P>
      <UL
        items={[
          "send messages without the consent required by law, TRAI/DLT norms, or platform compliance checks, or use the platform to send spam;",
          "upload unlawful, infringing, or harmful content, or data you have no right to process;",
          "attempt to access another firm's data, probe or bypass security controls, or disrupt the service;",
          "reverse engineer, resell, or white-label the platform except as expressly permitted in writing; or",
          "use the platform to provide investment advice unless you are separately authorised to do so.",
        ]}
      />

      <H2>7. Third-party services</H2>
      <P>
        The platform integrates third-party services (for example WhatsApp messaging, email and SMS delivery,
        payments, cloud hosting, and AI assistance). Your use of those features may be subject to the relevant
        provider's terms, and we are not responsible for the acts or omissions of third-party providers.
      </P>

      <H2>8. Intellectual property</H2>
      <P>
        The platform, its software, and its content (excluding Customer Data) are owned by {LEGAL.legalEntity}{" "}
        and its licensors. We grant you a limited, non-exclusive, non-transferable right to use the platform
        during your subscription. All rights not expressly granted are reserved.
      </P>

      <H2>9. Disclaimers</H2>
      <P>
        The platform is provided "as is" and "as available". To the maximum extent permitted by law, we
        disclaim all warranties, express or implied, including merchantability, fitness for a particular
        purpose, and non-infringement. We do not warrant that the platform will be uninterrupted, error-free,
        or that automated compliance checks will catch every regulatory issue — you remain responsible for
        your own compliance.
      </P>

      <H2>10. Limitation of liability</H2>
      <P>
        To the maximum extent permitted by law, neither party is liable for indirect, incidental, special, or
        consequential damages, or loss of profits, goodwill, or data. Our total aggregate liability arising
        out of or relating to the platform will not exceed the fees you paid to us in the twelve (12) months
        preceding the event giving rise to the claim.
      </P>

      <H2>11. Indemnity</H2>
      <P>
        You will indemnify and hold us harmless from claims arising out of your Customer Data, your use of the
        platform in breach of these Terms or applicable law, or your communications with clients.
      </P>

      <H2>12. Suspension and termination</H2>
      <P>
        You may cancel at any time as described in the Refund &amp; Cancellation Policy. We may suspend or
        terminate access for material breach of these Terms, non-payment, or where required by law. On
        termination you may export your Customer Data for a reasonable period, after which we may delete it in
        line with our retention practices.
      </P>

      <H2>13. Changes to these Terms</H2>
      <P>
        We may update these Terms from time to time. Material changes will be notified through the platform or
        by email. Continued use after changes take effect constitutes acceptance.
      </P>

      <H2>14. Governing law and disputes</H2>
      <P>
        These Terms are governed by the laws of India. The courts at {LEGAL.jurisdiction} have exclusive
        jurisdiction, subject to any applicable arbitration agreement between the parties.
      </P>

      <H2>15. Contact</H2>
      <P>
        Questions about these Terms? Contact us at{" "}
        <a className="text-primary underline" href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>.
      </P>
    </LegalShell>
  );
}
