import { describe, it, expect } from "vitest";
import { cleanBaseUrl, driveRedirectUri, driveStatusView, monthFolderPath } from "@/lib/integrations/google-drive";
import { effectiveStatus } from "@/lib/integrations/drive-transfer";
import { MAX_DRIVE_UPLOAD_BYTES } from "@/lib/integrations/drive-limits";

describe("google drive hand-off", () => {
  it("files videos into year and month folders", () => {
    expect(monthFolderPath("2026-11-03")).toEqual(["Equitywala Content", "2026", "11 - November"]);
    expect(monthFolderPath("2027-01-31")).toEqual(["Equitywala Content", "2027", "01 - January"]);
  });
  it("never exposes the secret or refresh token in the status view", () => {
    const v = driveStatusView({ clientId: "123456789012-abcdefghijklmnop.apps.googleusercontent.com", clientSecret: "GOCSPX-secret", refreshToken: "1//rt", email: "a@b.com" });
    expect(JSON.stringify(v)).not.toContain("GOCSPX");
    expect(JSON.stringify(v)).not.toContain("1//rt");
    expect(v).toMatchObject({ hasCredentials: true, hasSecret: true, connected: true, email: "a@b.com" });
    expect(v.clientId).toContain("apps.googleusercontent.com");
    expect(driveStatusView(null)).toMatchObject({ hasCredentials: false, connected: false });
  });
  it("treats a copy stuck 'uploading' for a long time as failed, so it can be retried", () => {
    const old = new Date(Date.now() - 60 * 60_000);
    expect(effectiveStatus({ status: "uploading", updatedAt: old })).toBe("failed");
    expect(effectiveStatus({ status: "uploading", updatedAt: new Date() })).toBe("uploading");
    expect(effectiveStatus({ status: "done", updatedAt: old })).toBe("done");
  });
  it("builds the redirect address from the typed public address, not the server's internal localhost", () => {
    const path = "/api/settings/integrations/google-drive/oauth/callback";
    expect(driveRedirectUri("https://localhost:3000", { redirectBase: "https://crm.equitywala.com/x/" })).toBe("https://crm.equitywala.com" + path);
    expect(driveRedirectUri("https://crm.equitywala.com", null)).toBe("https://crm.equitywala.com" + path);
    expect(cleanBaseUrl("crm.equitywala.com")).toBeNull();
    expect(cleanBaseUrl("https://crm.equitywala.com/dashboard")).toBe("https://crm.equitywala.com");
  });
  it("has a 500 MB ceiling", () => {
    expect(MAX_DRIVE_UPLOAD_BYTES).toBe(500 * 1024 * 1024);
  });
});
