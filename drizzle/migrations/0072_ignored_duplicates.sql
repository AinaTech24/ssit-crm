CREATE TABLE IF NOT EXISTS "ignored_duplicates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"key1_id" uuid NOT NULL,
	"key2_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ignored_duplicates_tenant_idx" ON "ignored_duplicates" ("tenant_id");
CREATE INDEX IF NOT EXISTS "ignored_duplicates_pair_idx" ON "ignored_duplicates" ("tenant_id", "key1_id", "key2_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ignored_duplicates_pair_unique" ON "ignored_duplicates" ("tenant_id", "key1_id", "key2_id");
