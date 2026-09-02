import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { getAiStatusForAdmin, AI_PROVIDERS } from "@/lib/ai/provider";
import { AiSettingsForm } from "@/components/super-admin/AiSettingsForm";

export const dynamic = "force-dynamic";

export default async function PlatformAiPage() {
  const session = await requireSession();
  requirePlatform(session.roles, "platform.settings.manage");

  const status = await getAiStatusForAdmin();

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI &amp; Models</h1>
        <p className="text-muted-foreground text-sm">
          Choose the AI engine (Google Gemini or Anthropic Claude), set the model per tier, and
          rotate the API key — applied across every tenant within ~30 seconds, no redeploy.
        </p>
      </div>

      <AiSettingsForm initial={status} providers={AI_PROVIDERS} />

      <div className="border rounded-lg bg-muted/30 p-4 text-xs text-muted-foreground space-y-1.5 max-w-2xl">
        <p className="font-medium text-foreground">How it works</p>
        <p>
          Every AI feature — lead scoring, client briefs, policy extraction, meeting summaries,
          circular digests, WhatsApp triage, translation — routes through this one setting. Swapping
          the provider here swaps it everywhere.
        </p>
        <p>
          If no key is set here, the platform falls back to environment variables
          (<code className="bg-background px-1 rounded">GEMINI_API_KEY</code> /{" "}
          <code className="bg-background px-1 rounded">ANTHROPIC_API_KEY</code>). The key saved here
          always wins and is stored encrypted.
        </p>
      </div>
    </div>
  );
}
