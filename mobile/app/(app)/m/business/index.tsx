/**
 * Business Dashboard — the owner/manager view of the firm's business health.
 * Headline KPIs → this month's business (net sales + SIP health) → AUM
 * composition (asset class / AMC / direct-plan) → business by product → RM
 * leaderboard. Firm-wide for managers, own-book for RMs (the endpoints scope
 * themselves). Numbers that need transaction/entry data show empty states in a
 * fresh book rather than a misleading zero-tile.
 */

import React from "react";
import { View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Screen } from "../../../../src/components/ui/Screen";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { Skeleton } from "../../../../src/components/ui/Skeleton";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import {
  useBusinessKpis, useNetSales, useSipHealth, usePortfolioIntel, useWidget,
  currentPeriod, num, type PiSlice,
} from "../../../../src/features/business/api";
import { type Kpi } from "../../../../src/features/dashboard/api";
import { inr, titleCase } from "../../../../src/lib/format";
import { spacing, palette, radius, fontWeight } from "../../../../src/theme/tokens";
import { toneColors, type Tone } from "../../../../src/theme";

const CLASS_COLORS = ["#2563EB", "#7C3AED", "#16A34A", "#D97706", "#DC2626", "#0EA5E9", "#DB2777", "#64748B"];

export default function BusinessDashboard() {
  const period = React.useMemo(() => currentPeriod(), []);
  const kpis = useBusinessKpis();
  const netSales = useNetSales(period);
  const sip = useSipHealth(period);
  const pi = usePortfolioIntel();
  const rmBoard = useWidget("table_rm_business");
  const byProduct = useWidget("chart_business_by_product");

  const refetch = () => { kpis.refetch(); netSales.refetch(); sip.refetch(); pi.refetch(); rmBoard.refetch(); byProduct.refetch(); };
  const refreshing = kpis.isRefetching || netSales.isRefetching || pi.isRefetching;

  const byKey = (k: string): Kpi | undefined => kpis.data?.kpis.find((x) => x.key === k);
  const fmtKpi = (k?: Kpi) => (k ? (k.format === "inr" ? inr(k.value) : k.value.toLocaleString("en-IN")) : "—");
  const scope = kpis.data?.scope === "me" ? "Your book" : "Firm-wide";

  const ns = netSales.data?.total;
  const sh = sip.data;
  const periodLabel = new Date(period + "-01").toLocaleString("en-IN", { month: "long", year: "numeric" });

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="Business" subtitle={scope} />
      <Screen scroll padded onRefresh={refetch} refreshing={refreshing} contentStyle={{ paddingTop: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {/* Headline KPIs */}
        {kpis.isLoading ? (
          <Card><Skeleton width="40%" height={14} /><Skeleton width="60%" height={30} style={{ marginTop: 8 }} /></Card>
        ) : (
          <Card>
            <Text variant="caption" tone="faint">TOTAL AUM</Text>
            <Text style={styles.hero}>{fmtKpi(byKey("aum"))}</Text>
            <View style={styles.kpiRow}>
              <Kpi label="Clients" value={fmtKpi(byKey("clients"))} />
              <View style={styles.vline} />
              <Kpi label="Monthly SIP" value={fmtKpi(byKey("sipBook"))} />
              <View style={styles.vline} />
              <Kpi label="Open Leads" value={fmtKpi(byKey("leadsOpen"))} />
            </View>
          </Card>
        )}

        {/* This month's business */}
        <SectionLabel icon="bar-chart-2" text={`BUSINESS · ${periodLabel.toUpperCase()}`} />
        <Card>
          {netSales.isLoading || sip.isLoading ? (
            <Skeleton width="100%" height={60} />
          ) : (
            <>
              <View style={styles.threeUp}>
                <Big label="Gross" value={inr(num(ns?.gross))} tone="neutral" />
                <Big label="Redemption" value={inr(num(ns?.redemption))} tone="warning" />
                <Big label="Net business" value={inr(num(ns?.net))} tone={num(ns?.net) >= 0 ? "success" : "danger"} />
              </View>
              {sh ? (
                <View style={styles.sipRow}>
                  <Mini label="Net SIP" value={inr(num(sh.netSip))} />
                  <Mini label="Fresh SIP" value={`${inr(num(sh.fresh?.amount))} · ${num(sh.fresh?.count)}`} />
                  <Mini label="Bounced" value={String(num(sh.bounced?.count))} tone={num(sh.bounced?.count) > 0 ? "danger" : "neutral"} />
                </View>
              ) : null}
              {num(ns?.gross) === 0 && num(ns?.net) === 0 ? (
                <Text variant="caption" tone="faint" style={{ marginTop: spacing.sm }}>No business booked in this period yet.</Text>
              ) : null}
            </>
          )}
        </Card>

        {/* AUM composition */}
        <SectionLabel icon="pie-chart" text="AUM COMPOSITION" />
        <Card>
          {pi.isLoading ? (
            <Skeleton width="100%" height={80} />
          ) : num(pi.data?.totalAum) === 0 || (pi.data?.byClass.length ?? 0) === 0 ? (
            <EmptyRow icon="pie-chart" text="Asset-class mix appears once folio holdings are imported." />
          ) : (
            <>
              {(pi.data?.byClass ?? []).slice(0, 6).map((c, i) => <Bar key={c.label} slice={c} color={CLASS_COLORS[i % CLASS_COLORS.length]} />)}
              <View style={styles.piMeta}>
                <Mini label="Direct-plan" value={`${Math.round(num(pi.data?.directPlanPct))}%`} />
                <Mini label="Top AMC" value={pi.data?.byAmc[0]?.label ? `${pi.data.byAmc[0].label} · ${Math.round(pi.data.byAmc[0].pct)}%` : "—"} />
              </View>
              {(pi.data?.warnings ?? []).slice(0, 2).map((w, i) => (
                <View key={i} style={styles.warn}><Feather name="alert-triangle" size={13} color={toneColors("warning").fg} /><Text variant="caption" style={{ color: palette.ink, flex: 1 }}>{w.text}</Text></View>
              ))}
            </>
          )}
        </Card>

        {/* Business by product */}
        <SectionLabel icon="grid" text="BUSINESS BY PRODUCT" />
        <Card>
          {byProduct.isLoading ? (
            <Skeleton width="100%" height={40} />
          ) : (byProduct.data?.rows.length ?? 0) === 0 ? (
            <EmptyRow icon="grid" text="Booked business splits by product here (MF / PMS / AIF / insurance)." />
          ) : (
            (() => {
              const rows = (byProduct.data?.rows ?? []).map((r: any) => ({ label: String(r[byProduct.data!.view.labelKey ?? "label"]), value: num(r[byProduct.data!.view.valueKey ?? "value"]) }));
              const max = Math.max(...rows.map((r) => r.value), 1);
              return rows.map((r, i) => <Bar key={r.label} slice={{ label: titleCase(r.label.replace(/_/g, " ")), value: r.value, pct: (r.value / max) * 100 }} color={CLASS_COLORS[i % CLASS_COLORS.length]} showInr />);
            })()
          )}
        </Card>

        {/* RM leaderboard */}
        <SectionLabel icon="award" text={rmBoard.data?.title?.toUpperCase() ?? "RM LEADERBOARD"} />
        <Card flat style={{ padding: 0, overflow: "hidden" }}>
          {rmBoard.isLoading ? (
            <View style={{ padding: spacing.lg }}><Skeleton width="100%" height={40} /></View>
          ) : (rmBoard.data?.rows.length ?? 0) === 0 ? (
            <EmptyRow icon="award" text="Per-RM business appears once the team books business." />
          ) : (
            [...(rmBoard.data?.rows ?? [])]
              .sort((a: any, b: any) => num(b.aum) - num(a.aum))
              .map((r: any, i: number, arr: any[]) => (
                <View key={r.rm_name + i} style={[styles.rmRow, i < arr.length - 1 && styles.divider]}>
                  <View style={[styles.rank, i === 0 && { backgroundColor: toneColors("success").bg }]}><Text variant="caption" style={{ fontWeight: fontWeight.bold as any, color: i === 0 ? toneColors("success").fg : palette.muted }}>{i + 1}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text variant="body" numberOfLines={1}>{r.rm_name}</Text>
                    <Text variant="caption" tone="muted">{num(r.clients)} clients · {inr(num(r.sip_book))} SIP</Text>
                  </View>
                  <Text variant="body" style={{ fontWeight: fontWeight.semibold as any }}>{inr(num(r.aum))}</Text>
                </View>
              ))
          )}
        </Card>
      </Screen>
    </View>
  );
}

// ── bits ──
function Kpi({ label, value }: { label: string; value: string }) {
  return <View style={{ flex: 1, alignItems: "center" }}><Text style={{ fontSize: 16, fontWeight: fontWeight.bold as any }} numberOfLines={1}>{value}</Text><Text variant="caption" tone="muted">{label}</Text></View>;
}
function Big({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return <View style={{ flex: 1 }}><Text variant="caption" tone="muted" numberOfLines={1}>{label}</Text><Text style={{ fontSize: 15, fontWeight: fontWeight.bold as any, color: toneColors(tone).fg }} numberOfLines={1}>{value}</Text></View>;
}
function Mini({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  return <View style={{ flex: 1 }}><Text variant="caption" tone="faint" numberOfLines={1}>{label}</Text><Text variant="caption" style={{ fontWeight: fontWeight.semibold as any, color: tone ? toneColors(tone).fg : palette.ink }} numberOfLines={1}>{value}</Text></View>;
}
function Bar({ slice, color, showInr }: { slice: PiSlice; color: string; showInr?: boolean }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>{slice.label}</Text>
        <Text variant="caption" style={{ fontWeight: fontWeight.semibold as any, color: palette.ink }}>{showInr ? inr(slice.value) : `${Math.round(slice.pct)}%`}</Text>
      </View>
      <View style={styles.track}><View style={[styles.fill, { width: `${Math.min(100, Math.max(2, slice.pct))}%`, backgroundColor: color }]} /></View>
    </View>
  );
}
function SectionLabel({ icon, text }: { icon: any; text: string }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.xl, marginBottom: spacing.sm }}><Feather name={icon} size={13} color={palette.muted} /><Text variant="caption" tone="faint" style={{ letterSpacing: 0.6 }}>{text}</Text></View>;
}
function EmptyRow({ icon, text }: { icon: any; text: string }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md }}><Feather name={icon} size={18} color={palette.faint} /><Text variant="caption" tone="muted" style={{ flex: 1 }}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  hero: { fontSize: 32, fontWeight: fontWeight.bold as any, letterSpacing: -0.5, marginTop: 4 },
  kpiRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
  vline: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: palette.line },
  threeUp: { flexDirection: "row", gap: spacing.md },
  sipRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
  piMeta: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
  warn: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  track: { height: 8, borderRadius: 4, backgroundColor: palette.surfaceSunken, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
  rmRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  rank: { width: 26, height: 26, borderRadius: radius.pill, backgroundColor: palette.surfaceSunken, alignItems: "center", justifyContent: "center" },
});
