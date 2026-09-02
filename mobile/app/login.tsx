/**
 * Native login. Email/password → /api/auth/mobile-login; if 2FA is on, swaps to
 * the code step (/api/auth/mobile-2fa). On success the token goes into the
 * session store and the gate routes into the app.
 */

import React, { useState } from "react";
import { View, TextInput, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import { mobileLogin, mobileVerify2fa } from "../src/api";
import { useSession } from "../src/state/session";
import { Text } from "../src/components/ui/Text";
import { Button } from "../src/components/ui/Button";
import { palette, radius, spacing, fontSize } from "../src/theme/tokens";

export default function Login() {
  const router = useRouter();
  const signIn = useSession((s) => s.signIn);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = async (token: string) => {
    await signIn(token);
    router.replace("/(app)/(drawer)/(tabs)/home");
  };


  const onPassword = async () => {
    setBusy(true);
    setError(null);
    const r = await mobileLogin(email.trim(), password);
    setBusy(false);
    if (r.kind === "ok") return finish(r.token);
    if (r.kind === "2fa") return setChallenge(r.challenge);
    setError(r.message);
  };

  const onCode = async () => {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    const r = await mobileVerify2fa(challenge, code.trim());
    setBusy(false);
    if (r.kind === "ok") return finish(r.token);
    setError(r.kind === "error" ? r.message : "Invalid code");
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Animated.View entering={FadeInDown.duration(400)} style={styles.card}>
        <Text variant="title" center>
          SSIT CRM
        </Text>
        <Text variant="body" tone="muted" center style={{ marginTop: 4, marginBottom: spacing.xl }}>
          {challenge ? "Enter your authentication code" : "Sign in to your account"}
        </Text>

        {!challenge ? (
          <>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={palette.faint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              editable={!busy}
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={palette.faint}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              editable={!busy}
              onSubmitEditing={onPassword}
            />
          </>
        ) : (
          <TextInput
            style={styles.input}
            placeholder="6-digit code"
            placeholderTextColor={palette.faint}
            keyboardType="number-pad"
            value={code}
            onChangeText={setCode}
            editable={!busy}
            onSubmitEditing={onCode}
            autoFocus
          />
        )}

        {error ? (
          <Text variant="label" tone="danger" center style={{ marginBottom: spacing.md }}>
            {error}
          </Text>
        ) : null}

        <Button label={challenge ? "Verify" : "Sign In"} onPress={challenge ? onCode : onPassword} loading={busy} full />

        {challenge ? (
          <Button
            label="Back to sign in"
            variant="ghost"
            onPress={() => {
              setChallenge(null);
              setCode("");
              setError(null);
            }}
          />
        ) : null}
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: spacing["2xl"], backgroundColor: palette.surfaceAlt },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    padding: spacing["2xl"],
    shadowColor: palette.ink,
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  input: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
    marginBottom: spacing.md,
    color: palette.ink,
    backgroundColor: palette.surface,
  },
});
