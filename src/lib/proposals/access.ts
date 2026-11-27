/**
 * Who sees which proposal.
 *
 * A proposal is visible to
 *   - whoever prepared it (and anyone whose data wall covers them: their branch head, the owner ...), AND
 *   - whoever looks after the client or lead it is FOR - the client's relationship / servicing RM,
 *     or the lead's owner - and anyone whose wall covers that person.
 *
 * The second rule is the point: when one person prepares a proposal for another RM's client, the
 * client's RM still sees it in the Proposals module. Seeing is all this grants; changing, sending
 * or deleting a proposal stays with the person who prepared it (see the proposal routes).
 */

import { sql, type SQL } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { dataScopeSqlFor, dataScopeSqlViaOwnerBranch, resolveSalesDataScope } from "@/lib/auth/data-scope";
import { investorScopeSqlOrOwn } from "@/lib/investors/access";

/** SQL condition: "this proposal row (alias `p`, or the alias given) may be seen by this session". */
export async function proposalVisibleSql(tx: any, session: SessionUser, alias = "p"): Promise<SQL> {
  const a = sql.raw(alias);
  const prepared = await dataScopeSqlFor(tx, session, {
    branch: `${alias}.branch_id`,
    owner: `${alias}.prepared_by_user_id`,
  });
  // The client's side: the same wall the Clients list uses (own clients; a head's team; the owner's all).
  const clientWall = await investorScopeSqlOrOwn(tx, session, "vi");
  // The lead's side: leads owned by the session (or inside their wall).
  let leadWall: SQL;
  try {
    leadWall = dataScopeSqlViaOwnerBranch(await resolveSalesDataScope(tx, session), "vl.owner_id");
  } catch {
    leadWall = sql`vl.owner_id = ${session.userId}::uuid`;
  }
  // A deleted proposal is visible to nobody.
  return sql`${a}.deleted_at IS NULL AND (
    ${prepared}
    OR EXISTS (SELECT 1 FROM investors vi WHERE vi.id = ${a}.investor_id AND ${clientWall})
    OR EXISTS (SELECT 1 FROM leads vl WHERE vl.id = ${a}.lead_id AND ${leadWall})
  )`;
}

/** Single-record counterpart for routes that load one proposal by id. */
export async function canSeeProposal(tx: any, session: SessionUser, proposalId: string): Promise<boolean> {
  const visible = await proposalVisibleSql(tx, session, "p");
  const r = await tx.execute(sql`
    SELECT 1 FROM proposals p
     WHERE p.id = ${proposalId}::uuid AND p.tenant_id = ${session.tenantId}::uuid AND ${visible}
     LIMIT 1
  `);
  return r.rows.length > 0;
}
