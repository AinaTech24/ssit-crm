import type { Metadata } from "next";
import { LegalShell, H2, P, UL } from "@/components/legal/LegalShell";
import { LEGAL, SUBPROCESSORS } from "@/lib/legal/company";

export const metadata: Metadata = {
  title: `Privacy Policy · ${LEGAL.brand}`,
  description: `How ${LEGAL.brand} collects, uses, and protects personal data.`,
};

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      intro={`This Privacy Policy explains how ${LEGAL.legalEntity} ("${LEGAL.brand}", "we") handles personal data in connection with the ${LEGAL.brand} platform, in line with India's Digital Personal Data Protection Act, 2023 (DPDP Act) and other applicable law.`}
    >
      <H2>1. Our two roles</H2>
      <P>
        We process personal data in two distinct capacities. For data about <em>your firm and its users</em>{" "}
        (account holders), we are the data fiduciary. For data about <em>your clients</em> that you upload or
        generate while using the platform ("Customer Data"), <strong>you</strong> are the data fiduciary and
        we act as your data processor — we handle that data only to provide the service and on your
        instructions.
      </P>

      <H2>2. Data we collect</H2>
      <UL
        items={[
          "Account data — name, email, phone, firm name, ARN, role, and authentication data (passwords are stored only as salted hashes).",
          "Customer Data you provide — investor/lead profiles, contact details, KYC-related fields, transactions, communications, and documents you upload.",
          "Usage data — log data, device/browser information, and actions taken in the platform, used for security and to operate the service.",
          "Payment data — handled by our payment processor; we receive subscription status and limited transaction metadata, not full card details.",
        ]}
      />

      <H2>3. How we use data</H2>
      <UL
        items={[
          "To provide, secure, and operate the platform and its messaging, automation, and compliance features.",
          "To process subscriptions, billing, and invoicing.",
          "To provide support, send service notices, and respond to grievances.",
          "To detect, prevent, and investigate fraud, abuse, and security incidents.",
          "To comply with legal, regulatory, and tax obligations.",
        ]}
      />
      <P>
        We do not sell personal data. We do not use your clients' Customer Data for our own marketing.
      </P>

      <H2>4. Legal basis and consent</H2>
      <P>
        We process account data to perform our contract with you and for our legitimate and legal interests in
        running the service. For Customer Data, you are responsible for obtaining the consent and lawful basis
        required from your clients (including under the DPDP Act and TRAI/DLT messaging norms) before uploading
        their data or messaging them through the platform.
      </P>

      <H2>5. Sub-processors</H2>
      <P>
        We use carefully selected third parties to deliver parts of the service. Each is bound to appropriate
        confidentiality and security obligations:
      </P>
      <UL
        items={SUBPROCESSORS.map((s) => (
          <>
            <strong>{s.name}</strong> — {s.purpose} ({s.region}).
          </>
        ))}
      />

      <H2>6. Data location and security</H2>
      <P>
        Application data and uploaded documents are hosted in India (AWS Mumbai region). We protect data with
        measures including encryption in transit, encryption at rest for sensitive secrets and documents,
        strict per-tenant database isolation (row-level security so one firm cannot access another's data),
        access controls, and audit logging. No method of transmission or storage is perfectly secure, but we
        work to protect your data and to notify affected parties of significant incidents as required by law.
      </P>

      <H2>7. Retention</H2>
      <P>
        We retain personal data for as long as your account is active and as needed to provide the service,
        comply with legal/regulatory obligations (including record-keeping norms applicable to distributors),
        resolve disputes, and enforce our agreements. On account closure you may export Customer Data for a
        reasonable period, after which we delete or anonymise it in line with our retention schedule.
      </P>

      <H2>8. Your rights</H2>
      <P>
        Subject to applicable law, individuals may request access to, correction of, or erasure of their
        personal data, and may withdraw consent. If you are a client of an MFD using {LEGAL.brand}, please
        direct your request to that MFD (the fiduciary for your data); we will assist them as their processor.
        For data we hold as fiduciary, contact our Grievance Officer below.
      </P>

      <H2>9. Cookies</H2>
      <P>
        We use strictly necessary cookies to keep you signed in and to secure the platform. We do not use
        advertising cookies.
      </P>

      <H2>10. Grievance Officer</H2>
      <P>
        In accordance with the DPDP Act and applicable IT rules, you may contact our Grievance Officer for any
        privacy concern or to exercise your rights:
      </P>
      <UL
        items={[
          <>
            {LEGAL.grievanceOfficer} —{" "}
            <a className="text-primary underline" href={`mailto:${LEGAL.grievanceEmail}`}>
              {LEGAL.grievanceEmail}
            </a>
          </>,
          <>{LEGAL.legalEntity}, {LEGAL.address}</>,
        ]}
      />

      <H2>11. Changes</H2>
      <P>
        We may update this Policy from time to time. Material changes will be notified through the platform or
        by email, and the "Last updated" date above will change.
      </P>

      <H2>12. Contact</H2>
      <P>
        General privacy questions:{" "}
        <a className="text-primary underline" href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>.
      </P>
    </LegalShell>
  );
}
