/**
 * Step 3: deterministic candidate extraction. Pull every well-formed email /
 * phone / PAN / GSTIN / date / PIN / customer-id / amount / UIN / policy-number
 * out of the text with regex, tagged with the page it sits on. These become the
 * CONSTRAINED set the classifier assigns to entities — so the model never
 * invents an email and can only pick from what's actually in the document.
 */

import type { Candidates, Candidate, PageText } from "./types";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PAN_RE = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g;
const GSTIN_RE = /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/g;
// IRDAI UIN, e.g. BAJHLIP23143V012223 or 101N123V01
const UIN_RE = /\b[A-Z]{3,6}[0-9]{2,6}[A-Z][0-9]{4,8}\b|\b[0-9]{3}[A-Z][0-9]{3}V[0-9]{2}\b/g;
const PIN_RE = /\b[1-9][0-9]{5}\b/g; // Indian PIN (6 digits, not leading 0)
// Indian mobile (10 digits 6-9 lead), optional +91/0 prefix; and toll-free.
const PHONE_RE = /(?:\+?91[-\s]?|0)?\b[6-9][0-9]{9}\b|\b1[89]00[-\s]?[0-9]{3}[-\s]?[0-9]{3,4}\b/g;
const DATE_RE =
  /\b(?:[0-3]?\d[\/\-.][01]?\d[\/\-.](?:19|20)\d{2}|(?:19|20)\d{2}[\/\-.][01]?\d[\/\-.][0-3]?\d|[0-3]?\d[\s-](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s-,]*(?:19|20)\d{2})\b/gi;
const MONEY_RE = /(?:₹|Rs\.?|INR)\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?|\b[0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{1,2})?\b/g;
// Label-anchored values (policy #, customer id) — capture the token after the label.
const POLICY_LABEL_RE = /(?:policy|certificate|cover\s*note)\s*(?:no|number|#)?\s*[:.\-]?\s*([A-Z0-9][A-Z0-9\/\-]{5,24})/gi;
const CUSTID_LABEL_RE = /(?:customer|client|cust)\s*(?:id|no|number|code)\s*[:.\-]?\s*([A-Z0-9][A-Z0-9\-]{3,20})/gi;

function pushUnique(arr: Candidate[], value: string, page: number) {
  const v = value.trim();
  if (!v) return;
  if (!arr.some((c) => c.value.toLowerCase() === v.toLowerCase())) arr.push({ value: v, page });
}

function sweep(re: RegExp, text: string, page: number, out: Candidate[], group = 0) {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    pushUnique(out, group ? m[group] : m[0], page);
    if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-width loops
  }
}

export function extractCandidates(pages: PageText[]): Candidates {
  const c: Candidates = {
    emails: [], phones: [], pans: [], gstins: [], policyNumbers: [],
    dates: [], pinCodes: [], customerIds: [], amounts: [], uins: [],
  };
  for (const { page, text } of pages) {
    sweep(EMAIL_RE, text, page, c.emails);
    sweep(PHONE_RE, text, page, c.phones);
    sweep(PAN_RE, text, page, c.pans);
    sweep(GSTIN_RE, text, page, c.gstins);
    sweep(UIN_RE, text, page, c.uins);
    sweep(PIN_RE, text, page, c.pinCodes);
    sweep(DATE_RE, text, page, c.dates);
    sweep(MONEY_RE, text, page, c.amounts);
    sweep(POLICY_LABEL_RE, text, page, c.policyNumbers, 1);
    sweep(CUSTID_LABEL_RE, text, page, c.customerIds, 1);
  }
  // A GSTIN's embedded PAN (chars 3-12) shows up as a PAN candidate too — drop
  // those so the proposer-PAN classifier isn't tempted by the firm's GST PAN.
  const gstPans = new Set(c.gstins.map((g) => g.value.slice(2, 12)));
  c.pans = c.pans.filter((p) => !gstPans.has(p.value));
  // A real policy/cover number always contains digits — drops "Policy Schedule"
  // → "Schedule" and "Policyholder" → "holder" false positives from the label regex.
  c.policyNumbers = c.policyNumbers.filter((p) => /\d/.test(p.value) && p.value.length >= 5);
  // Cap each list so a noisy scan can't bloat the prompt.
  for (const k of Object.keys(c) as (keyof Candidates)[]) c[k] = c[k].slice(0, 40);
  return c;
}
