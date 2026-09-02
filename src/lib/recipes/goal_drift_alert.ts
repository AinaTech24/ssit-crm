/**
 * Goal drift alert.
 *
 * Per MFD-scaling research: goal-based advice is what converts a "SIP seller"
 * into a "wealth practice". When a goal drifts >10% behind the trajectory it
 * needs to hit its target, we alert the RM and send a WA prompt to the
 * investor to discuss a top-up.
 *
 * Trigger:  event `goal.drift` — emitted by the daily-ops scanner (06:30 IST)
 *           for each investor whose worst goal has fallen >10pp behind its
 *           time-trajectory (progress_pct < expected_progress_pct - 10). The
 *           scanner recomputes progress_pct + expected_progress_pct nightly
 *           (see recomputeAllGoals) and dedupes to one event per investor/day,
 *           so the client never gets spammed about multiple goals at once.
 *
 * Event payload (`event.*`): goal_name, drift_pct, goalId, rmId.
 * Subject is the investor, so subject.name / subject.rm_id resolve directly.
 *
 * Actions (sequenced):
 *   1. WhatsApp to investor — "Your <goal> is behind. Quick call?"
 *   2. Create RM task — "Goal review with <investor> — discuss top-up"
 */

import type { RecipeDef } from "./index";

export const goalDriftAlert: RecipeDef = {
  key: "goal_drift_alert",
  name: "Goal drift alert",
  description:
    "When an investor's goal slips >10% behind its target trajectory, send a WA nudge + create an RM task. The single biggest retention play against direct-plan leakage.",
  category: "retention",
  tags: ["goals", "retention", "top-up"],
  defaultTemplates: [
    {
      key: "goal_drift_wa",
      channel: "whatsapp",
      category: "transactional",
      name: "Goal drift WhatsApp nudge",
      body: {
        body: {
          text:
            "Hi {{name}}, quick heads-up on your {{goal_name}} goal — based on current SIPs, you're tracking " +
            "about {{drift_pct}}% behind the target trajectory. A short call this week to look at a small top-up " +
            "could put it back on track. When works?\n\n" +
            "Mutual fund investments are subject to market risks. Read all scheme related documents carefully.\n" +
            "— {{arn_name}}, ARN-{{arn_no}}",
        },
      },
      variables: [
        { key: "name", type: "string", source: "subject.name", required: true },
        { key: "goal_name", type: "string", source: "event.goal_name", required: true },
        { key: "drift_pct", type: "number", source: "event.drift_pct", required: true },
      ],
    },
  ],
  graph: {
    version: 1,
    startNodeId: "trigger",
    nodes: [
      { id: "trigger", type: "trigger", config: { kind: "goal.drift" } },
      {
        id: "send_wa",
        type: "send_whatsapp",
        config: {
          templateKey: "goal_drift_wa",
          variables: {
            name: "subject.name",
            goal_name: "event.goal_name",
            drift_pct: "event.drift_pct",
          },
          category: "transactional",
        },
      },
      {
        id: "create_task",
        type: "create_task",
        config: {
          title: "Goal review with {{subject.name}} — discuss {{event.goal_name}} top-up",
          type: "goal_review",
          priority: "high",
          assignee: "subject.rm_id",
          dueAfter: { amount: 3, unit: "day" },
        },
      },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e0", source: "trigger", target: "send_wa" },
      { id: "e1", source: "send_wa", target: "create_task" },
      { id: "e2", source: "create_task", target: "end" },
    ],
  },
};
