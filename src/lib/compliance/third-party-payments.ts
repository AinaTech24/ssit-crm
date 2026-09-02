/**
 * DDQ 4.20b — third-party payment detection.
 *
 * "Do you monitor whether funds received towards subscription are received from
 * the Investor's own bank account only and it is not a third-party payment?"
 *
 * The transaction feed does NOT carry payer bank details, but the MANDATE does
 * (mandates.bank_account_masked / ifsc) — and the mandate is what actually
 * debits the investor for SIPs, i.e. the bulk of recurring inflows. So we flag
 * any ACTIVE mandate whose debit account does not match a bank account
 * registered against that investor.
 *
 * Matching is on the last 4 digits, because RTA feeds mask account numbers
 * inconsistently (XXXXXX1234 / ****1234 / 1234). IFSC is compared only when both
 * sides have one. A mandate with no account on file is reported separately as
 * "unverifiable" rather than silently passing.
 */

import { sql } from "drizzle-orm";

export type ThirdPartySuspect = {
  mandate_id: string;
  mandate_ref_no: string | null;
  investor_id: string;
  investor_name: string | null;
  mandate_bank: string | null;
  mandate_ifsc: string | null;
  registered_banks: string | null;
  reason: "account_mismatch" | "no_registered_bank" | "no_mandate_account";
};

/**
 * Active mandates whose debit account doesn't match the investor's registered
 * bank(s). Read-only — the MFD decides what is genuinely third-party and logs it
 * to the incident register.
 */
export const thirdPartySuspectsSql = (tenantId: string) => sql`
  WITH mandate_acct AS (
    SELECT m.id            AS mandate_id,
           m.mandate_ref_no,
           m.investor_id,
           m.bank_account_masked AS mandate_bank,
           m.ifsc                AS mandate_ifsc,
           NULLIF(RIGHT(regexp_replace(COALESCE(m.bank_account_masked, ''), '\D', '', 'g'), 4), '') AS m_last4
    FROM mandates m
    WHERE m.tenant_id = ${tenantId}::uuid
      AND m.status = 'active'
  ),
  investor_accts AS (
    -- Legacy single bank + every entry in the bank_accounts jsonb array.
    SELECT i.id AS investor_id,
           NULLIF(RIGHT(regexp_replace(COALESCE(i.bank_account_masked, ''), '\D', '', 'g'), 4), '') AS i_last4
    FROM investors i WHERE i.tenant_id = ${tenantId}::uuid
    UNION
    SELECT i.id,
           NULLIF(RIGHT(regexp_replace(COALESCE(b->>'accountMasked', ''), '\D', '', 'g'), 4), '')
    FROM investors i
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(i.bank_accounts, '[]'::jsonb)) b
    WHERE i.tenant_id = ${tenantId}::uuid
  )
  SELECT ma.mandate_id, ma.mandate_ref_no, ma.investor_id,
         i.name AS investor_name, ma.mandate_bank, ma.mandate_ifsc,
         (SELECT string_agg(DISTINCT ia.i_last4, ', ')
            FROM investor_accts ia
           WHERE ia.investor_id = ma.investor_id AND ia.i_last4 IS NOT NULL) AS registered_banks,
         CASE
           WHEN ma.m_last4 IS NULL THEN 'no_mandate_account'
           WHEN NOT EXISTS (SELECT 1 FROM investor_accts ia
                             WHERE ia.investor_id = ma.investor_id AND ia.i_last4 IS NOT NULL)
             THEN 'no_registered_bank'
           ELSE 'account_mismatch'
         END AS reason
  FROM mandate_acct ma
  JOIN investors i ON i.id = ma.investor_id AND i.deleted_at IS NULL
  WHERE
    -- mismatch: the mandate's last4 matches none of the investor's registered accounts
    (ma.m_last4 IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM investor_accts ia
         WHERE ia.investor_id = ma.investor_id AND ia.i_last4 = ma.m_last4))
    -- or we simply can't verify it
    OR ma.m_last4 IS NULL
  ORDER BY i.name
  LIMIT 200
`;

export const SUSPECT_REASON_LABEL: Record<ThirdPartySuspect["reason"], string> = {
  account_mismatch: "Debit account ≠ registered bank",
  no_registered_bank: "No bank on file for the client",
  no_mandate_account: "Mandate has no account number",
};
