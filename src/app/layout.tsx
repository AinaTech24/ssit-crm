import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { NavProgress } from "@/components/layout/NavProgress";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://crm.equitywala.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Equitywala — CRM & Automation for Mutual Fund Distributors",
    template: "%s · Equitywala",
  },
  description:
    "Equitywala — the all-in-one CRM and automation platform for Indian Mutual Fund Distributors. SEBI-compliant WhatsApp & email automation, live portfolio XIRR, AI churn prediction, SIP tracking, and a guided lead-to-client pipeline — built for ARN-holding firms.",
  applicationName: "Equitywala",
  authors: [{ name: "Equitywala Technologies" }],
  creator: "Equitywala Technologies",
  publisher: "Equitywala Technologies",
  category: "Business Software",
  keywords: [
    "MFD CRM",
    "mutual fund distributor software",
    "mutual fund CRM India",
    "ARN software",
    "SIP tracker",
    "SEBI compliance software",
    "AMFI",
    "WhatsApp automation for MFD",
    "mutual fund distributor CRM",
    "MFD practice management",
    "portfolio tracking India",
    "financial advisor CRM India",
    "IFA software",
    "wealth management CRM",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Equitywala",
    title: "Equitywala — CRM & Automation for Mutual Fund Distributors",
    description:
      "Run your entire MFD practice on autopilot with Equitywala — compliant WhatsApp/email automation, live XIRR, AI churn prediction, SIP tracking and more. Built for Indian ARN holders.",
    url: SITE_URL,
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: "Equitywala — CRM & Automation for Mutual Fund Distributors",
    description:
      "The practice operating system for Indian MFDs. SEBI-compliant automation, live XIRR, AI churn prediction, SIP tracking and more.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      {/* suppressHydrationWarning: browser extensions (ColorZilla's
          `cz-shortcut-listen`, Grammarly, etc.) inject attributes onto <body>
          before React hydrates, which would otherwise log a hydration mismatch. */}
      <body
        suppressHydrationWarning
        className="min-h-screen bg-background text-foreground antialiased scrollbar-none"
      >
        {/* Dark mode removed — the app is light-only. Strip any stale `dark`
            class a previous build's toggle may have left on <html>. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.classList.remove('dark');localStorage.removeItem('theme')}catch(e){}`,
          }}
        />
        <NavProgress />
        {children}
      </body>
    </html>
  );
}
