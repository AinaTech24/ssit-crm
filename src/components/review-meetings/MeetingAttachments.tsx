"use client";

/**
 * Meeting document attachments.
 *
 * Thin wrappers over the shared implementation in
 * `@/components/common/EntityAttachments` — meetings and tasks expose the same
 * attachment routes, so they share one component rather than two copies that
 * drift. The exports here are unchanged so existing call sites keep working.
 */

import {
  AttachmentPicker,
  EntityAttachments,
  uploadAttachments,
  MAX_ATTACHMENT_BYTES,
  fmtSize,
} from "@/components/common/EntityAttachments";

export { MAX_ATTACHMENT_BYTES, fmtSize };

const base = (meetingId: string) => `/api/review-meetings/${meetingId}/attachments`;

/** POSTs files to a meeting's attachment endpoint. */
export function uploadMeetingAttachments(meetingId: string, files: File[]) {
  return uploadAttachments(base(meetingId), files);
}

/** File picker for the "Add meeting" form, before the meeting exists. */
export function MeetingAttachmentPicker(props: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  return (
    <AttachmentPicker
      {...props}
      hint="Drop agenda packs, statements or forms here — or use “Add files”. They upload when the meeting is scheduled. Max 25 MB each."
    />
  );
}

/** Upload / list / download / delete documents on a saved meeting. */
export function MeetingAttachments({
  meetingId,
  label = "Attachments",
  readOnly,
}: {
  meetingId: string;
  label?: string;
  readOnly?: boolean;
}) {
  return <EntityAttachments basePath={base(meetingId)} label={label} readOnly={readOnly} />;
}
