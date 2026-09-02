ALTER TABLE "ddq_checklist_status" ADD COLUMN "document_id" uuid;
CREATE INDEX IF NOT EXISTS "ddq_checklist_status_document_idx" ON "ddq_checklist_status" ("tenant_id", "document_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ddq_checklist_status_document_id_compliance_documents_id_fk'
  ) THEN
    ALTER TABLE "ddq_checklist_status" 
    ADD CONSTRAINT "ddq_checklist_status_document_id_compliance_documents_id_fk" 
    FOREIGN KEY ("document_id") REFERENCES "compliance_documents"("id") ON DELETE SET NULL;
  END IF;
END $$;
