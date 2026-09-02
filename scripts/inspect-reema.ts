import "dotenv/config";
import { db } from "../src/db/client";
import { leads, leadBlueprintInstances, leadStageHistory } from "../src/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const leadId = "67e11192-2a9c-488e-99dd-f29616d0594d";
  const [l] = await db.select().from(leads).where(eq(leads.id, leadId));
  const [inst] = await db.select().from(leadBlueprintInstances).where(eq(leadBlueprintInstances.leadId, leadId));
  const history = await db.select().from(leadStageHistory).where(eq(leadStageHistory.leadId, leadId));
  
  console.log("Lead:", l);
  console.log("Instance:", inst);
  console.log("History:", history);
}

main().catch(console.error);
