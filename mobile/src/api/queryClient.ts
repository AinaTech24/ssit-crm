/**
 * TanStack Query client — the app's server-cache + data layer. Conservative
 * defaults tuned for a CRM on mobile data: one retry, 30s freshness, no refetch
 * thrash on focus (manual pull-to-refresh instead).
 */

import { QueryClient, MutationCache } from "@tanstack/react-query";
import { ApiError } from "./client";
import { toast } from "../lib/toast";

export const queryClient = new QueryClient({
  // Every mutation (save / delete / log …) surfaces failures as a global toast,
  // so no screen has to wire its own error banner. A mutation can opt out with
  // `meta: { silent: true }` (e.g. optimistic background writes).
  mutationCache: new MutationCache({
    onError: (err, _vars, _ctx, mutation) => {
      if (mutation.meta?.silent) return;
      const msg = err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
      toast.error(msg);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, err) => {
        // Don't retry auth/permission failures — only transient ones.
        if (err instanceof ApiError && [400, 401, 403, 404, 422].includes(err.status)) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: 0 },
  },
});
