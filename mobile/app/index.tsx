/**
 * Boot gate. Session is already hydrated by the root layout, so we just route:
 * authed → the app shell, guest → login.
 */

import React from "react";
import { Redirect } from "expo-router";
import { useSession } from "../src/state/session";

export default function Index() {
  const status = useSession((s) => s.status);
  if (status === "authed") return <Redirect href="/(app)/(drawer)/(tabs)/home" />;
  return <Redirect href="/login" />;
}
