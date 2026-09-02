/**
 * AI client brief — generates an advisory brief (summary, talking points,
 * recommended actions, watch-outs, a WhatsApp-safe opener) via Claude. Parity
 * with the web AiClientBrief. Advisory only — nothing persists.
 */

import React, { useEffect } from "react";
import { View, ScrollView, ActivityIndicator, Linking, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../../components/ui/Text";
import { Button } from "../../../components/ui/Button";
import { BottomSheet } from "../../../components/ui/BottomSheet";
import { palette, radius, spacing, fontWeight } from "../../../theme/tokens";
import { useGenerateBrief } from "./subfeatures";
import { openWhatsApp } from "../../activities/whatsapp";

const wa = (p?: string | null) => (p ? p.replace(/[^\d]/g, "").replace(/^0+/, "") : "");

export function AiBriefSheet({ id, visible, onClose, phone }: { id: string; visible: boolean; onClose: () => void; phone?: string | null }) {
  const gen = useGenerateBrief(id);
  useEffect(() => {
    if (visible && !gen.data && !gen.isPending) gen.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const brief = gen.data?.brief;

  return (
    <BottomSheet visible={visible} onClose={onClose} title="AI client brief">
      <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
        {gen.isPending ? (
          <View style={styles.center}><ActivityIndicator color={palette.brand} /><Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>Synthesising the brief…</Text></View>
        ) : gen.isError ? (
          <View style={styles.center}><Text tone="muted">Couldn't generate the brief.</Text><Button label="Retry" variant="secondary" onPress={() => gen.mutate()} style={{ marginTop: spacing.md }} /></View>
        ) : brief ? (
          <View>
            <Block title="Summary"><Text variant="body">{brief.summary}</Text></Block>
            <ListBlock title="Talking points" items={brief.talkingPoints} icon="message-square" />
            <ListBlock title="Recommended actions" items={brief.recommendedActions} icon="check-circle" tone={palette.success} />
            <ListBlock title="Watch-outs" items={brief.watchouts} icon="alert-triangle" tone={palette.warning} />
            {brief.suggestedOpener ? (
              <Block title="Suggested opener">
                <View style={styles.opener}><Text variant="caption">{brief.suggestedOpener}</Text></View>
                {phone ? <Button label="Send on WhatsApp" icon={<Feather name="message-circle" size={15} color="#fff" />} onPress={() => openWhatsApp({ phone, text: brief.suggestedOpener, subjectType: "investor", subjectId: id, purpose: "AI opener" })} full style={{ marginTop: spacing.sm }} /> : null}
              </Block>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text variant="label" tone="muted" style={{ letterSpacing: 0.5, marginBottom: spacing.xs }}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}
function ListBlock({ title, items, icon, tone }: { title: string; items: string[]; icon: string; tone?: string }) {
  if (!items?.length) return null;
  return (
    <Block title={title}>
      {items.map((it, i) => (
        <View key={i} style={styles.li}>
          <Feather name={icon as any} size={13} color={tone ?? palette.brand} style={{ marginTop: 2 }} />
          <Text variant="caption" style={{ flex: 1 }}>{it}</Text>
        </View>
      ))}
    </Block>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", paddingVertical: spacing.xl },
  li: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.xs },
  opener: { backgroundColor: palette.surfaceSunken, borderRadius: radius.md, padding: spacing.md },
});
