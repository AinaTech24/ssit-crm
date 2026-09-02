/**
 * Placeholder for admin-config settings pages still on the mobile roadmap.
 * Titled per section; navigation reaches it cleanly, no dead end.
 */

import React from "react";
import { View } from "react-native";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { EmptyState } from "../../components/states";
import { palette } from "../../theme/tokens";

const TITLES: Record<string, string> = {
  organisation: "Organisation profile",
  "custom-fields": "Custom fields",
  masters: "Master settings",
  "risk-profile": "Risk profile questionnaire",
  blueprints: "Blueprint editor",
  "notification-templates": "Notification templates",
  "onboarding-fields": "Onboarding form fields",
  desks: "Desks",
  "assignment-rules": "Auto-assignment rules",
  targets: "Targets & quota",
  whatsapp: "WhatsApp connection",
  email: "Email setup",
  integrations: "Integrations",
};

export function SettingsPlaceholder({ sectionKey }: { sectionKey: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title={TITLES[sectionKey] ?? "Settings"} />
      <EmptyState
        icon="settings"
        title={`${TITLES[sectionKey] ?? "This section"} — coming to mobile`}
        message="This configuration is available on the web CRM. The native screen is on the build list."
      />
    </View>
  );
}
