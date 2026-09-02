/**
 * Bottom tabs: Home · Tasks · Settings. Everything else lives in the drawer; the
 * hamburger (header-left) opens it. Header-right is search + profile — search is
 * a field rep's most-used action, so it rides every tab rather than a screen.
 */

import React, { useState } from "react";
import { View, Pressable, Text, StyleSheet } from "react-native";
import { Tabs, useRouter } from "expo-router";
import { DrawerToggleButton } from "@react-navigation/drawer";
import { Feather } from "@expo/vector-icons";
import { palette, spacing, fontWeight, TOUCH_MIN } from "../../../../src/theme/tokens";
import { useBrand } from "../../../../src/theme/brand";
import { HeaderProfileButton } from "../../../../src/components/HeaderProfileButton";
import { NotificationsSheet } from "../../../../src/features/notifications/NotificationsSheet";
import { useNotifications, isUnread } from "../../../../src/features/notifications/api";

/** expo-router's built-in toggle handles opening the parent drawer (no
 *  @react-navigation/* dependency, which SDK 56 disallows alongside the router). */
function HamburgerButton() {
  return (
    <View style={{ paddingLeft: spacing.sm }}>
      <DrawerToggleButton tintColor={palette.ink} />
    </View>
  );
}

/** Search + notifications + avatar — all one tap from anywhere in the app. */
function HeaderActions() {
  const router = useRouter();
  const { data } = useNotifications();
  const unread = (data?.notifications ?? []).filter(isUnread).length;
  const [notifOpen, setNotifOpen] = useState(false);
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Pressable
        onPress={() => router.push("/search" as any)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Search"
        style={{ width: TOUCH_MIN, height: TOUCH_MIN, alignItems: "center", justifyContent: "center" }}
      >
        <Feather name="search" size={20} color={palette.ink} />
      </Pressable>
      <Pressable
        onPress={() => setNotifOpen(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={unread ? `Notifications, ${unread} unread` : "Notifications"}
        style={{ width: TOUCH_MIN, height: TOUCH_MIN, alignItems: "center", justifyContent: "center" }}
      >
        <Feather name="bell" size={20} color={palette.ink} />
        {unread > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeTxt}>{unread > 9 ? "9+" : unread}</Text>
          </View>
        ) : null}
      </Pressable>
      <HeaderProfileButton />
      <NotificationsSheet visible={notifOpen} onClose={() => setNotifOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { position: "absolute", top: 8, right: 6, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: palette.danger, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  badgeTxt: { color: palette.white, fontSize: 10, fontWeight: "700" },
});

export default function TabsLayout() {
  const { brand } = useBrand();
  return (
    <Tabs
      screenOptions={{
        // Cross-fade+shift between tabs instead of an instant snap — the same
        // "the app actually moves" polish the stack push gives module screens.
        animation: "shift",
        tabBarActiveTintColor: brand,
        tabBarInactiveTintColor: palette.faint,
        tabBarStyle: { borderTopColor: palette.line, height: 60, paddingBottom: 8, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: fontWeight.medium },
        headerStyle: { backgroundColor: palette.surface, shadowColor: "transparent", elevation: 0, borderBottomWidth: 0 },
        headerTitleStyle: { fontWeight: fontWeight.bold, color: palette.ink, fontSize: 18 },
        headerLeft: () => <HamburgerButton />,
        headerRight: () => <HeaderActions />,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: "Home", tabBarIcon: ({ color, size }) => <Feather name="home" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="tasks"
        options={{ title: "Tasks", tabBarIcon: ({ color, size }) => <Feather name="check-square" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: "Settings", tabBarIcon: ({ color, size }) => <Feather name="settings" size={size} color={color} /> }}
      />
    </Tabs>
  );
}
