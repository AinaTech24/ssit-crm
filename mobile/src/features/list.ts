/**
 * Generic list/detail data hooks. Most modules follow the same shape — a list
 * endpoint returning { <envelope>: [...] } and a /[id] detail — so these two
 * hooks + the ModuleList/DetailScaffold components let each module be a small
 * config instead of repeated boilerplate.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

/** Fetch a list endpoint and pull the array out of its envelope. */
export function useModuleList<T = any>(key: string, endpoint: string, envelope: string) {
  return useQuery({
    queryKey: [key],
    queryFn: async () => {
      const r = await api.get<any>(endpoint);
      const arr = r?.[envelope] ?? r?.rows ?? r?.data ?? (Array.isArray(r) ? r : []);
      return (arr ?? []) as T[];
    },
  });
}

export function useModuleItem<T = any>(key: string, id: string | undefined, endpoint: string) {
  return useQuery({
    queryKey: [key, id],
    enabled: !!id,
    queryFn: () => api.get<T>(endpoint),
  });
}
