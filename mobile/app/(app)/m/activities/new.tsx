import React from "react";
import { FormScreen } from "../../../../src/components/form/FormScreen";
import { activityForm } from "../../../../src/features/forms/activities";

export default function NewActivity() {
  return <FormScreen spec={activityForm} />;
}
