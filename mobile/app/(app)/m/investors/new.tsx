import React from "react";
import { FormScreen } from "../../../../src/components/form/FormScreen";
import { investorForm } from "../../../../src/features/forms/investors";

export default function NewInvestor() {
  return <FormScreen spec={investorForm} />;
}
