import React from "react";
import { FormScreen } from "../../../../src/components/form/FormScreen";
import { reviewMeetingForm } from "../../../../src/features/forms/review-meetings";

export default function NewReviewMeeting() {
  return <FormScreen spec={reviewMeetingForm} />;
}
