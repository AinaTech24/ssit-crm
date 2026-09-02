-- 0163: per-tenant feature-flag overrides. subscriptions already carries
-- modules_override / allowed_nav / allowed_fields / allowed_dashboard_widgets;
-- this adds feature_flags_override so an admin can toggle an individual
-- capability (e.g. customDomain) for ONE firm without changing its package.
-- loadTenantLicense merges { ...package.feature_flags, ...this }. Additive.

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS feature_flags_override jsonb;
