/**
 * Team roster — reuses the existing /api/employees list and per-member detail
 * (which carries a stats roll-up). No new backend needed.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

export interface TeamMember {
  id: string;
  name: string | null;
  email: string | null;
  roles: string[] | null;
  department: string | null;
  status?: string | null;
}

export interface MemberStats {
  active_clients?: number;
  my_aum?: number | string;
  my_sip?: number | string;
  open_tasks?: number;
  overdue_tasks?: number;
  upcoming_meetings?: number;
}

export function useTeam() {
  return useQuery({
    queryKey: ["team"],
    queryFn: () => api.get<{ rows: TeamMember[] }>("/api/employees"),
    staleTime: 60_000,
  });
}

export function useMemberDetail(id: string | null) {
  return useQuery({
    queryKey: ["team-member", id],
    queryFn: () => api.get<{ user: TeamMember & Record<string, any>; stats: MemberStats }>(`/api/employees/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  });
}
