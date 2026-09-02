import "dotenv/config";
import { db } from "../src/db/client";
import { leads } from "../src/db/schema";
import { isNotNull, eq } from "drizzle-orm";

async function main() {
  console.log("Starting alignment of converted leads...");
  
  // Find leads that are converted but are not on onboarding stage yet or have legacy 'converted' stage
  const convertedLeads = await db
    .select()
    .from(leads)
    .where(isNotNull(leads.convertedInvestorId));

  console.log(`Found ${convertedLeads.length} converted leads in total.`);

  let updatedCount = 0;
  for (const lead of convertedLeads) {
    if (lead.stage === "converted") {
      console.log(`Aligning lead: ID: ${lead.id}, Name: ${lead.name}, Stage: ${lead.stage} -> request_documents`);
      await db
        .update(leads)
        .set({
          stage: "request_documents" as any,
          updatedAt: new Date(),
        })
        .where(eq(leads.id, lead.id));
      updatedCount++;
    }
  }

  console.log(`Alignment completed. Updated ${updatedCount} leads.`);
}

main().catch((err) => {
  console.error("Error running alignment:", err);
  process.exit(1);
});
