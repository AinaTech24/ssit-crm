export function demoProvidersAllowed(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_DEMO_PROVIDERS === "1";
}

export function providerMode(configuredLive: boolean): "live" | "demo" | "blocked" {
  if (configuredLive) return "live";
  return demoProvidersAllowed() ? "demo" : "blocked";
}

