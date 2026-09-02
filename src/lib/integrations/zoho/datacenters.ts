/**
 * Zoho operates several regional data centers, each with its OWN OAuth accounts
 * server and CRM API domain. A token minted in one DC does not work in another,
 * so we store each MFD's DC and route every call to the right host. India (.in)
 * is the default for this product.
 */
export type ZohoDataCenter = "us" | "eu" | "in" | "au" | "jp" | "ca" | "sa" | "cn";

type DcHosts = { accounts: string; api: string };

const DATA_CENTERS: Record<ZohoDataCenter, DcHosts> = {
  us: { accounts: "https://accounts.zoho.com", api: "https://www.zohoapis.com" },
  eu: { accounts: "https://accounts.zoho.eu", api: "https://www.zohoapis.eu" },
  in: { accounts: "https://accounts.zoho.in", api: "https://www.zohoapis.in" },
  au: { accounts: "https://accounts.zoho.com.au", api: "https://www.zohoapis.com.au" },
  jp: { accounts: "https://accounts.zoho.jp", api: "https://www.zohoapis.jp" },
  ca: { accounts: "https://accounts.zohocloud.ca", api: "https://www.zohoapis.ca" },
  sa: { accounts: "https://accounts.zoho.sa", api: "https://www.zohoapis.sa" },
  cn: { accounts: "https://accounts.zoho.com.cn", api: "https://www.zohoapis.com.cn" },
};

export function isZohoDataCenter(v: unknown): v is ZohoDataCenter {
  return typeof v === "string" && v in DATA_CENTERS;
}

/** Normalise the `location` Zoho returns on the OAuth callback into our DC code. */
export function dcFromLocation(location?: string | null): ZohoDataCenter {
  const l = (location ?? "").toLowerCase().trim();
  return isZohoDataCenter(l) ? l : "in";
}

export function accountsServer(dc: ZohoDataCenter): string {
  return DATA_CENTERS[dc].accounts;
}

export function apiDomain(dc: ZohoDataCenter): string {
  return DATA_CENTERS[dc].api;
}
