/**
 * Root layout — wraps the whole app in the providers every screen needs:
 * gesture root (drawer + swipe), safe-area (with initial metrics so insets are
 * correct on the FIRST paint — no post-mount padding jump), the TanStack Query
 * cache, and a one-time session hydration that decides login vs app. The boot
 * screen shows the "A" logo + version while the session hydrates.
 */

import "react-native-gesture-handler";
import React, { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import Animated, { FadeIn, FadeInDown, Easing, useSharedValue, useAnimatedStyle, withDelay, withTiming } from "react-native-reanimated";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { queryClient } from "../src/api/queryClient";
import { useSession } from "../src/state/session";
import { setPushHandler } from "../src/push";
import { BrandLogo } from "../src/components/BrandLogo";
import { ToastHost } from "../src/components/ui/ToastHost";
import { Text } from "../src/components/ui/Text";
import { palette, spacing, fontWeight } from "../src/theme/tokens";

setPushHandler();

const VERSION = Constants.expoConfig?.version ?? "1.0.0";

function BootScreen() {
  // "SSIT CRM" reveal: the wordmark fades up, then a red underline wipes in.
  const underline = useSharedValue(0);
  useEffect(() => {
    underline.value = withDelay(340, withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) }));
  }, []);
  const underlineStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: underline.value }], opacity: underline.value }));

  return (
    <View style={styles.splash}>
      <View style={styles.brandWrap}>
        <Animated.View entering={FadeIn.duration(420)}>
          <BrandLogo size={92} />
        </Animated.View>
        <Animated.Text entering={FadeInDown.delay(260).duration(520)} style={styles.wordmark}>SSIT CRM</Animated.Text>
        <Animated.View style={[styles.underline, underlineStyle]} />
        <Animated.Text entering={FadeIn.delay(720).duration(400)} style={styles.tagline}>Your practice, in your pocket</Animated.Text>
      </View>
      <ActivityIndicator color={palette.brand} style={{ position: "absolute", bottom: 96 }} />
      <Text variant="caption" tone="faint" style={styles.version}>v{VERSION}</Text>
    </View>
  );
}

export default function RootLayout() {
  const status = useSession((s) => s.status);
  const hydrate = useSession((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="dark" />
          {status === "loading" ? (
            <BootScreen />
          ) : (
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.surfaceAlt } }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="login" />
              <Stack.Screen name="(app)" />
            </Stack>
          )}
          <ToastHost />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" },
  brandWrap: { alignItems: "center" },
  wordmark: { fontSize: 30, fontWeight: fontWeight.bold as any, color: palette.ink, letterSpacing: -0.5, marginTop: spacing.md },
  underline: { width: 92, height: 3, borderRadius: 2, backgroundColor: palette.brand, marginTop: spacing.sm },
  tagline: { fontSize: 13, color: palette.muted, marginTop: spacing.md },
  version: { position: "absolute", bottom: spacing.xl },
});
