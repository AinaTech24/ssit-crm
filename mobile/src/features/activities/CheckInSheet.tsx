/**
 * Check-in sheet — the field rep's "I'm at the client" action. Captures GPS,
 * lets them pick who they're visiting (client or lead) and add a quick note,
 * then logs a `visit` activity stamped with location. Location is best-effort:
 * if it's unavailable the visit still logs, just without coordinates.
 */

import React from "react";
import { View, Pressable, ScrollView, ActivityIndicator, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../components/ui/Text";
import { TextField } from "../../components/ui/TextField";
import { SearchBar } from "../../components/ui/SearchBar";
import { BottomSheet } from "../../components/ui/BottomSheet";
import { useSearch } from "../search/api";
import { useLogActivity } from "./api";
import { getCheckinLocation, type CheckinLocation } from "./checkin";
import { toast } from "../../lib/toast";
import { spacing, palette, radius, fontWeight } from "../../theme/tokens";
import { toneColors } from "../../theme";

type Who = { type: "investor" | "lead"; id: string; name: string; phone?: string | null };

export function CheckInSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [who, setWho] = React.useState<Who | null>(null);
  const [q, setQ] = React.useState("");
  const [note, setNote] = React.useState("");
  const [loc, setLoc] = React.useState<CheckinLocation | null>(null);
  const [locating, setLocating] = React.useState(false);
  const search = useSearch(q);
  const log = useLogActivity();

  // Grab location as soon as the sheet opens — it's the slow part.
  React.useEffect(() => {
    if (visible) {
      setWho(null); setQ(""); setNote(""); setLoc(null);
      setLocating(true);
      getCheckinLocation().then((l) => setLoc(l)).finally(() => setLocating(false));
    }
  }, [visible]);

  const submit = () => {
    if (!who) return toast.error("Pick who you're visiting");
    log.mutate(
      {
        subjectType: who.type, subjectId: who.id, kind: "visit", status: "completed",
        subject: `Visit — ${who.name}`, notes: note.trim() || undefined,
        ...(loc ? { geoLat: loc.lat, geoLng: loc.lng, locationLabel: loc.label ?? undefined } : {}),
      },
      {
        onSuccess: () => { toast.success(`Checked in with ${who.name}`); onClose(); },
        onError: (e: any) => toast.error(e?.body?.error || "Couldn't log the visit"),
      }
    );
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Check in">
      {/* Location status */}
      <View style={[styles.locBar, { backgroundColor: loc ? toneColors("success").bg : palette.surfaceSunken }]}>
        <Feather name="map-pin" size={15} color={loc ? toneColors("success").fg : palette.muted} />
        <Text variant="caption" style={{ flex: 1, color: palette.ink }} numberOfLines={1}>
          {locating ? "Getting your location…" : loc ? (loc.label ?? `${loc.lat}, ${loc.lng}`) : "Location unavailable — visit will log without it"}
        </Text>
        {locating ? <ActivityIndicator size="small" color={palette.brand} /> : null}
      </View>

      {who ? (
        <Pressable style={styles.whoRow} onPress={() => setWho(null)}>
          <View style={styles.avatar}><Text style={{ color: palette.white, fontWeight: fontWeight.bold as any }}>{who.name.slice(0, 1).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}><Text variant="body">{who.name}</Text><Text variant="caption" tone="muted">{who.type === "investor" ? "Client" : "Lead"}</Text></View>
          <Feather name="x" size={16} color={palette.faint} />
        </Pressable>
      ) : (
        <>
          <SearchBar value={q} onChangeText={setQ} placeholder="Who are you visiting?" />
          <ScrollView style={{ maxHeight: 220, marginTop: spacing.sm }} keyboardShouldPersistTaps="handled">
            {(search.data?.investors ?? []).map((i) => (
              <PickRow key={`i-${i.id}`} name={i.name} sub={`Client${i.phone ? " · " + i.phone : ""}`} tone={palette.violet} onPress={() => setWho({ type: "investor", id: i.id, name: i.name, phone: i.phone })} />
            ))}
            {(search.data?.leads ?? []).map((l) => (
              <PickRow key={`l-${l.id}`} name={l.name} sub={`Lead${l.phone ? " · " + l.phone : ""}`} tone={palette.brand} onPress={() => setWho({ type: "lead", id: l.id, name: l.name, phone: l.phone })} />
            ))}
          </ScrollView>
        </>
      )}

      {who ? (
        <>
          <View style={{ height: spacing.md }} />
          <TextField label="Notes (optional)" value={note} onChangeText={setNote} multiline placeholder="What was discussed on the visit…" />
          <Pressable style={styles.submit} onPress={submit} disabled={log.isPending}>
            <Feather name="check-circle" size={16} color={palette.white} />
            <Text style={{ color: palette.white, fontWeight: fontWeight.semibold as any }}>{log.isPending ? "Logging…" : "Log visit"}</Text>
          </Pressable>
        </>
      ) : null}
    </BottomSheet>
  );
}

function PickRow({ name, sub, tone, onPress }: { name: string; sub: string; tone: string; onPress: () => void }) {
  return (
    <Pressable style={styles.pickRow} onPress={onPress}>
      <View style={[styles.avatar, { backgroundColor: tone }]}><Text style={{ color: palette.white, fontWeight: fontWeight.bold as any, fontSize: 12 }}>{name.slice(0, 1).toUpperCase()}</Text></View>
      <View style={{ flex: 1 }}><Text variant="body" numberOfLines={1}>{name}</Text><Text variant="caption" tone="muted">{sub}</Text></View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  locBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.md },
  whoRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: spacing.md },
  pickRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft },
  avatar: { width: 34, height: 34, borderRadius: radius.pill, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center" },
  submit: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: palette.success, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.md },
});
