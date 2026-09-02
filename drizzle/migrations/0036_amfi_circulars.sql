-- FEATURE: AMFI/SEBI regulatory circular digest (platform-shared reference data).
--
-- No tenant_id / no RLS — a circular applies to every MFD identically. The RLS
-- CI guard only inspects tenant_id tables, so this is correctly out of scope.
-- Idempotent (IF NOT EXISTS + ON CONFLICT).

CREATE TABLE IF NOT EXISTS amfi_circulars (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circular_no   text NOT NULL,
  title         text NOT NULL,
  issuer        text NOT NULL DEFAULT 'AMFI',
  category      text,
  summary       text NOT NULL,
  mfd_action    text,
  effective_on  date,
  deadline_on   date,
  published_on  date,
  source_url    text,
  severity      text NOT NULL DEFAULT 'info',
  tags          jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS amfi_circulars_circular_no_uq ON amfi_circulars (circular_no);
CREATE INDEX IF NOT EXISTS amfi_circulars_published_idx ON amfi_circulars (published_on);

-- Seed a small SSIT-curated starter set covering live, well-established
-- regulatory themes. Summaries are plain-English; MFDs confirm specifics from
-- the official source links. These are illustrative curated entries, not a
-- substitute for the regulator's text.
INSERT INTO amfi_circulars (circular_no, title, issuer, category, summary, mfd_action, severity, published_on, source_url, tags)
VALUES
  (
    'SEBI-AD-CODE-SELF-DECL',
    'ARN-holder self-declaration in advertisements + standard risk disclaimer',
    'SEBI', 'Disclosure',
    'Every communication that promotes a mutual fund product must carry the standard "Mutual fund investments are subject to market risks, read all scheme related documents carefully" disclaimer, and ARN holders must self-declare their distributor status. Marketing creatives without the ARN line / risk disclaimer are non-compliant.',
    E'- Ensure every WhatsApp/email/social creative carries the risk disclaimer.\n- Tag your ARN + "AMFI-registered Mutual Fund Distributor" on promotions.\n- The platform''s compliance gate auto-checks the ARN tagline on outbound messages.',
    'action_required', '2024-01-01', 'https://www.sebi.gov.in', '["advertising","ARN","disclaimer"]'::jsonb
  ),
  (
    'SEBI-NOMINATION-MF',
    'Mandatory nomination / opt-out declaration for mutual fund folios',
    'SEBI', 'Nomination',
    'Investors must either register a nominee or submit a signed opt-out declaration for their mutual fund folios. Folios without nomination or opt-out can face restrictions on transactions. The deadline has been extended in phases.',
    E'- Run the Clients list filtered by "nominee missing" and chase declarations.\n- The client health score already deducts for a missing nominee.\n- Capture nominee details during onboarding so new folios are compliant from day one.',
    'action_required', '2024-06-30', 'https://www.sebi.gov.in', '["nomination","folio","KYC"]'::jsonb
  ),
  (
    'KRA-KYC-REVALIDATION',
    'KYC re-validation with KRAs (re-KYC for non-validated records)',
    'SEBI', 'KYC',
    'KYC records not validated against the official PAN/Aadhaar databases may be marked "on hold", blocking fresh investments until re-KYC is completed. Investors with email/mobile not validated by a KRA need to re-submit KYC.',
    E'- Use the KYC tracker to find clients in "hold" / "re_kyc_required" status.\n- Prioritise clients with active SIPs — a hold can bounce their next instalment.\n- Re-KYC via any KRA / CKYC and update the client''s KYC status.',
    'critical', '2024-04-01', 'https://www.amfiindia.com', '["KYC","KRA","hold"]'::jsonb
  ),
  (
    'CBDT-LTCG-EXEMPTION-125K',
    'Equity LTCG exemption raised to ₹1.25 lakh; LTCG rate 12.5%',
    'CBDT', 'Taxation',
    'From FY 2024-25, long-term capital gains on equity mutual funds (units held over 12 months) are taxed at 12.5%, with the first ₹1,25,000 of LTCG per financial year exempt (up from ₹1,00,000). Short-term gains on equity are taxed at 20%.',
    E'- Use the Tax-harvesting report to find clients with unrealised long-term gains.\n- Harvest gains up to ₹1.25L per client before 31 March to use the exemption.\n- Factor the new 12.5% rate into redemption and switch advice.',
    'info', '2024-07-23', 'https://incometaxindia.gov.in', '["tax","LTCG","budget"]'::jsonb
  )
ON CONFLICT (circular_no) DO NOTHING;
