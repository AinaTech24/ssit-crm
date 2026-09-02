import { ImageResponse } from "next/og";

/**
 * Branded social-share card (og:image + twitter:image via twitter-image.tsx
 * re-export). Generated at build/request time with next/og so links shared in
 * WhatsApp / LinkedIn render a real preview instead of nothing.
 */
export const runtime = "nodejs";
export const alt = "SSIT CRM — the practice operating system for Mutual Fund Distributors";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  const red = "#B71A20";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#ffffff",
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        {/* top: wordmark + eyebrow */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <span style={{ fontSize: 64, fontWeight: 800, color: red, letterSpacing: -1 }}>SSIT</span>
            <span style={{ fontSize: 64, fontWeight: 800, color: "#1a1f2b", letterSpacing: -1, marginLeft: 14 }}>CRM</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 600, color: "#5b6472", marginTop: 8, letterSpacing: 2, textTransform: "uppercase" }}>
            Built only for Indian Mutual Fund Distributors
          </div>
        </div>

        {/* middle: headline */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0 16px", fontSize: 58, fontWeight: 800, color: "#11151c", lineHeight: 1.15, maxWidth: 1000 }}>
            <span>Run your MFD practice with</span>
            <span style={{ color: red }}>more control, less manual work.</span>
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 36, flexWrap: "wrap" }}>
            {["Compliance & DDQ", "Client servicing", "Automation & AI", "60+ calculators"].map((t) => (
              <div
                key={t}
                style={{
                  display: "flex",
                  fontSize: 22,
                  fontWeight: 600,
                  color: "#3a414e",
                  background: "#f3f4f6",
                  border: "1px solid #e5e7eb",
                  borderRadius: 999,
                  padding: "10px 22px",
                }}
              >
                {t}
              </div>
            ))}
          </div>
        </div>

        {/* bottom: footer bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: red }}>crm.ssit.com</div>
          <div style={{ fontSize: 20, color: "#7a828f" }}>AMFI &amp; SEBI-aware · DPDP-ready · Live in a day</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
