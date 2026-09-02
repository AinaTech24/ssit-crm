import React from "react";
import { FormScreen } from "../../../../src/components/form/FormScreen";
import { leadForm } from "../../../../src/features/forms/leads";

export default function NewLead() {
  return <FormScreen spec={leadForm} />;
}
