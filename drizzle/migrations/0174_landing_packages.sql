-- Landing-page marketing packages — the public pricing cards, editable by SSIT
-- admins. Separate from the billing `packages` master (which drives real gating,
-- limits and paise pricing); these are display/marketing only. Platform-scoped
-- (no tenant_id → no RLS).
CREATE TABLE IF NOT EXISTS landing_packages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  tagline        text,
  price_label    text,
  unit_label     text,
  setup_label    text,
  seats_label    text,
  inherits_label text,
  features       jsonb NOT NULL DEFAULT '[]'::jsonb,
  featured       boolean NOT NULL DEFAULT false,
  badge_label    text,
  is_custom      boolean NOT NULL DEFAULT false,
  cta_label      text NOT NULL DEFAULT 'Start Free Trial',
  cta_href       text NOT NULL DEFAULT '/signup',
  sort_order     integer NOT NULL DEFAULT 0,
  published      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS landing_packages_order_idx ON landing_packages (published, sort_order);

-- Seed the current three cards so the page is populated + editable on day one.
INSERT INTO landing_packages (name, tagline, price_label, unit_label, setup_label, seats_label, inherits_label, features, featured, is_custom, cta_label, cta_href, sort_order, published)
SELECT * FROM (VALUES
  ('Growth',
   'Everything an MFD firm needs to run day-to-day — clients, money, service, automation & AI alerts in one organised place.',
   '₹9,499', '/ user / year', '₹45,000', '3 users = ₹28,497 / year', NULL,
   '["Dashboard, Tasks, Meetings & Calendar","Leads, Clients & Family Mapping","Risk Profile & Any 20 Calculators","Insurance Policies & Claims","Insurance Renewal Alerts","Business Entities — All Products","Email Automation","User Management & Basic Support","Report / MIS","Command Centre — AI Alerts","Next Big Action — AI Alerts","Proposals & Insurance Commission Tracker","Attendance & Leave Tracker","Sub-Distributor Module","Workflow Rules & Basic Automation","Recorded Training Sessions & SSIT Content Library"]'::jsonb,
   false, false, 'Start Free Trial', '/signup', 10, true),
  ('Premium',
   'Full AI, compliance & practice management for firms scaling seriously.',
   '₹12,499', '/ user / year', '₹75,000', '3 users = ₹37,497 / year', 'Everything in Growth, plus:',
   '["AI Assistant & AI Tool Training","RTA File Import","Advanced Goal Planning","Brokerage Management","DDQ Compliance Management & Audit","Portfolio Intelligence","Practice & Finance Tools","Advanced Automation","Custom CRM Customisation","WhatsApp Automation","IT Support & Customised Presentations","CRM Usage Tracking & Team Implementation","Personalized Training Sessions"]'::jsonb,
   true, false, 'Start Free Trial', '/signup', 20, true),
  ('Custom CRM Customization',
   'A CRM built and tailored to your firm''s exact workflow — hosted on your own server, fully under your control.',
   NULL, NULL, NULL, NULL, 'Everything in Premium, plus:',
   '["Hosted on your own server / infrastructure","Bespoke modules & workflows built for your firm","Custom integrations (RTA, AMC, in-house tools)","Your branding end-to-end (white-label)","Dedicated implementation & priority support","Tailored data migration & onboarding"]'::jsonb,
   false, true, 'Call now', 'tel:+918200770942', 30, true)
) AS v
WHERE NOT EXISTS (SELECT 1 FROM landing_packages);
