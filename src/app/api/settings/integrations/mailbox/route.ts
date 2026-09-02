/**
 * Mailbox (SMTP send + IMAP receive) — "map your own email account".
 *
 * Two scopes share this route:
 *   scope=tenant  → the firm-wide default mailbox (owner-only)
 *   scope=user    → the signed-in RM's PERSONAL mailbox (any user, keyed to them)
 *
 * When a mailbox is connected + active, the send pipeline prefers it over Resend
 * (the user's own mailbox first, then the firm's), so client email originates
 * from the real address. IMAP creds feed the inbound-sync worker.
 *
 *   GET    ?scope= → non-secret status (hosts/users, connected flags, identity)
 *   POST   ?scope= → save { smtp, imap?, fromName?, fromEmail?, replyTo? } (encrypted)
 *   DELETE ?scope= → disconnect (revert to the firm mailbox / Resend)
 *
 * Passwords are write-only: leave blank on edit to keep the saved one.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import {
  getTenantIntegration,
  getUserMailbox,
  upsertTenantIntegration,
  disableTenantIntegration,
  type TenantIntegrationResolved,
} from "@/lib/comms/integrations";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

type Scope = "tenant" | "user";

function readScope(req: NextRequest): Scope {
  return new URL(req.url).searchParams.get("scope") === "user" ? "user" : "tenant";
}

/** Tenant-scope mailbox is owner-only; user-scope is the user's own — anyone. */
function scopeGuard(scope: Scope, roles: string[] | undefined): NextResponse | null {
  if (scope === "tenant" && !roles?.includes("owner")) {
    return NextResponse.json({ error: "forbidden: only the firm owner can connect the firm mailbox" }, { status: 403 });
  }
  return null;
}

async function loadMailbox(
  tx: any,
  tenantId: string,
  scope: Scope,
  userId: string
): Promise<TenantIntegrationResolved | null> {
  return scope === "user" ? getUserMailbox(tx, tenantId, userId) : getTenantIntegration(tx, tenantId, "mailbox");
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const scope = readScope(req);
    const m = await withTenant(session.tenantId, async (tx) => loadMailbox(tx, session.tenantId, scope, session.userId));
    const cfg: any = m?.config ?? {};
    const smtp = cfg.smtp;
    const imap = cfg.imap;
    const oauth = cfg.oauth as { provider?: string; email?: string } | undefined;
    return NextResponse.json({
      scope,
      connected: !!(m?.isActive && (smtp?.host || oauth?.provider)),
      oauth: oauth?.provider ? { provider: oauth.provider, email: oauth.email ?? null } : null,
      smtp: smtp ? { host: smtp.host, port: smtp.port, secure: smtp.secure, user: smtp.user, hasPass: !!smtp.pass } : null,
      imap: imap ? { host: imap.host, port: imap.port, secure: imap.secure, user: imap.user, hasPass: !!imap.pass } : null,
      fromName: m?.senderConfig?.fromName ?? "",
      fromEmail: m?.senderConfig?.fromEmail ?? "",
      replyTo: m?.senderConfig?.replyTo ?? "",
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const Server = z.object({
  host: z.string().trim().min(1).max(200),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().trim().min(1).max(200),
  pass: z.string().max(500).optional().or(z.literal("")),
});

const SaveSchema = z.object({
  fromName: z.string().trim().max(120).optional().or(z.literal("")),
  fromEmail: z.string().trim().email().max(200).optional().or(z.literal("")),
  replyTo: z.string().trim().email().max(200).optional().or(z.literal("")),
  smtp: Server,
  imap: Server.optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const scope = readScope(req);
    const forbidden = scopeGuard(scope, session.roles);
    if (forbidden) return forbidden;

    const parsed = SaveSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid input", details: parsed.error.flatten() }, { status: 400 });
    }
    const d = parsed.data;
    const userId = scope === "user" ? session.userId : null;

    await withTenant(session.tenantId, async (tx) => {
      const existing = await loadMailbox(tx, session.tenantId, scope, session.userId);
      const exCfg: any = existing?.config ?? {};
      const exSmtp = exCfg.smtp ?? {};
      const exImap = exCfg.imap ?? {};

      const config: Record<string, any> = {
        // Preserve any existing OAuth binding only if the user isn't replacing it
        // with explicit SMTP creds (connecting password SMTP supersedes OAuth).
        smtp: { ...d.smtp, pass: d.smtp.pass || exSmtp.pass || "" },
      };
      if (d.imap) {
        config.imap = { ...d.imap, pass: d.imap.pass || exImap.pass || "" };
      } else if (exImap.host) {
        config.imap = exImap; // keep previously-saved IMAP if the form omitted it
      }

      await upsertTenantIntegration(
        tx,
        session.tenantId,
        "mailbox",
        config,
        {
          fromName: d.fromName || undefined,
          fromEmail: d.fromEmail || d.smtp.user,
          replyTo: d.replyTo || undefined,
        },
        { userId }
      );
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    const scope = readScope(req);
    const forbidden = scopeGuard(scope, session.roles);
    if (forbidden) return forbidden;
    const userId = scope === "user" ? session.userId : null;
    await withTenant(session.tenantId, async (tx) => {
      await disableTenantIntegration(tx, session.tenantId, "mailbox", { userId });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
