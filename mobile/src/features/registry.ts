/**
 * Module registry — config for the generic /m/[module] list + detail screens.
 *
 * The app is scoped to 8 domain modules (all with bespoke dedicated folders) +
 * Settings infra, so the ONLY registry-driven surface left is Employees (reached
 * from Settings → Team & roles). Everything else was removed with its module.
 */

import { titleCase } from "../lib/format";
import type { Tone } from "../theme";
import type { Badge } from "../lib/status";

type FeatherName = string;

export interface CardProps {
  icon: FeatherName;
  iconTone?: "brand" | "violet" | "success" | "warning" | "danger" | "info";
  title: string;
  subtitle?: string;
  badge?: Badge;
  badge2?: Badge;
  rightLabel?: string;
  rightValue?: string;
}

export interface DetailSpec {
  subtitle?: string;
  heroLabel?: string;
  heroValue?: string;
  badges?: { label: string; tone: Tone; dot?: boolean }[];
  fields?: { label: string; value?: string | null }[];
  sections?: { title: string; body?: string | null }[];
}

export interface ModuleConfig {
  title: string;
  endpoint: string;
  envelope: string;
  detailEnvelope?: string;
  unit?: [string, string];
  chips?: { key: string; label: string }[];
  card: (item: any) => CardProps;
  detail: (item: any) => DetailSpec;
  searchPlaceholder?: string;
  emptyIcon?: FeatherName;
  emptyTitle?: string;
  emptyMessage?: string;
  /** List-only module (no /[id] detail endpoint): the detail screen renders from
   *  the cached list item instead of fetching. */
  listOnly?: boolean;
}

export const REGISTRY: Record<string, ModuleConfig> = {
  employees: {
    title: "Employees",
    endpoint: "/api/employees",
    envelope: "rows",
    unit: ["employee", "employees"],
    searchPlaceholder: "Search team…",
    emptyIcon: "user-check",
    emptyTitle: "No employees",
    card: (e) => ({
      icon: "user-check",
      title: e.name ?? "Employee",
      subtitle: `${titleCase(e.department)}${Array.isArray(e.roles) ? ` · ${e.roles.map(titleCase).join(", ")}` : ""}`,
    }),
    detail: (e) => ({
      fields: [
        { label: "Email", value: e.email },
        { label: "Department", value: titleCase(e.department) },
        { label: "Roles", value: Array.isArray(e.roles) ? e.roles.map(titleCase).join(", ") : titleCase(e.roles) },
        { label: "Status", value: titleCase(e.status) },
        { label: "Phone", value: e.phone },
      ],
    }),
  },
};

/** Default filter: status chip + text search over the card's title + subtitle. */
export function defaultFilter(cfg: ModuleConfig, item: any, q: string, f: string): boolean {
  if (f && item.status !== f) return false;
  if (!q) return true;
  const c = cfg.card(item);
  return `${c.title} ${c.subtitle ?? ""}`.toLowerCase().includes(q.toLowerCase());
}
