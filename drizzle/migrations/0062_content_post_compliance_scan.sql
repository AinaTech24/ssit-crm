-- 0062 — Social Media Calendar: store the automated compliance scan of a post
--
-- The caption is public, SEBI-sensitive copy. We now run the deterministic
-- compliance engine (runComplianceChecks) over it on create / caption edit and
-- store the result here so the human reviewer sees machine-detected red flags
-- (guaranteed-returns language, missing disclaimer, etc.) alongside the manual
-- compliance sign-off. Advisory — the binding gate remains the human
-- compliance_checked + maker-checker approval.

ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS compliance_scan jsonb;
