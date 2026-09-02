/**
 * Form engine types. A FormSpec describes ONE module's create/edit form so it
 * renders as native mobile UI while POSTing the EXACT same payload the web CRM
 * sends — field-for-field parity, one spec per module (see ./index.ts).
 */

import type { Router } from "expo-router";

export type FieldType =
  | "text"
  | "email"
  | "tel"
  | "number"
  | "date"
  | "select"
  | "multiselect"
  | "textarea"
  | "switch"
  | "lookup"
  | "typeahead"
  | "repeater"
  | "audience" // campaign audience builder → resolves a segmentId
  | "readonly"; // computed/derived display (value comes from `derive`)

export interface Option {
  value: string;
  label: string;
}

export interface FieldSpec {
  key: string;
  label: string;
  type?: FieldType; // default "text"
  /** For select — plain strings or { value, label } pairs (mirrors the web). */
  options?: Array<string | Option>;
  required?: boolean;
  placeholder?: string;
  help?: string;
  /** Only render this field when the predicate holds (conditional visibility). */
  visibleIf?: (v: FormValues) => boolean;
  /** readonly: how to format the displayed value (default String(value)). */
  format?: (v: any, form: FormValues) => string;
  /** date: cap the max selectable date at today. */
  maxToday?: boolean;
  keyboard?: "default" | "email-address" | "phone-pad" | "numeric" | "decimal-pad";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  /** onChange transform (e.g. uppercase PAN, digits-only Aadhaar). */
  transform?: (v: string) => string;

  // lookup (async options fetched from an endpoint)
  lookupEndpoint?: string;
  lookupEnvelope?: string; // key in the response holding the array (default "rows")
  lookupLabel?: (row: any) => string;
  lookupValue?: (row: any) => string; // default row.id
  /** Keep only rows matching this predicate (e.g. approved templates of a channel). */
  lookupFilter?: (row: any, form: FormValues) => boolean;
  clearable?: boolean;

  // typeahead (search-as-you-type against an endpoint returning grouped results,
  // e.g. /api/search?q=… → { investors:[…], leads:[…] }). Used for client / lead
  // pickers over a large book where a full-list dropdown isn't practical.
  searchEndpoint?: string;
  searchParam?: string; // query param name (default "q")
  searchEnvelope?: string; // key in the response holding the rows (e.g. "investors")
  searchMinChars?: number; // default 2
  searchLabel?: (row: any) => string;
  searchValue?: (row: any) => string; // default row.id
  searchSublabel?: (row: any) => string;
  searchExtraParams?: Record<string, string>;

  // repeater (list of sub-objects, e.g. nominees / referrals)
  itemFields?: FieldSpec[];
  addLabel?: string;
  itemTitle?: (item: any, i: number) => string;
}

export interface SectionSpec {
  title?: string;
  fields: FieldSpec[];
  /** Hide the whole section unless this returns true (e.g. edit-only sections). */
  visibleIf?: (v: FormValues) => boolean;
}

export interface StepSpec {
  title: string;
  description?: string;
  sections: SectionSpec[];
}

export type FormValues = Record<string, any>;

export interface AfterCreateCtx {
  router: Router;
  params: Record<string, string>;
  post: (path: string, body: unknown) => Promise<any>;
}

export interface FormSpec {
  title: string;
  endpoint: string;
  method?: "POST" | "PATCH";
  submitLabel: string;
  /** Single-page form: the sections rendered top-to-bottom. */
  sections?: SectionSpec[];
  /** Multi-step wizard: renders a stepper with Back/Next; submit on last step.
   *  Provide EITHER sections OR steps. */
  steps?: StepSpec[];
  /** Default form state. May be a function of route params (e.g. familyRole). */
  initial: FormValues | ((params: Record<string, string>) => FormValues);
  /** Return { fieldKey: message } to block submit, or null to allow. */
  validate?: (v: FormValues) => Record<string, string> | null;
  /** Map form state → request body (the parity contract). */
  buildBody: (v: FormValues, params: Record<string, string>) => any;
  /** Route to navigate to after success. Return null to just go back. */
  redirect?: (json: any, v: FormValues, params: Record<string, string>) => string | null;
  /** Full control of post-create side effects + navigation (e.g. family link). */
  afterCreate?: (json: any, v: FormValues, ctx: AfterCreateCtx) => Promise<void> | void;
  /** Derived fields recomputed on every change (e.g. nextReviewAt). */
  derive?: (v: FormValues) => Partial<FormValues> | null;
  /** TanStack query keys to invalidate on success (for list freshness). */
  invalidate?: string[];

  // ── Edit mode (when the route has ?editId=<id>) ──
  /** Header title in edit mode (default "Edit"). */
  editTitle?: string;
  /** Map the fetched record → form state for edit mode. Presence enables edit. */
  editInitial?: (record: any, params: Record<string, string>) => FormValues;
  /** Key in the GET response holding the record (default: the response itself). */
  editRecordEnvelope?: string;
}
