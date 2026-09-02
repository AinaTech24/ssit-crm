import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: { center: true, padding: "1rem", screens: { "2xl": "1400px" } },
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        // Brand colors — referenced by hero stripes, badges, gradients
        brand: {
          navy: "hsl(var(--brand-navy))",
          "navy-light": "hsl(var(--brand-navy-light))",
          "navy-deep": "hsl(var(--brand-navy-deep))",
          cyan: "hsl(var(--brand-cyan))",
          "cyan-light": "hsl(var(--brand-cyan-light))",
          "cyan-deep": "hsl(var(--brand-cyan-deep))",
          violet: "hsl(var(--brand-violet))",
          mint: "hsl(var(--brand-mint))",
        },
      },
      borderRadius: {
        "2xl": "calc(var(--radius) + 8px)",
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        // Premium layered shadows — soft, multi-stop, SSIT-style
        sm: "0 1px 2px 0 rgb(15 23 42 / 0.04)",
        DEFAULT:
          "0 1px 3px 0 rgb(15 23 42 / 0.05), 0 1px 2px -1px rgb(15 23 42 / 0.04)",
        md: "0 4px 8px -2px rgb(15 23 42 / 0.06), 0 2px 4px -2px rgb(15 23 42 / 0.04)",
        lg: "0 12px 20px -6px rgb(15 23 42 / 0.08), 0 4px 8px -4px rgb(15 23 42 / 0.05)",
        xl: "0 24px 40px -12px rgb(15 23 42 / 0.12), 0 8px 16px -6px rgb(15 23 42 / 0.06)",
        "2xl":
          "0 32px 60px -16px rgb(15 23 42 / 0.18), 0 12px 24px -8px rgb(15 23 42 / 0.08)",
        // Glow shadows — for high-emphasis CTAs + focus states
        glow: "0 0 0 4px hsl(var(--brand-cyan) / 0.15)",
        "glow-lg": "0 8px 24px -4px hsl(var(--brand-cyan) / 0.35)",
        "glow-navy": "0 8px 24px -4px hsl(var(--brand-navy) / 0.35)",
        // Subtle inner shadow for inputs on focus
        "inner-sm": "inset 0 1px 2px 0 rgb(15 23 42 / 0.06)",
      },
      backdropBlur: {
        xs: "2px",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        // Centred overlays: the centring translate MUST be part of the
        // animated transform. A keyframe that sets `transform` overrides the
        // -translate-x/y-1/2 utilities for the whole animation, so the panel
        // starts with its top-left corner at screen centre — visibly flying
        // in from the bottom-right and snapping back on the last frame.
        "dialog-in": {
          from: { opacity: "0", transform: "translate(-50%, -50%) scale(0.96)" },
          to: { opacity: "1", transform: "translate(-50%, -50%) scale(1)" },
        },
        "pop-in-centered-x": {
          from: { opacity: "0", transform: "translateX(-50%) scale(0.96)" },
          to: { opacity: "1", transform: "translateX(-50%) scale(1)" },
        },
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 0 0 hsl(var(--brand-cyan) / 0.4)" },
          "50%": { boxShadow: "0 0 0 8px hsl(var(--brand-cyan) / 0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-4px)" },
        },
      },
      animation: {
        "fade-in": "fade-in 220ms ease-out",
        "slide-up": "slide-up 320ms cubic-bezier(0.22, 1, 0.36, 1)",
        "scale-in": "scale-in 180ms cubic-bezier(0.22, 1, 0.36, 1)",
        "dialog-in": "dialog-in 180ms cubic-bezier(0.22, 1, 0.36, 1)",
        "pop-in-centered-x": "pop-in-centered-x 180ms cubic-bezier(0.22, 1, 0.36, 1)",
        "pulse-glow": "pulse-glow 2.2s ease-in-out infinite",
        shimmer: "shimmer 2.4s linear infinite",
        float: "float 3s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
