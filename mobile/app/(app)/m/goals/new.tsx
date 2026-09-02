import React from "react";
import { FormScreen } from "../../../../src/components/form/FormScreen";
import { goalForm } from "../../../../src/features/forms/goals";

export default function NewGoal() {
  return <FormScreen spec={goalForm} />;
}
