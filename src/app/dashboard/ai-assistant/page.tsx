import { requireSession } from "@/lib/auth/session";
import { AssistantChat } from "@/components/ai/AssistantChat";

export const dynamic = "force-dynamic";

/**
 * AI Assistant — a modern chat over the firm's live CRM data. Read-only and
 * scoped strictly to SSIT CRM. History / archive / delete + model selection all
 * live inside <AssistantChat/>.
 */
export default async function AiAssistantPage() {
  const session = await requireSession();
  const canInsights = session.roles?.some((r) => ["owner", "branch_head", "ops"].includes(r));
  return <AssistantChat insightsHref={canInsights ? "/dashboard/ai-assistant/insights" : undefined} />;
}
