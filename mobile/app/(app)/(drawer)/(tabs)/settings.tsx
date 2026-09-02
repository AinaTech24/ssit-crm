/**
 * Settings tab — the admin/config hub. Each row routes to its screen
 * (/m/settings-<x>, or an existing module); sign out at the bottom. Profile
 * lives in the top-header profile menu (not duplicated here).
 */

import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Screen } from "../../../../src/components/ui/Screen";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { Button } from "../../../../src/components/ui/Button";
import { useSession } from "../../../../src/state/session";
import { confirmDelete } from "../../../../src/lib/confirm";
import { palette, spacing, radius } from "../../../../src/theme/tokens";

type FeatherName = React.ComponentProps<typeof Feather>["name"];
type Section = { icon: FeatherName; title: string; desc: string; route: string };

// Same sections/order/copy as the web settings hub.
const SECTIONS: Section[] = [
  // My profile + Organisation profile live in the drawer's profile menu now.
  { icon: "smartphone", title: "App preferences", desc: "Auto-log calls, and how this device behaves for you.", route: "/m/settings-preferences" },
  { icon: "droplet", title: "Appearance & theme", desc: "Re-skin the CRM to your brand — colours, font & density, and your white-label URL.", route: "/m/settings-appearance" },
  { icon: "shield", title: "Risk profile questionnaire", desc: "Customise questions, scoring, and risk-category bands for your firm.", route: "/m/settings-risk-profile" },
  { icon: "bell", title: "Notification templates", desc: "Edit the 18 lead-journey templates — welcome, referral, meeting, proposal, docs, portal.", route: "/m/settings-notification-templates" },
  { icon: "check-square", title: "Onboarding form fields", desc: "Choose which client account-opening / KYC fields your team MUST fill — make any field mandatory or optional.", route: "/m/settings-onboarding-fields" },
  { icon: "users", title: "Team & roles", desc: "Invite team members, assign roles, manage seats.", route: "/m/employees" },
  { icon: "share-2", title: "Desks (sub-branch teams)", desc: "Group each branch into desks (DK, RC, 1…) and assign RMs — drives the monthly MIS roll-ups.", route: "/m/settings-desks" },
  { icon: "git-branch", title: "Auto-assignment rules", desc: "Route new leads & clients to your team automatically — round-robin or load-balanced.", route: "/m/settings-assignment-rules" },
  { icon: "target", title: "Targets & quota", desc: "Set monthly business, new-meeting and renewal-meeting targets per team member — track vs achievement.", route: "/m/settings-targets" },
  { icon: "credit-card", title: "Billing & subscription", desc: "Current plan, payment history, renewal.", route: "/m/billing" },
  { icon: "message-circle", title: "WhatsApp connection", desc: "Your SSIT WhatsApp number and Meta template approvals.", route: "/m/settings-whatsapp" },
  { icon: "mail", title: "Email setup", desc: "Sending domain, DKIM, transactional + marketing streams.", route: "/m/settings-email" },
  { icon: "key", title: "Two-factor authentication", desc: "Add a TOTP authenticator code on top of your password. Self-service for your own account.", route: "/m/settings-security" },
  { icon: "link", title: "Integrations", desc: "BSE Star MF, CAMS / KFintech feeds, Razorpay, KYC providers.", route: "/m/settings-integrations" },
];

export default function Settings() {
  const router = useRouter();
  const signOut = useSession((s) => s.signOut);

  return (
    <Screen scroll padded contentStyle={{ paddingTop: spacing.lg, paddingBottom: spacing["3xl"] }}>
      <Text variant="label" tone="muted" style={{ marginBottom: spacing.sm }}>
        SETTINGS
      </Text>
      <Card flat style={{ padding: 0, overflow: "hidden" }}>
        {SECTIONS.map((s, i) => (
          <Pressable
            key={s.title}
            style={[styles.row, i < SECTIONS.length - 1 && styles.divider]}
            onPress={() => router.push(s.route as any)}
          >
            <View style={styles.iconWrap}>
              <Feather name={s.icon} size={17} color={palette.brandDark} />
            </View>
            <Text variant="body" style={{ flex: 1, color: palette.ink }}>{s.title}</Text>
            <Feather name="chevron-right" size={16} color={palette.faint} />
          </Pressable>
        ))}
      </Card>

      <View style={{ marginTop: spacing.xl }}>
        <Button
          label="Sign out"
          variant="secondary"
          icon={<Feather name="log-out" size={16} color={palette.danger} />}
          onPress={() => confirmDelete({ title: "Sign out?", message: "You'll need to log in again.", confirmLabel: "Sign out" }, () => signOut())}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  iconWrap: { width: 34, height: 34, borderRadius: radius.md, backgroundColor: palette.brandLight, alignItems: "center", justifyContent: "center" },
});
