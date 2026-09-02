/**
 * Create Task — exact parity with the web /dashboard/tasks/new form, rendered
 * by the config-driven FormScreen from the taskForm spec (What / Related to /
 * Routing + schedule, conditional custom-type + recurrence, related-entity
 * typeaheads). Posts to POST /api/tasks.
 */

import React from "react";
import { FormScreen } from "../../../../src/components/form/FormScreen";
import { taskForm } from "../../../../src/features/forms/tasks";

export default function NewTask() {
  return <FormScreen spec={taskForm} />;
}
