/**
 * Marketing Assets & Trust Builders catalogue — adopted from the Network FP
 * "Marketing Assets" template. A readiness reference of the brand / trust /
 * lead-gen assets an MFD should have. Supports AMFI DDQ IV.1 (marketing
 * samples). Pure data; some items deep-link to where they live in the app.
 */

export type AssetItem = {
  title: string;
  href?: string; // in-app location where this asset is produced/managed
};

export type AssetGroup = {
  key: string;
  title: string;
  items: AssetItem[];
};

export const MARKETING_ASSETS: AssetGroup[] = [
  {
    key: "branding",
    title: "Branding essentials",
    items: [
      { title: "Website / brochure / profile page" },
      { title: "Professional profile (link, PDF, print)" },
      { title: "Professional headshot" },
      { title: "Firm logo" },
      { title: "Visiting card" },
      { title: "WhatsApp Business profile" },
      { title: "Email signature with branding" },
      { title: "Elevator pitch — what you do" },
      { title: "Initial proposal PPT deck", href: "/dashboard/proposals" },
      { title: "Social accounts — LinkedIn / Instagram / Facebook (updated)" },
    ],
  },
  {
    key: "trust",
    title: "Trust builders",
    items: [
      { title: "Testimonial library — emails, WhatsApp, video" },
      { title: "Google / Trustpilot reviews" },
      { title: "Awards / recognition archive" },
      { title: "Certifications (QPFP, CFP)", href: "/dashboard/employees" },
      { title: "Memberships (NFP / ARIA / FIFA)" },
      { title: "Media quotes / articles / podcasts" },
      { title: "AMFI Code of Conduct / ethics oath", href: "/dashboard/sops" },
    ],
  },
  {
    key: "lead_magnets",
    title: "Lead magnets",
    items: [
      { title: "Financial goal calculator", href: "/dashboard/calculators" },
      { title: "Personal budget statement" },
      { title: "Financial documents organizer" },
      { title: "Retirement calculator", href: "/dashboard/calculators" },
      { title: "FIRE / financial-freedom calculator", href: "/dashboard/calculators" },
      { title: "Investment portfolio review template", href: "/dashboard/review-meetings" },
      { title: "Insurance portfolio review template", href: "/dashboard/insurance" },
      { title: "Educational images / videos / write-ups", href: "/dashboard/ssit-library" },
    ],
  },
  {
    key: "iap",
    title: "Investor awareness (IAP) resources",
    items: [
      { title: "IAP presentation — mutual funds" },
      { title: "IAP presentation — goal-based investing" },
      { title: "IAP presentation — insurance" },
    ],
  },
];
