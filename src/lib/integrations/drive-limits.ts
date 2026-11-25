/** Safe to import from browser code (no server dependencies). */

/** Largest video the CRM will take. Above this the person uploads to Drive themselves and pastes the link. */
export const MAX_DRIVE_UPLOAD_BYTES = 500 * 1024 * 1024;

export const formatMb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;
