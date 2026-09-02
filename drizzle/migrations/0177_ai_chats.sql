-- AI Assistant chat persistence — conversation history, archive, delete.
-- Two tables: `ai_chats` (one row per conversation) and `ai_chat_messages`
-- (the turns). Tenant-scoped via RLS; additionally each chat belongs to ONE
-- user (the assistant is a per-user workspace, not shared across the firm).
CREATE TABLE IF NOT EXISTS ai_chats (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  user_id         uuid NOT NULL,
  title           text NOT NULL DEFAULT 'New chat',
  -- Tier used for this chat's last turn ("fast" | "reasoning") — the UI selector.
  model           text NOT NULL DEFAULT 'reasoning',
  archived_at     timestamptz,
  last_message_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_chats_user_idx
  ON ai_chats (tenant_id, user_id, archived_at, last_message_at DESC);

ALTER TABLE ai_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chats FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ai_chats;
CREATE POLICY tenant_isolation ON ai_chats FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  chat_id     uuid NOT NULL REFERENCES ai_chats(id) ON DELETE CASCADE,
  role        text NOT NULL,                 -- 'user' | 'assistant'
  content     text NOT NULL,                 -- markdown
  -- Structured live-data snapshot the assistant grounded this reply on (for
  -- rendering redirect tiles / audit); null on user turns.
  metrics     jsonb,
  model       text,                          -- tier used for an assistant turn
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_chat_messages_chat_idx
  ON ai_chat_messages (tenant_id, chat_id, created_at);

ALTER TABLE ai_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chat_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ai_chat_messages;
CREATE POLICY tenant_isolation ON ai_chat_messages FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
