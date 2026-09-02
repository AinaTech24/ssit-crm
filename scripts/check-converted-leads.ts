import "dotenv/config";
import { db } from "../src/db/client";
import { leads } from "../src/db/schema";
import { isNotNull, eq, sql } from "drizzle-orm";

async function main() {
  console.log("Fetching leads that have convertedInvestorId set...");
  const convertedLeads = await db
    .select()
    .from(leads)
    .where(isNotNull(leads.convertedInvestorId));
  
  console.log(`Found ${convertedLeads.length} leads:`);
  for (const l of convertedLeads) {
    console.log(`- ID: ${l.id}, Name: ${l.name}, Stage: ${l.stage}, ConvertedInvestorId: ${l.convertedInvestorId}`);
  }

  console.log("\nFetching leads that have stage = 'converted'...");
  const stageConvertedLeads = await db
    .select()
    .from(leads)
    .where(eq(leads.stage, "converted"));

  console.log(`Found ${stageConvertedLeads.length} leads:`);
  for (const l of stageConvertedLeads) {
    console.log(`- ID: ${l.id}, Name: ${l.name}, Stage: ${l.stage}, ConvertedInvestorId: ${l.convertedInvestorId}`);
  }
}

main().catch(console.error);
