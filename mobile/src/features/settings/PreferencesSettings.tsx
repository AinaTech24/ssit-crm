/**
 * App preferences — per-device behaviour for THIS user, not firm config. Stored
 * locally, so switching phones doesn't carry them over (deliberate: they
 * describe how you work on this handset).
 */

import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Screen } from "../../components/ui/Screen";
import { Card } from "../../components/ui/Card";
import { Text } from "../../components/ui/Text";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { Segmented } from "../../components/ui/Segmented";
import { usePrefs } from "../../state/prefs";
import { ACTIVITY_OUTCOMES } from "../activities/api";
import { toast } from "../../lib/toast";
import { spacing, palette, radius, fontWeight } from "../../theme/tokens";
import { toneColors } from "../../theme";

export function PreferencesSettings() {
  const autoLogCalls = usePrefs((s) => s.autoLogCalls);
  const autoLogOutcome = usePrefs((s) => s.autoLogOutcome);
  const setPref = usePrefs((s) => s.set);

  const toggleAuto = () => {
    const next = !autoLogCalls;
    setPref("autoLogCalls", next);
    toast.success(next ? "Calls will log automatically" : "You'll be asked after each call");
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="App preferences" subtitle="Just for this device" />
      <Screen scroll padded contentStyle={{ paddingTop: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text variant="caption" tone="faint" style={styles.label}>CALL LOGGING</Text>

        <Card flat>
          <Pressable style={styles.row} onPress={toggleAuto} accessibilityRole="switch" accessibilityState={{ checked: autoLogCalls }}>
            <View style={{ flex: 1 }}>
              <Text variant="body" style={{ fontWeight: fontWeight.semibold as any }}>Log calls automatically</Text>
              <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                {autoLogCalls
                  ? "Calls you place from the app are logged the moment you return — no prompt."
                  : "You'll be asked to log each call when you return to the app."}
              </Text>
            </View>
            <View style={[styles.switch, autoLogCalls && styles.switchOn]}>
              <View style={[styles.knob, autoLogCalls && styles.knobOn]} />
            </View>
          </Pressable>

          {autoLogCalls ? (
            <View style={styles.sub}>
              <Text variant="caption" tone="muted" style={{ marginBottom: spacing.xs }}>Record the outcome as</Text>
              <Segmented
                options={ACTIVITY_OUTCOMES.slice(0, 3).map((o) => ({ key: o.value, label: o.label }))}
                value={autoLogOutcome}
                onChange={(v) => setPref("autoLogOutcome", v)}
              />
              <Text variant="caption" tone="faint" style={{ marginTop: spacing.sm }}>
                Duration is measured from when you tapped call to when you came back, so it includes ringing. Open the call from
                Calls to correct it or add what was discussed.
              </Text>
            </View>
          ) : null}
        </Card>

        {/* Being straight about the limits beats a surprise later. */}
        <View style={styles.note}>
          <Feather name="info" size={13} color={toneColors("info").fg} />
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            Only calls placed from inside the app are detected. Calls dialled from your phone's own dialer can't be captured —
            reading the device call log needs a special build and isn't possible on iPhone at all.
          </Text>
        </View>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { letterSpacing: 0.6, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  switch: { width: 46, height: 27, borderRadius: 14, backgroundColor: palette.line, padding: 3, justifyContent: "center" },
  switchOn: { backgroundColor: palette.brand },
  knob: { width: 21, height: 21, borderRadius: 11, backgroundColor: palette.white },
  knobOn: { alignSelf: "flex-end" },
  sub: { marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
  note: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginTop: spacing.lg, backgroundColor: palette.surface, borderRadius: radius.md, padding: spacing.md },
});
