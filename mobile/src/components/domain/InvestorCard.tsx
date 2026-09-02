/**
 * InvestorCard — one client in the Clients list, mirroring the web table columns:
 * avatar + health dot, name, PAN · city, segment / category / tier / status / KYC
 * badges, and AUM + monthly SIP + health score. Tap opens the 360° detail;
 * long-press raises row actions (edit / delete).
 */

import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { Card } from "../ui/Card";
import { Text } from "../ui/Text";
import { StatusPill } from "../ui/StatusPill";
import { palette, radius, spacing, fontWeight } from "../../theme/tokens";
import { inr, initials, titleCase } from "../../lib/format";
import { investorStatusBadge, kycBadge } from "../../lib/status";
import type { Investor } from "../../features/investors/api";

const HEALTH_DOT: Record<string, string> = { green: palette.success, amber: palette.warning, red: palette.danger };
const SEGMENT_TONE: Record<string, string> = { HNI: palette.violet, Affluent: palette.success, Retail: palette.info, NRI: palette.warning, Corporate: palette.brand };

function MiniBadge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.mini, { backgroundColor: color + "1A" }]}>
      <Text style={{ fontSize: 10.5, color, fontWeight: fontWeight.semibold as any }}>{label}</Text>
    </View>
  );
}

export function InvestorCard({ investor, onPress, onLongPress }: { investor: Investor; onPress: () => void; onLongPress?: () => void }) {
  const status = investorStatusBadge(investor.status);
  const kyc = kycBadge(investor.kycStatus);
  const health = investor.healthBand;
  const sip = investor.activeSipAmount != null ? Number(investor.activeSipAmount) : 0;

  return (
    <Card onPress={onPress} onLongPress={onLongPress} style={styles.card}>
      <View style={styles.row}>
        <View style={styles.avatar}>
          <Text style={{ color: palette.brandDark, fontWeight: "700" }}>{initials(investor.name)}</Text>
          {health ? <View style={[styles.dot, { backgroundColor: HEALTH_DOT[health] ?? palette.faint }]} /> : null}
        </View>

        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="subtitle" numberOfLines={1}>{investor.name}</Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {investor.pan ?? "PAN —"}
            {investor.city ? ` · ${investor.city}` : ""}
          </Text>
          <View style={styles.badges}>
            {investor.segmentTag ? <MiniBadge label={investor.segmentTag} color={SEGMENT_TONE[investor.segmentTag] ?? palette.muted} /> : null}
            {investor.clientCategory ? <MiniBadge label={`Cat ${investor.clientCategory}`} color={palette.ink70} /> : null}
            {investor.serviceTier ? <MiniBadge label={`Tier ${investor.serviceTier}`} color={palette.brand} /> : null}
            <StatusPill label={status.label} tone={status.tone} size="sm" />
            <StatusPill label={kyc.label} tone={kyc.tone} size="sm" dot={false} />
          </View>
        </View>

        <View style={{ alignItems: "flex-end", gap: 2 }}>
          <Text variant="caption" tone="faint">AUM</Text>
          <Text variant="subtitle">{inr(investor.aum)}</Text>
          {sip > 0 ? <Text variant="caption" tone="muted">{inr(sip)}/mo</Text> : null}
          {investor.healthScore != null ? (
            <Text variant="caption" tone="faint">Health {investor.healthScore}</Text>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: { width: 46, height: 46, borderRadius: radius.pill, backgroundColor: palette.brandLight, alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: palette.surface },
  badges: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap", marginTop: 2, alignItems: "center" },
  mini: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill },
});
