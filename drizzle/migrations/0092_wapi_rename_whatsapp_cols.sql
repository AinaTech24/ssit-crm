-- 0092 — Scrub AiSensy naming from the WhatsApp schema now that Wapi (SSIT
-- WhatsApp) is the sole provider. The columns are provider-neutral data (the
-- Meta-registered template name / language), so just rename them; drop the
-- now-unused per-number AiSensy app id. The `wa_templates_unique` index follows
-- the renamed columns automatically.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'whatsapp_templates' AND column_name = 'aisensy_name') THEN
    ALTER TABLE whatsapp_templates RENAME COLUMN aisensy_name TO meta_template_name;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'whatsapp_templates' AND column_name = 'aisensy_language') THEN
    ALTER TABLE whatsapp_templates RENAME COLUMN aisensy_language TO meta_language;
  END IF;
END $$;

ALTER TABLE whatsapp_numbers DROP COLUMN IF EXISTS aisensy_app_id;
