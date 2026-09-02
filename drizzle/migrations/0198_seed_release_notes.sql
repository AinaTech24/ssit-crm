-- Seed the changelog with what actually shipped, so "What's new" is useful the
-- moment it goes live instead of an empty page. Idempotent: keyed on title.

INSERT INTO release_notes (version, title, body, category, module, href, published_at)
SELECT * FROM (VALUES
  ('Aug 2026', 'AMFI DDQ compliance registers',
   'The Due Diligence Questionnaire asks for records the CRM had nowhere to keep. Now it does:' || chr(10) ||
   '- **Declaration of Self-Certification** (DDQ 4.26) for your ARN and every sub-distributor, with a per-FY status' || chr(10) ||
   '- **Incident register** — mis-selling, third-party payments, regulatory action, litigation, ARN/EUIN suspension, warning letters' || chr(10) ||
   '- **Unsuitability acknowledgements** (2.4b) — communicated, acknowledged, and confirmed "execution only"' || chr(10) ||
   '- **Firm declarations** — relationship model, execution fees, AMFI tagline, social-media disclosure',
   'compliance', 'Compliance', '/dashboard/compliance/registers', now() - interval '2 days'),

  ('Aug 2026', 'Third-party payment scan — automatic',
   'DDQ 4.20b requires you to monitor that subscription funds come from the investor''s **own** bank account. ' ||
   'The CRM now flags any active mandate whose debit account doesn''t match a bank registered to that client, ' ||
   'matching on the last 4 digits so inconsistent RTA masking doesn''t cause false passes. Review them on the registers page.',
   'compliance', 'Compliance', '/dashboard/compliance/registers', now() - interval '2 days'),

  ('Aug 2026', 'Self-certification reminder',
   'The annual DSC is the most commonly missed obligation because nothing prompts it. The CRM now raises a ' ||
   'high-priority compliance task each financial year, due 30 June, and closes it automatically once the declaration is recorded.',
   'compliance', 'Compliance', '/dashboard/tasks', now() - interval '2 days'),

  ('Aug 2026', 'UBO and IPV tracking',
   'The KYC tracker now counts **UBO** (DDQ 4.11c) and **In-Person Verification** (4.13) gaps alongside PAN and FATCA, ' ||
   'so the questionnaire''s KYC questions can be answered from one screen.',
   'compliance', 'Compliance', '/dashboard/reports/kyc-tracker', now() - interval '2 days'),

  ('Aug 2026', 'One consistent table toolbar everywhere',
   'Every list — Clients, Transactions, Insurance, Complaints and the rest — now has the same header: ' ||
   'a search box, a single **Filters** button holding every filter, an icon **Sort**, **Columns**, and **Views**. ' ||
   'The Clients sort is now an icon instead of a wide dropdown.',
   'improvement', 'All modules', '/dashboard/investors', now() - interval '3 days'),

  ('Aug 2026', 'Simpler sidebar',
   'Folder-style groups you can collapse, clearer active highlighting, and a shorter menu: reports that appeared ' ||
   'twice now live only in Reports & MIS, SIP became one module with tabs (Book / At-risk / Rejections), and ' ||
   'Insurance folded five entries into one (Policies / Renewals / Claims / Protection gap / Commission).',
   'improvement', 'Navigation', '/dashboard/reports', now() - interval '4 days'),

  ('Aug 2026', 'SSIT CRM Copilot knows how the CRM works',
   'Ask **"how do I convert a lead to a client?"** and you get the real step-by-step instead of a number. ' ||
   'The copilot also answers with charts (AUM by segment, business trend), gives a full client 360, compares RM ' ||
   'performance, and drafts client emails, WhatsApp and SMS.',
   'feature', 'Copilot', '/dashboard/ai-assistant', now() - interval '5 days'),

  ('Aug 2026', 'Risk profile: OTP moved to the end',
   'The client''s one-time code is now requested **after** the questionnaire is complete, not before it starts — ' ||
   'so you can fill it in with the client and verify once at sign-off.',
   'improvement', 'Risk Profile', '/dashboard/risk-profiles', now() - interval '6 days'),

  ('Aug 2026', 'Attendance search and filters',
   'The attendance table now has a search box and a Filters button (status, date range, today only) in its header, ' ||
   'with the column titles kept.',
   'improvement', 'Attendance', '/dashboard/attendance', now() - interval '6 days')
) AS v(version, title, body, category, module, href, published_at)
WHERE NOT EXISTS (SELECT 1 FROM release_notes rn WHERE rn.title = v.title);
