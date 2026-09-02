import "dotenv/config";
import { db } from "../src/db/client";
import { leads, investors, leadBlueprintInstances } from "../src/db/schema";
import { executeAction, ActionContext } from "../src/lib/workflow-rules/actions";
import { eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";

async function main() {
  console.log("Running Lead Conversion Rule test...");

  // We run in a transaction and roll it back at the end
  await db.transaction(async (tx) => {
    // 1. Resolve a tenantId
    const [existingLead] = await tx.select().from(leads).limit(1);
    if (!existingLead) {
      console.log("No leads found in database to run test on. Please seed database.");
      return;
    }
    const tenantId = existingLead.tenantId;

    // 2. Create a test lead
    const testLeadId = uuid();
    const [testLead] = await tx
      .insert(leads)
      .values({
        id: testLeadId,
        tenantId,
        name: "Test Automation Lead",
        phone: "9876543210",
        email: "test.automation@example.com",
        source: "website",
        stage: "new",
        notes: "Test notes. Include mock PAN ABCDE9999F inside notes for extraction.",
      } as any)
      .returning();

    console.log(`Created test lead: ID = ${testLeadId}, Name = ${testLead.name}`);

    // 3. Set up the ActionContext
    const ctx: ActionContext = {
      tenantId,
      subjectType: "lead",
      subjectId: testLeadId,
      record: testLead as any,
      tx,
    };

    // 4. Run the convert_lead action
    const actionConfig = {
      segmentTag: "HNI",
      investorCategory: "individual",
    };

    console.log("Executing convert_lead action...");
    const result = await executeAction(
      {
        type: "convert_lead",
        config: actionConfig,
      },
      ctx
    );

    console.log("Action result:", result);

    if (result.status !== "succeeded") {
      throw new Error(`Action failed: ${result.error}`);
    }

    // 5. Verify the updates
    // Verify lead is converted
    const [updatedLead] = await tx
      .select()
      .from(leads)
      .where(eq(leads.id, testLeadId))
      .limit(1);

    console.log("Updated Lead stage:", updatedLead.stage);
    console.log("Updated Lead convertedInvestorId:", updatedLead.convertedInvestorId);

    if (updatedLead.stage !== "request_documents" || !updatedLead.convertedInvestorId) {
      throw new Error("Lead was not marked request_documents correctly!");
    }

    // Verify investor record was created
    const [investor] = await tx
      .select()
      .from(investors)
      .where(eq(investors.id, updatedLead.convertedInvestorId))
      .limit(1);

    if (!investor) {
      throw new Error("Investor record not found!");
    }

    console.log("Created Investor:", {
      id: investor.id,
      name: investor.name,
      pan: investor.pan,
      segmentTag: investor.segmentTag,
    });

    if (investor.pan !== "ABCDE9999F") {
      throw new Error(`Expected PAN to be extracted from notes as ABCDE9999F, but got: ${investor.pan}`);
    }

    // Verify blueprint instance is advanced
    const [bpInstance] = await tx
      .select()
      .from(leadBlueprintInstances)
      .where(eq(leadBlueprintInstances.leadId, testLeadId))
      .limit(1);

    if (!bpInstance) {
      throw new Error("Lead Blueprint Instance not found!");
    }

    console.log("Lead Blueprint stage after convert:", bpInstance.currentStageKey);
    if (bpInstance.currentStageKey !== "request_documents") {
      throw new Error(`Expected blueprint stage to be request_documents, but got: ${bpInstance.currentStageKey}`);
    }

    console.log("All verifications passed! Rolling back transaction to keep DB clean...");
    tx.rollback();
  }).catch((err) => {
    // If rollback was triggered on purpose, it's successful
    if (err instanceof Error && (err.message.includes("Rollback") || err.name === "TransactionRollbackError")) {
      console.log("Transaction rolled back successfully. Test passed!");
    } else {
      console.error("Test failed with error:", err);
      process.exit(1);
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
