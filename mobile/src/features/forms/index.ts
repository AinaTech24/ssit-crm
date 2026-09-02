/**
 * Form registry — maps a module key to its FormSpec. The generic
 * /m/[module]/new route (and dedicated module screens) render a FormScreen from
 * the matching spec. The app is scoped to 8 modules + Settings infra, so this is
 * the create forms for those only.
 *
 * Keys are the mobile route/drawer keys (the `module` param in /m/<key>/new).
 */

import type { FormSpec } from "./types";
import { investorForm } from "./investors";
import { leadForm } from "./leads";
import { taskForm } from "./tasks";
import { activityForm } from "./activities";
import { reviewMeetingForm } from "./review-meetings";
import { goalForm } from "./goals";
import { employeeForm } from "./employees";

export const FORMS: Record<string, FormSpec> = {
  investors: investorForm,
  leads: leadForm,
  tasks: taskForm,
  activities: activityForm,
  "review-meetings": reviewMeetingForm,
  goals: goalForm,
  employees: employeeForm, // team management via Settings
};

export function getForm(module: string): FormSpec | undefined {
  return FORMS[module];
}
