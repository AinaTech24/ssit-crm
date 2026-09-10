"use client";

/**
 * Global error boundary — the last line of defence. Catches errors thrown in the
 * ROOT layout itself (where the dashboard/super-admin boundaries can't reach).
 * Next requires it to render its own <html>/<body> because the failing layout
 * may not have produced them. Kept dependency-free + inline-styled so it works
 * even if the stylesheet failed to load.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            'system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
          background: "#f8fafc",
          color: "#0f172a",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 440, padding: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>⚠️</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 8px" }}>
            The app hit a problem
          </h1>
          <p style={{ color: "#64748b", fontSize: 14, lineHeight: 1.6, margin: "0 0 20px" }}>
            An unexpected error stopped the page from loading. Please try again.
          </p>
          {error?.digest && (
            <p style={{ color: "#94a3b8", fontFamily: "monospace", fontSize: 11, marginBottom: 16 }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              background: "#d22e32",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
