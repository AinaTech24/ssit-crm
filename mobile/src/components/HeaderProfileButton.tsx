/**
 * HeaderProfileButton — the avatar button that sits in the TOP HEADER (navbar)
 * right side. Tapping it opens a profile menu with the multiple profile options
 * (Profile · Organisation profile · Firm profile). This replaces the profile
 * card that used to live in the sidebar.
 */

import React, { useState } from "react";
import { View, Image, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { palette, spacing, radius, fontWeight } from "../theme/tokens";
import { useBrand } from "../theme/brand";
import { Text } from "./ui/Text";
import { BottomSheet } from "./ui/BottomSheet";
import { useMe } from "../api/me";
import { absUrl } from "../api/client";
import { useSession } from "../state/session";
import { confirmDelete } from "../lib/confirm";
import { initials } from "../lib/format";

const PROFILE_MENU: { icon: string; label: string; route: string }[] = [
  { icon: "user", label: "My profile", route: "/m/settings-profile" },
  { icon: "home", label: "Organisation profile", route: "/m/settings-organisation" },
  { icon: "briefcase", label: "Firm profile", route: "/m/firm-profile" },
];

export function HeaderProfileButton() {
  const router = useRouter();
  const { brand, brandLight } = useBrand();
  const { data: me } = useMe();
  const signOut = useSession((s) => s.signOut);
  const [open, setOpen] = useState(false);

  const go = (route: string) => {
    setOpen(false);
    router.push(route as any);
  };
  const onSignOut = () => {
    setOpen(false);
    confirmDelete({ title: "Sign out?", message: "You'll need to log in again.", confirmLabel: "Sign out" }, () => signOut());
  };

  const photo = absUrl(me?.user.avatarUrl);

  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={8} style={styles.btn}>
        {photo ? (
          <Image source={{ uri: photo }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: brand }]}>
            <Text style={{ color: palette.white, fontWeight: fontWeight.bold as any, fontSize: 13 }}>
              {initials(me?.user.name) || "?"}
            </Text>
          </View>
        )}
      </Pressable>

      <BottomSheet visible={open} onClose={() => setOpen(false)} title={me?.user.name ?? "Profile"}>
        <View style={styles.identity}>
          {photo ? (
            <Image source={{ uri: photo }} style={styles.bigAvatar} />
          ) : (
            <View style={[styles.bigAvatar, { backgroundColor: brand }]}>
              <Text style={{ color: palette.white, fontWeight: fontWeight.bold as any, fontSize: 18 }}>{initials(me?.user.name) || "?"}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text variant="subtitle" numberOfLines={1}>{me?.user.name ?? "—"}</Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>{me?.user.email}</Text>
            {me?.user.roleLabel ? <Text variant="caption" tone="brand" style={{ marginTop: 2 }}>{me.user.roleLabel}</Text> : null}
          </View>
        </View>

        {PROFILE_MENU.map((m) => (
          <Pressable key={m.route} style={styles.row} onPress={() => go(m.route)}>
            <View style={[styles.rowIcon, { backgroundColor: brandLight }]}><Feather name={m.icon as any} size={16} color={brand} /></View>
            <Text variant="body" style={{ flex: 1 }}>{m.label}</Text>
            <Feather name="chevron-right" size={18} color={palette.faint} />
          </Pressable>
        ))}

        <Pressable style={[styles.row, styles.signOut]} onPress={onSignOut}>
          <View style={[styles.rowIcon, { backgroundColor: palette.dangerBg }]}><Feather name="log-out" size={16} color={palette.danger} /></View>
          <Text variant="body" style={{ flex: 1, color: palette.danger, fontWeight: fontWeight.medium as any }}>Sign out</Text>
        </Pressable>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  btn: { paddingRight: spacing.md, paddingLeft: spacing.sm },
  avatar: { width: 32, height: 32, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  identity: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingBottom: spacing.md, marginBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  bigAvatar: { width: 46, height: 46, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  rowIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  signOut: { marginTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line, paddingTop: spacing.md },
});
