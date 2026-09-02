import { FileText, IdCard, Phone, MapPin, Landmark, IndianRupee } from "lucide-react";

/**
 * KYC Submission Details — raw extra fields captured by the public onboarding
 * link (guardian_name, overseas_address, tin, pep_status, source_of_wealth,
 * bank/address blocks, …) that the normal investor form doesn't surface.
 *
 * Pure render (server component). Instead of one long alphabetical list, fields
 * are grouped into readable sections (Identity, Contact, Address, Bank,
 * Financial, Other) so an RM can scan a submission at a glance. Renders nothing
 * when there's nothing to show, so the caller can mount it unconditionally.
 */

type SectionKey = "identity" | "contact" | "address" | "bank" | "financial" | "other";

const SECTIONS: { key: SectionKey; label: string; icon: any }[] = [
  { key: "identity", label: "Identity & KYC", icon: IdCard },
  { key: "contact", label: "Contact", icon: Phone },
  { key: "address", label: "Address", icon: MapPin },
  { key: "bank", label: "Bank", icon: Landmark },
  { key: "financial", label: "Financial", icon: IndianRupee },
  { key: "other", label: "Other details", icon: FileText },
];

/** Bucket a field key into a section by keyword. Order matters — first match wins. */
function classify(key: string): SectionKey {
  const k = key.toLowerCase();
  if (/(bank|ifsc|account|micr|branch)/.test(k)) return "bank";
  if (/(address|pincode|pin_code|\bcity\b|\bstate\b|country|overseas|residential|permanent|locality|landmark)/.test(k)) return "address";
  if (/(email|phone|mobile|whatsapp|contact|alternate)/.test(k)) return "contact";
  if (/(income|net_worth|networth|salary|annual_turnover|investment_amount|source_of_(wealth|funds)|net worth)/.test(k)) return "financial";
  if (/(pan|aadhaar|aadhar|tin|ckyc|pep|political|guardian|occupation|nationality|dob|date_of_birth|gender|birth|marital|father|mother|spouse)/.test(k)) return "identity";
  return "other";
}

const humanize = (key: string) =>
  key
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

export function KycDataViewer({
  kycData,
}: {
  kycData: Record<string, string> | null | undefined;
}) {
  if (!kycData) return null;

  const entries = Object.entries(kycData)
    .filter(([, value]) => value != null && String(value).trim() !== "")
    .sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) return null;

  // Bucket into sections, preserving alphabetical order within each.
  const grouped = new Map<SectionKey, [string, string][]>();
  for (const [key, value] of entries) {
    const sec = classify(key);
    if (!grouped.has(sec)) grouped.set(sec, []);
    grouped.get(sec)!.push([key, String(value)]);
  }

  const visibleSections = SECTIONS.filter((s) => (grouped.get(s.key)?.length ?? 0) > 0);

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center gap-2 mb-1">
        <div className="size-7 rounded-lg bg-primary/10 grid place-items-center">
          <FileText className="size-3.5 text-primary" />
        </div>
        <h3 className="text-sm font-semibold">KYC submission details</h3>
        <span className="ml-auto text-[11px] text-muted-foreground">{entries.length} fields</span>
      </div>

      <div className="divide-y">
        {visibleSections.map(({ key, label, icon: Icon }) => (
          <div key={key} className="py-4 first:pt-3">
            <div className="flex items-center gap-1.5 mb-2.5">
              <Icon className="size-3.5 text-muted-foreground" />
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</h4>
            </div>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
              {grouped.get(key)!.map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{humanize(k)}</dt>
                  <dd className="text-sm font-medium break-words whitespace-pre-wrap line-clamp-3">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
