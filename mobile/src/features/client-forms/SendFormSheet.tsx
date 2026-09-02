/**
 * Send-a-form sheet — the field RM's "I'll WhatsApp you the form now" moment.
 * Pick a form, it mints the login-free link and sends via the comms pipeline,
 * then reports the REAL per-channel outcome. When a proactive WhatsApp is
 * skipped (Meta's 24h window), the wa.me fallback is offered right there so the
 * RM is never stuck — that is the whole point of showing the result honestly.
 */

import React from "react";
import { View, Pressable, Linking, StyleSheet, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../components/ui/Text";
import { BottomSheet } from "../../components/ui/BottomSheet";
import { useSendClientForm, CLIENT_FORMS, type FormKind, type SendFormResult } from "./api";
import { toast } from "../../lib/toast";
import { spacing, palette, radius, fontWeight } from "../../theme/tokens";
import { toneColors } from "../../theme";

export function SendFormSheet({
  visible, onClose, subjectType, subjectId, name,
}: {
  visible: boolean;
  onClose: () => void;
  subjectType: "investor" | "lead";
  subjectId: string;
  name?: string | null;
}) {
  const send = useSendClientForm();
  const [result, setResult] = React.useState<SendFormResult | null>(null);
  const [sending, setSending] = React.useState<FormKind | null>(null);

  React.useEffect(() => { if (visible) { setResult(null); setSending(null); } }, [visible]);

  const go = (kind: FormKind) => {
    setSending(kind);
    send.mutate(
      { subjectType, subjectId, kind },
      {
        onSuccess: (r) => {
          setResult(r);
          if (r.ok) toast.success(`${r.label} sent`);
        },
        onError: (e: any) => toast.error(e?.body?.error || "Couldn't send that"),
        onSettled: () => setSending(null),
      }
    );
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={name ? `Send to ${name}` : "Send a form"}>
      {result ? (
        <View>
          <View style={[styles.resultBox, { backgroundColor: toneColors(result.ok ? "success" : "warning").bg }]}>
            <Feather name={result.ok ? "check-circle" : "alert-circle"} size={16} color={toneColors(result.ok ? "success" : "warning").fg} />
            <View style={{ flex: 1 }}>
              <Text variant="body" style={{ fontWeight: fontWeight.semibold as any }}>{result.label}</Text>
              <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>{result.summary}</Text>
            </View>
          </View>

          {/* Explains WHY it fell back, and that it self-corrects next time. */}
          {result.templateNote ? (
            <View style={styles.noteRow}>
              <Feather name="info" size={13} color={palette.muted} />
              <Text variant="caption" tone="muted" style={{ flex: 1 }}>{result.templateNote}</Text>
            </View>
          ) : null}

          {/* The fallback that keeps the RM moving when a proactive send is gated. */}
          {!result.whatsapped && result.waMeUrl ? (
            <Pressable style={[styles.btn, { backgroundColor: palette.success }]} onPress={() => Linking.openURL(result.waMeUrl!).catch(() => {})}>
              <Feather name="message-circle" size={16} color={palette.white} />
              <Text style={styles.btnTxt}>Send from my WhatsApp</Text>
            </Pressable>
          ) : null}

          <Pressable style={[styles.btn, { backgroundColor: palette.surfaceSunken }]} onPress={() => Linking.openURL(result.url).catch(() => {})}>
            <Feather name="external-link" size={15} color={palette.ink} />
            <Text style={[styles.btnTxt, { color: palette.ink }]}>Open the link</Text>
          </Pressable>

          <Pressable style={{ alignSelf: "center", padding: spacing.md }} onPress={() => setResult(null)}>
            <Text variant="caption" style={{ color: palette.brand, fontWeight: fontWeight.semibold as any }}>Send another</Text>
          </Pressable>
        </View>
      ) : (
        <View>
          <Text variant="caption" tone="muted" style={{ marginBottom: spacing.md }}>
            Sends a secure, login-free link by WhatsApp and email.
          </Text>
          {CLIENT_FORMS.map((f) => (
            <Pressable key={f.kind} style={styles.row} onPress={() => go(f.kind)} disabled={!!sending}>
              <View style={styles.icon}><Feather name={f.icon as any} size={16} color={palette.brand} /></View>
              <View style={{ flex: 1 }}>
                <Text variant="body">{f.label}</Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>{f.blurb}</Text>
              </View>
              {sending === f.kind ? <ActivityIndicator size="small" color={palette.brand} /> : <Feather name="chevron-right" size={16} color={palette.faint} />}
            </Pressable>
          ))}
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft },
  icon: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: palette.brandLight, alignItems: "center", justifyContent: "center" },
  resultBox: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, borderRadius: radius.md, padding: spacing.md },
  noteRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginTop: spacing.md },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.md },
  btnTxt: { color: palette.white, fontWeight: fontWeight.semibold as any },
});
