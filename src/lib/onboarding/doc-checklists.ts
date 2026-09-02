/**
 * Per-client-type document checklists.
 *
 * When the RM mints a document-collection share token, they pick the client
 * type. The /d/[token] page reads `payload.requiredDocs` to render the
 * correct list. Tenants can override defaults later via settings.
 */

export type ClientType = "individual" | "huf" | "nri" | "minor" | "company" | "trust";

export interface RequiredDoc {
  key: string;
  label: string;
  required?: boolean;
  helpText?: string;
}

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  individual: "Individual / Resident",
  huf: "HUF (Hindu Undivided Family)",
  nri: "NRI (Non-Resident Indian)",
  minor: "Minor (Below 18)",
  company: "Company / Corporate",
  trust: "Trust",
};

export const DOC_CHECKLISTS: Record<ClientType, RequiredDoc[]> = {
  individual: [
    { key: "pan", label: "PAN card (scan or photo)", required: true },
    { key: "aadhar", label: "Aadhar card (front & back)", required: true },
    { key: "photo", label: "Passport-size photograph", required: true },
    { key: "bank_statement", label: "Bank statement / passbook (last 3 months)", required: true },
    { key: "cancelled_cheque", label: "Cancelled cheque", required: true },
    { key: "address_proof", label: "Address proof (if different from Aadhar)", required: false },
    { key: "fatca", label: "FATCA / CRS declaration", required: false },
  ],
  huf: [
    { key: "huf_pan", label: "HUF PAN card", required: true },
    { key: "karta_pan", label: "Karta's PAN card", required: true },
    { key: "karta_aadhar", label: "Karta's Aadhar", required: true },
    { key: "huf_deed", label: "HUF deed", required: true },
    { key: "huf_bank_statement", label: "HUF bank statement (last 3 months)", required: true },
    { key: "huf_cancelled_cheque", label: "HUF cancelled cheque", required: true },
    { key: "member_list", label: "List of coparceners / members", required: true },
  ],
  nri: [
    { key: "pan", label: "PAN card", required: true },
    { key: "passport", label: "Passport (with valid visa stamp)", required: true },
    { key: "overseas_address_proof", label: "Overseas address proof", required: true },
    { key: "indian_address_proof", label: "Indian address proof", required: false },
    { key: "photo", label: "Passport-size photograph", required: true },
    { key: "nre_nro_statement", label: "NRE / NRO bank statement (last 3 months)", required: true },
    { key: "nre_nro_cheque", label: "NRE / NRO cancelled cheque", required: true },
    { key: "fatca", label: "FATCA / CRS declaration", required: true },
    { key: "pis_permission", label: "RBI / PIS permission letter (if applicable)", required: false },
  ],
  minor: [
    { key: "minor_pan", label: "Minor's PAN (if available)", required: false },
    { key: "minor_aadhar", label: "Minor's Aadhar", required: true },
    { key: "minor_dob_proof", label: "Date of birth proof (birth certificate)", required: true },
    { key: "minor_photo", label: "Minor's passport-size photograph", required: true },
    { key: "guardian_pan", label: "Guardian's PAN card", required: true },
    { key: "guardian_aadhar", label: "Guardian's Aadhar card", required: true },
    { key: "guardian_relationship", label: "Proof of guardian–minor relationship", required: true },
    { key: "bank_statement", label: "Bank statement of guardian's bank (last 3 months)", required: true },
    { key: "cancelled_cheque", label: "Guardian's cancelled cheque", required: true },
  ],
  company: [
    { key: "company_pan", label: "Company PAN", required: true },
    { key: "incorporation_cert", label: "Certificate of Incorporation", required: true },
    { key: "moa_aoa", label: "MOA & AOA", required: true },
    { key: "board_resolution", label: "Board resolution authorising investments", required: true },
    { key: "authorised_sig_list", label: "List of authorised signatories (with specimen signatures)", required: true },
    { key: "company_bank_statement", label: "Company bank statement (last 3 months)", required: true },
    { key: "company_cheque", label: "Company cancelled cheque", required: true },
    { key: "fatca", label: "FATCA / CRS declaration", required: true },
    { key: "ubo_declaration", label: "Ultimate Beneficial Owner (UBO) declaration", required: true },
    { key: "director_kyc", label: "Directors' KYC (PAN + Aadhar for each)", required: true },
  ],
  trust: [
    { key: "trust_pan", label: "Trust PAN", required: true },
    { key: "trust_deed", label: "Trust deed", required: true },
    { key: "registration_cert", label: "Trust registration certificate", required: true },
    { key: "trustee_resolution", label: "Trustee resolution authorising investments", required: true },
    { key: "trustee_list", label: "List of trustees with PAN + Aadhar", required: true },
    { key: "trust_bank_statement", label: "Trust bank statement (last 3 months)", required: true },
    { key: "trust_cheque", label: "Trust cancelled cheque", required: true },
    { key: "fatca", label: "FATCA / CRS declaration", required: true },
    { key: "ubo_declaration", label: "UBO declaration", required: true },
  ],
};

export function getChecklist(clientType: ClientType): RequiredDoc[] {
  return DOC_CHECKLISTS[clientType] ?? DOC_CHECKLISTS.individual;
}
