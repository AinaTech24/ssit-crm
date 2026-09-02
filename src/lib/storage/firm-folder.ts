/**
 * Resolve a tenant's firm display-name for the readable upload tree
 * (firm/<firm>/<uploader>/<client>/<docType>/…). Process-local cache — the
 * firm name rarely changes, and uploads aren't hot enough to warrant more.
 */

import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { tenants } from "@/db/schema";

const cache = new Map<string, string>();

export async function firmFolderName(tenantId: string): Promise<string> {
  const hit = cache.get(tenantId);
  if (hit !== undefined) return hit;
  const name = await withTenant(tenantId, async (tx) => {
    const [t] = await tx
      .select({ n: tenants.displayName })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    return t?.n ?? "";
  }).catch(() => "");
  cache.set(tenantId, name);
  return name;
}
