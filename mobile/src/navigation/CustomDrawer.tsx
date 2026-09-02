/**
 * The drawer ("sidebar") — pure navigation: every module that isn't a bottom
 * tab, grouped and capability-gated (same gate as the server), with an
 * active-module highlight. Profile + Sign out live in the TOP HEADER's profile
 * menu now (HeaderProfileButton) — NOT here.
 *
 * The whole drawer is wrapped in SafeAreaView with edges top+bottom so its
 * content never sits under the status bar or the gesture-navigation area.
 */

import React from "react";
import { View, ScrollView, Pressable, StyleSheet } from "react-native";
import { type DrawerContentComponentProps } from "@react-navigation/drawer";
import { useRouter, usePathname } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { palette, spacing, radius, fontWeight } from "../theme/tokens";
import { useBrand } from "../theme/brand";
import { Text } from "../components/ui/Text";
import { useMe, hasAnyCap } from "../api/me";
import { MENU } from "./menu";

export function CustomDrawer(props: DrawerContentComponentProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { brand, brandLight } = useBrand();
  const { data: me } = useMe();
  const caps = me?.capabilities;

  const go = (route: string) => {
    props.navigation.closeDrawer();
    router.push(route as any);
  };
  const isActive = (route: string) => pathname === route || pathname.startsWith(route + "/");

  return (
    // SafeAreaView is TRANSPARENT (edges top+bottom) so the status-bar and
    // gesture-bar strips show the system scrim; the white menu panel lives
    // INSIDE the safe area and never touches those system areas.
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.panel}>
        <ScrollView
          contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: spacing.lg }}
          showsVerticalScrollIndicator={false}
        >
          {MENU.map((group) => {
          const items = group.items.filter((it) => !it.anyCap || hasAnyCap(caps, it.anyCap));
          if (items.length === 0) return null;
          return (
            <View key={group.title} style={styles.group}>
              <Text variant="caption" tone="faint" style={styles.groupTitle}>{group.title.toUpperCase()}</Text>
              {items.map((it) => {
                const active = isActive(it.route);
                return (
                  <Pressable key={it.key} onPress={() => go(it.route)} style={[styles.item, active && { backgroundColor: brandLight }]}>
                    <Feather name={it.icon} size={18} color={active ? brand : palette.muted} />
                    <Text variant="body" style={{ color: active ? brand : palette.ink, flex: 1, fontWeight: (active ? fontWeight.semibold : fontWeight.regular) as any }}>{it.label}</Text>
                    <Feather name="chevron-right" size={16} color={active ? brand : palette.faint} />
                  </Pressable>
                );
              })}
            </View>
          );
          })}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "transparent" },
  // White menu panel with rounded right-side corners (the drawer slides from the
  // left, so only the right edge shows a corner) — floats inside the safe area.
  panel: { flex: 1, backgroundColor: palette.surface, borderTopRightRadius: radius.xl, borderBottomRightRadius: radius.xl, overflow: "hidden" },
  group: { marginBottom: spacing.lg },
  groupTitle: { paddingHorizontal: spacing.lg, marginBottom: spacing.xs, letterSpacing: 0.6 },
  item: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, marginHorizontal: spacing.sm, borderRadius: radius.md },
});
