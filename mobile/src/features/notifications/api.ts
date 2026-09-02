/**
 * Notifications — the in-app bell. GET /api/notifications (user-scoped, RLS
 * limits each user to their own rows) + POST /api/notifications/mark-read.
 * The server also synthesises live ones (e.g. "3 client birthdays today").
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

export interface AppNotification {
  id: string;
  kind: string | null;
  title: string | null;
  body: string | null;
  /** Server field is `linkUrl` (a web /dashboard/... path), not `href`. */
  linkUrl: string | null;
  severity: string | null;
  readAt: string | null;
  createdAt: string | null;
  [k: string]: any;
}

export interface NotificationsResponse {
  notifications: AppNotification[];
  unreadCount?: number;
  [k: string]: any;
}

export function useNotifications(unreadOnly = false) {
  return useQuery({
    queryKey: ["notifications", unreadOnly],
    queryFn: () => api.get<NotificationsResponse>("/api/notifications", unreadOnly ? { unreadOnly: "1" } : undefined),
    staleTime: 60_000,
    // The bell should reflect reality without the user pulling to refresh.
    refetchInterval: 5 * 60_000,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { ids?: string[]; all?: boolean }) => api.post("/api/notifications/mark-read", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export const isUnread = (n: AppNotification) => !n.readAt;
