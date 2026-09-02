/**
 * LeadCard — one lead. Two densities: full (list) and compact (board column).
 * Shows score band, canonical stage, intended amount, follow-up, and owner (RM).
 */

import React from "react";
import { View, StyleSheet } from "react-native";
import { Card } from "../ui/Card";
import { Text } from "../ui/Text";
import { StatusPill } from "../ui/StatusPill";
import { palette, radius, spacing, fontWeight } from "../../theme/tokens";
import { inr, initials, titleCase, fmtDate } from "../../lib/format";
import { stageMeta, type Lead } from "../../features/leads/api";

const BAND_TONE: Record<string, string> = { hot: palette.danger, warm: palette.warning, cold: palette.muted };

function BandChip({ band }: { band?: string | null }) {
  if (!band) return null;
  const c = BAND_TONE[band] ?? palette.muted;
  return (
    <View style={[styles.band, { backgroundColor: c + "1A" }]}>
      <Text style={{ fontSize: 10.5, color: c, fontWeight: fontWeight.bold as any }}>{band.toUpperCase()}</Text>
    </View>
  );
}

export function LeadCard({ lead, onPress, compact }: { lead: Lead; onPress: () => void; compact?: boolean }) {
  const meta = stageMeta(lead.stage);
  const overdue = !!lead.nextFollowUpAt && new Date(lead.nextFollowUpAt).getTime() < Date.now() && !lead.convertedAt;
  const amount = lead.intendedAmount ?? lead.expectedBusinessAmount;

  if (compact) {
    return (
      <Card onPress={onPress} style={styles.compact} padded={false}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
          <Text variant="label" numberOfLines={1} style={{ flex: 1 }}>{lead.name ?? "Lead"}</Text>
          <BandChip band={lead.scoreBand} />
        </View>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {amount ? `${inr(amount)} · ` : ""}{titleCase(lead.source)}
        </Text>
        {overdue ? <StatusPill label="Overdue" tone="danger" size="sm" dot={false} /> : null}
      </Card>
    );
  }

  return (
    <Card onPress={onPress} style={{ marginBottom: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={styles.avatar}>
          <Text style={{ color: palette.brandDark, fontWeight: "700" }}>{initials(lead.name)}</Text>
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="subtitle" numberOfLines={1}>{lead.name ?? "Lead"}</Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {titleCase(lead.source) || "—"}{lead.city ? ` · ${lead.city}` : ""}{lead.ownerName ? ` · RM ${lead.ownerName}` : ""}
          </Text>
          <View style={styles.badges}>
            <BandChip band={lead.scoreBand} />
            {meta ? <StatusPill label={meta.label} tone={meta.tone} size="sm" /> : null}
            {overdue ? <StatusPill label="Overdue" tone="danger" size="sm" dot={false} /> : null}
          </View>
        </View>
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          <Text variant="caption" tone="faint">Intended</Text>
          <Text variant="subtitle">{inr(amount)}</Text>
          {lead.nextFollowUpAt ? <Text variant="caption" tone={overdue ? "danger" : "muted"}>{fmtDate(lead.nextFollowUpAt)}</Text> : null}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 46, height: 46, borderRadius: radius.pill, backgroundColor: palette.brandLight, alignItems: "center", justifyContent: "center" },
  badges: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap", marginTop: 2, alignItems: "center" },
  band: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill },
  compact: { marginBottom: spacing.sm, padding: spacing.md, gap: 4, width: 210 },
});
