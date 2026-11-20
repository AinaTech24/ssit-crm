/**
 * Fields the Leads "Update a field" bulk action may set, grouped for the picker.
 *
 * Same idea as the Clients catalogue (src/lib/investors/bulk-fields.ts): the dialog
 * builds its inputs from this list and POST /api/leads/bulk validates against it, so a
 * field that is not here can never be written by a bulk call.
 *
 * "event" is special: its options are the firm's own event list (loaded in the browser
 * from /api/lead-events) and the server checks the chosen name against that list.
 * Choosing an event makes the lead an event lead (source = Event + the event name).
 *
 * Pure data, no server imports, so the client component can use it too.
 */

import type { BulkFieldGroup } from "@/lib/investors/bulk-fields";

const opts = (pairs: Array<[string, string]>) => pairs.map(([value, label]) => ({ value, label }));

/** Every source except "event" - an event lead is made through the Event field, which also records which event. */
export const LEAD_BULK_SOURCE_OPTIONS = opts([
  ["referral", "Referral"],
  ["website", "Website"],
  ["social_media", "Social Media"],
  ["webinar", "Webinar"],
  ["seminar", "Seminar"],
  ["walk_in", "Walk-in"],
  ["existing_client", "Existing Client Reference"],
  ["google", "Google"],
  ["cold_call", "Cold Call"],
  ["meta_ads", "Meta Ads"],
  ["linkedin", "LinkedIn"],
  ["youtube", "YouTube"],
  ["other", "Other"],
  ["manual", "Manual"],
]);

export const LEAD_BULK_FIELD_GROUPS: BulkFieldGroup[] = [
  {
    group: "Source",
    fields: [
      { key: "event", label: "Event (makes them event leads)", kind: "select", target: "column", options: [] },
      { key: "source", label: "Lead source", kind: "select", target: "column", options: LEAD_BULK_SOURCE_OPTIONS },
      { key: "sourceCampaign", label: "Campaign", kind: "text", target: "column", placeholder: "e.g. Diwali-2026" },
    ],
  },
  {
    group: "Details",
    fields: [
      { key: "city", label: "City", kind: "text", target: "column", placeholder: "e.g. Vadodara" },
      { key: "intendedAmount", label: "Intended amount", kind: "text", target: "column", placeholder: "e.g. 500000 (digits only)" },
      { key: "nextFollowUpAt", label: "Next follow-up date", kind: "date", target: "column" },
    ],
  },
  {
    group: "Tags",
    fields: [
      { key: "tag_add", label: "Add a tag", kind: "tag_add", target: "tags", placeholder: "Tag to add" },
      { key: "tag_remove", label: "Remove a tag", kind: "tag_remove", target: "tags", placeholder: "Tag to remove" },
    ],
  },
];

export function findLeadBulkField(key: string) {
  for (const g of LEAD_BULK_FIELD_GROUPS) {
    const f = g.fields.find((x) => x.key === key);
    if (f) return f;
  }
  return undefined;
}

/** The groups with the Event field's options filled in from the firm's event list. */
export function leadBulkGroups(events: Array<{ label: string }>): BulkFieldGroup[] {
  return LEAD_BULK_FIELD_GROUPS.map((g) => ({
    ...g,
    fields: g.fields.map((f) =>
      f.key === "event" ? { ...f, options: events.map((e) => ({ value: e.label, label: e.label })) } : f
    ),
  }));
}
