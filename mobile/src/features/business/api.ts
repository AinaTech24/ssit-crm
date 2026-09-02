/**
 * Business dashboard data layer — the owner/manager view of the firm's business.
 * Composes the scope-aware endpoints the web owner cockpit is built on:
 *   - /api/dashboard/home            headline KPIs (AUM, clients, SIP book, leads)
 *   - /api/reports/net-sales         gross / redemption / net business this month
 *   - /api/reports/sip-health        SIP-book health (live, fresh, stopped, bounced)
 *   - /api/portfolio-intelligence    AUM composition (asset class, AMC, direct-plan)
 *   - /api/dashboard/widgets/[key]   individually-addressable business widgets
 *
 * All are firm-wide for managers (owner/branch_head/ops/…) and own-book for RMs,
 * so the same screen serves both — the numbers just scope down for a field RM.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { Kpi } from "../dashboard/api";

/** Current month as YYYY-MM (local — never toISOString, which shifts in IST). */
export function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── Headline KPIs (reuse the home endpoint) ──
export interface HomeKpis { scope: "firm" | "me"; kpis: Kpi[] }
export function useBusinessKpis() {
  return useQuery({
    queryKey: ["dashboard-home"],
    queryFn: () => api.get<HomeKpis>("/api/dashboard/home"),
    staleTime: 60_000,
  });
}

// ── Net sales (gross / redemption / net) ──
export interface NetSalesTotal { gross: number; redemption: number; net: number }
export interface NetSales { period: string; productType: string; total: NetSalesTotal; rows: any[] }
export function useNetSales(period: string) {
  return useQuery({
    queryKey: ["net-sales", period],
    queryFn: () => api.get<NetSales>("/api/reports/net-sales", { product: "__all__", period }),
    staleTime: 120_000,
    retry: false,
  });
}

// ── SIP book health ──
export interface SipHealth {
  period: string;
  liveSip: { amount: number; count: number };
  fresh: { amount: number; count: number };
  stopped: { amount: number; count: number };
  netSip: number;
  maturing: { amount: number; count: number };
  bounced: { amount: number; count: number };
}
export function useSipHealth(period: string) {
  return useQuery({
    queryKey: ["sip-health", period],
    queryFn: () => api.get<SipHealth>("/api/reports/sip-health", { period }),
    staleTime: 120_000,
    retry: false,
  });
}

// ── Portfolio intelligence (AUM composition) ──
export interface PiSlice { label: string; value: number; pct: number }
export interface PiScheme { scheme: string; amc: string | null; klass: string; value: number; pct: number }
export interface PortfolioIntel {
  totalAum: number; folioCount: number; investorCount: number;
  byClass: PiSlice[]; byAmc: PiSlice[]; topSchemes: PiScheme[];
  warnings: { level: string; text: string }[];
  directPlanPct: number; coveragePct: number;
  concentratedClients: { id: string; name: string; reason: string; pct: number; aum: number }[];
  scope: string; canFirm: boolean;
}
export function usePortfolioIntel() {
  return useQuery({
    queryKey: ["portfolio-intel"],
    queryFn: () => api.get<PortfolioIntel>("/api/portfolio-intelligence"),
    staleTime: 120_000,
    retry: false,
  });
}

// ── Generic widget (self-describing: {key,title,type,view,rows}) ──
export interface WidgetView { kind: string; columns?: { key: string; label: string; format?: string }[]; labelKey?: string; valueKey?: string; format?: string; [k: string]: any }
export interface Widget { key: string; title: string; type: string; view: WidgetView; rows: any[] }
export function useWidget(key: string, enabled = true) {
  return useQuery({
    queryKey: ["widget", key],
    queryFn: () => api.get<Widget>(`/api/dashboard/widgets/${key}`),
    staleTime: 120_000,
    enabled,
    retry: false,
  });
}

// ── Efforts (plan vs actual leading activities) ──
export interface EffortRow { key: string; label: string; auto: boolean; planned: number; actual: number; computed: number | null }
export interface Efforts { period: string; rows: EffortRow[] }
export function useEfforts(period: string) {
  return useQuery({
    queryKey: ["efforts", period],
    queryFn: () => api.get<Efforts>("/api/reports/efforts", { period }),
    staleTime: 120_000,
    retry: false,
  });
}

/** Previous month as YYYY-MM. */
export function prevPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export const num = (v: unknown): number => { const n = Number(v ?? 0); return isFinite(n) ? n : 0; };
