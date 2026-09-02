/**
 * Global search — GET /api/search?q= (cross-module fuzzy search, same endpoint
 * as web). "Find this person fast" is the most-used field action, so this is the
 * one screen that reaches across modules.
 *
 * The API also returns service requests and compliance documents. This app is
 * scoped to 8 modules, so those have nowhere to open — we don't render results a
 * tap can't resolve. Folios and SIPs DO carry investor_id, so they resolve to
 * their owning client (an RM searching a folio number wants the person).
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

export interface SearchInvestor { id: string; name: string; pan: string | null; phone: string | null; email: string | null; segment_tag: string | null }
export interface SearchLead { id: string; name: string; phone: string | null; email: string | null; stage: string | null; source: string | null }
export interface SearchFolio { id: string; folio_number: string; amc_name: string | null; aum: string | number | null; investor_name: string | null; investor_id: string | null }
export interface SearchSip { id: string; scheme_name: string | null; amount: string | number | null; status: string | null; investor_name: string | null; investor_id: string | null }

export interface SearchResults {
  q: string;
  investors: SearchInvestor[];
  leads: SearchLead[];
  folios: SearchFolio[];
  sips: SearchSip[];
}

/** The API ignores anything shorter than 2 chars; don't spend a request on it. */
export const MIN_QUERY = 2;

export function useSearch(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: ["search", term],
    queryFn: () => api.get<SearchResults>("/api/search", { q: term }),
    enabled: term.length >= MIN_QUERY,
    staleTime: 30_000,
    // Keep the last results visible while the next query flies — a list that
    // blanks on every keystroke feels broken on a phone.
    placeholderData: (prev) => prev,
  });
}

export const countResults = (r?: SearchResults): number =>
  r ? r.investors.length + r.leads.length + r.folios.length + r.sips.length : 0;
