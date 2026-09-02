/**
 * Overview tab — client health score, the risk/nominee/KYC/review summary grid,
 * and the review-cadence editor (PATCHes reviewFrequency).
 */

import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import { Text } from "../../../components/ui/Text";
import { Button } from "../../../components/ui/Button";
import { Segmented } from "../../../components/ui/Segmented";
import { palette, radius, spacing, fontWeight } from "../../../theme/tokens";
import { inr, fmtDate, titleCase, timeAgo } from "../../../lib/format";
import { Section, FieldRow } from "./primitives";
import { useSetReviewCadence } from "../api";

const healthTone = (n: number) => (n >= 70 ? palette.success : n >= 40 ? palette.warning : palette.danger);
const CADENCE = [
  { key: "monthly", label: "Monthly" },
  { key: "quarterly", label: "Quarterly" },
  { key: "half_yearly", label: "Half-yearly" },
  { key: "annual", label: "Annual" },
];

export function OverviewTab({ d, id }: { d: any; id: string }) {
  const inv = d.investor ?? {};
  const score = inv.healthScore != null ? Number(inv.healthScore) : null;
  const missing: string[] = d.completeness?.missing ?? [];

  return (
    <View>
      {/* Client health */}
      <Section title="Client health" icon="heart">
        <View style={styles.healthRow}>
          <View style={[styles.gauge, { borderColor: score != null ? healthTone(score) : palette.line }]}>
            <Text style={{ fontSize: 26, fontWeight: fontWeight.bold as any, color: score != null ? healthTone(score) : palette.muted }}>{score ?? "—"}</Text>
            <Text variant="caption" tone="muted">/ 100</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: fontWeight.semibold as any }}>{inv.healthBand ? titleCase(inv.healthBand) : "Not scored"}</Text>
            <Text variant="caption" tone="muted">
              {inv.healthScoredAt ? `Scored ${timeAgo(inv.healthScoredAt)}` : "A blend of KYC, nominee, risk, review and activity signals."}
            </Text>
            {missing.length > 0 ? (
              <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>Gaps: {missing.slice(0, 4).join(", ")}</Text>
            ) : null}
          </View>
        </View>
      </Section>

      {/* Summary grid */}
      <Section title="Risk / nominee / KYC / review" icon="grid">
        <View style={styles.grid}>
          <SummaryCard label="Risk profile" value={inv.riskProfile ? titleCase(inv.riskProfile) : "Not assessed"} sub={inv.riskProfileSignedAt ? `Signed ${fmtDate(inv.riskProfileSignedAt)}` : "Pending"} />
          <SummaryCard label="Nominee" value={inv.nomineeName || "Not set"} sub={inv.nomineeRelation ? titleCase(inv.nomineeRelation) : "—"} />
          <SummaryCard label="CKYC expiry" value={fmtDate(inv.ckycExpiryAt)} sub={inv.ckycNumber || "No CKYC"} />
          <SummaryCard label="Last review" value={inv.lastReviewAt ? timeAgo(inv.lastReviewAt) : "Never"} sub={inv.nextReviewAt ? `Next ${fmtDate(inv.nextReviewAt)}` : "No next set"} />
        </View>
      </Section>

      <ReviewCadence id={id} current={inv.reviewFrequency} />

      {/* Financial snapshot */}
      <Section title="Financials" icon="dollar-sign">
        <FieldRow label="AUM" value={inr(inv.aum)} />
        <FieldRow label="Monthly SIP" value={inr(inv.activeSipAmount)} />
        <FieldRow label="Lifetime inflow" value={inr(inv.lifetimeInflow)} />
        <FieldRow label="Lifetime outflow" value={inr(inv.lifetimeOutflow)} />
        <FieldRow label="Total lumpsum" value={inr(d.totalLumpsum)} />
        <FieldRow label="Service tier" value={inv.serviceTier ? `Tier ${inv.serviceTier}` : "—"} />
      </Section>
    </View>
  );
}

function ReviewCadence({ id, current }: { id: string; current?: string }) {
  const [val, setVal] = useState<string>(current ?? "quarterly");
  const save = useSetReviewCadence(id);
  const changed = val !== (current ?? "");
  return (
    <Section title="Review cadence" icon="repeat">
      <Segmented<string> options={CADENCE} value={val} onChange={setVal} />
      <View style={{ height: spacing.md }} />
      <Button label="Update cadence" onPress={() => save.mutate({ reviewFrequency: val })} loading={save.isPending} disabled={!changed} full />
      {save.isSuccess && !changed ? <Text variant="caption" style={{ color: palette.success, marginTop: spacing.sm }}>Cadence updated — next review recalculated.</Text> : null}
    </Section>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <View style={styles.sum}>
      <Text variant="caption" tone="muted">{label}</Text>
      <Text style={{ fontWeight: fontWeight.semibold as any }} numberOfLines={1}>{value}</Text>
      <Text variant="caption" tone="faint" numberOfLines={1}>{sub}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  healthRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  gauge: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, alignItems: "center", justifyContent: "center", backgroundColor: palette.surfaceAlt },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  sum: { width: "47%", flexGrow: 1, backgroundColor: palette.surfaceAlt, borderRadius: radius.sm, padding: spacing.md },
});
