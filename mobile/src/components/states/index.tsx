/**
 * Production app-state views. Every list/detail screen renders one of these when
 * it isn't showing data: loading, empty, search-empty, error, permission-denied,
 * network-error, session-expired. Consistent, animated, with a retry/CTA.
 */

import React from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { palette, spacing } from "../../theme/tokens";
import { Text } from "../ui/Text";
import { Button } from "../ui/Button";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

function StateView({
  icon,
  iconColor = palette.faint,
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon: FeatherName;
  iconColor?: string;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <Animated.View entering={FadeIn.duration(220)} style={styles.wrap}>
      <View style={styles.iconWrap}>
        <Feather name={icon} size={28} color={iconColor} />
      </View>
      <Text variant="subtitle" center>
        {title}
      </Text>
      {message ? (
        <Text variant="body" tone="muted" center style={{ maxWidth: 300 }}>
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: spacing.md }}>
          <Button label={actionLabel} variant="secondary" size="sm" onPress={onAction} />
        </View>
      ) : null}
    </Animated.View>
  );
}

export function LoadingState({ label }: { label?: string }) {
  return (
    <View style={styles.wrap}>
      <ActivityIndicator size="large" color={palette.brand} />
      {label ? (
        <Text variant="body" tone="muted" center>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

export function EmptyState({ title, message, actionLabel, onAction, icon = "inbox" }: { title: string; message?: string; actionLabel?: string; onAction?: () => void; icon?: FeatherName }) {
  return <StateView icon={icon} title={title} message={message} actionLabel={actionLabel} onAction={onAction} />;
}

export function SearchEmptyState({ query }: { query: string }) {
  return <StateView icon="search" title="No results" message={`Nothing matched “${query}”. Try a different term.`} />;
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <StateView
      icon="alert-triangle"
      iconColor={palette.danger}
      title="Something went wrong"
      message={message ?? "We couldn't load this. Please try again."}
      actionLabel={onRetry ? "Retry" : undefined}
      onAction={onRetry}
    />
  );
}

export function NetworkErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <StateView
      icon="wifi-off"
      iconColor={palette.warning}
      title="No connection"
      message="Check your internet connection and try again."
      actionLabel={onRetry ? "Retry" : undefined}
      onAction={onRetry}
    />
  );
}

export function PermissionDeniedState() {
  return (
    <StateView
      icon="lock"
      title="No access"
      message="You don't have permission to view this. Contact your administrator if you think this is a mistake."
    />
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing["3xl"], gap: spacing.md },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: palette.surfaceSunken,
    alignItems: "center",
    justifyContent: "center",
  },
});
