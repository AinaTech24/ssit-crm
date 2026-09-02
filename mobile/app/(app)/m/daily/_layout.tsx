import React from "react";
import { Stack } from "expo-router";
import { palette } from "../../../../src/theme/tokens";

export default function DailyLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.surfaceAlt }, animation: "slide_from_right" }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
