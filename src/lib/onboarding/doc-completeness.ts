/**
 * KYC document completeness — reconcile what a client/lead has UPLOADED against
 * the required-document checklist for their client type.
 *
 * Closes the loop on `document_chase`: instead of "we sent a link", the RM sees
 * "5 of 7 received — still missing: cancelled cheque, FATCA". A required doc is
 * considered received if any of the subject's vault documents references its key
 * (via the `tags` array or the `description`, both of which the public
 * collection form stamps with the checklist key) — or, as a looser fallback, if
 * a non-checklist document of a matching nature was uploaded.
 */

import { getChecklist, type ClientType, type RequiredDoc } from "./doc-checklists";

export interface ReceivedDoc {
  id: string;
  name: string;
  description: string | null;
  tags: string[] | null;
}

export interface CompletenessItem {
  key: string;
  label: string;
  required: boolean;
  received: boolean;
  docId: string | null;
}

export interface Completeness {
  clientType: ClientType;
  items: CompletenessItem[];
  requiredTotal: number;
  requiredReceived: number;
  missingRequired: string[]; // labels
  pct: number; // 0–100 over required docs
  extraCount: number; // uploaded docs not matched to any checklist item
}

/** A doc matches a checklist key if the key appears in its tags or description. */
function matches(doc: ReceivedDoc, key: string): boolean {
  const tags = (doc.tags ?? []).map((t) => String(t).toLowerCase());
  if (tags.includes(key.toLowerCase())) return true;
  if ((doc.description ?? "").toLowerCase() === key.toLowerCase()) return true;
  return false;
}

export function computeCompleteness(received: ReceivedDoc[], clientType: ClientType): Completeness {
  const checklist: RequiredDoc[] = getChecklist(clientType);
  const matchedDocIds = new Set<string>();

  const items: CompletenessItem[] = checklist.map((rd) => {
    const hit = received.find((d) => matches(d, rd.key));
    if (hit) matchedDocIds.add(hit.id);
    return {
      key: rd.key,
      label: rd.label,
      required: rd.required !== false,
      received: !!hit,
      docId: hit?.id ?? null,
    };
  });

  const requiredItems = items.filter((i) => i.required);
  const requiredReceived = requiredItems.filter((i) => i.received).length;
  const missingRequired = requiredItems.filter((i) => !i.received).map((i) => i.label);
  const extraCount = received.filter((d) => !matchedDocIds.has(d.id)).length;

  return {
    clientType,
    items,
    requiredTotal: requiredItems.length,
    requiredReceived,
    missingRequired,
    pct: requiredItems.length ? Math.round((requiredReceived / requiredItems.length) * 100) : 100,
    extraCount,
  };
}
