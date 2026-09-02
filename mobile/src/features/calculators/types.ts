/**
 * Calculator framework types. A calculator is DATA: a list of typed inputs + a
 * pure `compute(values) => ResultBlock[]`. One screen (`[key].tsx`) renders any
 * calculator from its definition, so adding a calculator is adding a registry
 * entry — never a new screen. ResultBlock mirrors the web PdfBlock vocabulary
 * (stat / section / table / insight) so the on-screen output matches the web
 * illustration one-to-one.
 */

import { type ComponentProps } from "react";
import { Feather } from "@expo/vector-icons";

export type FeatherName = ComponentProps<typeof Feather>["name"];

export type InputType = "money" | "number" | "percent" | "years" | "int" | "segmented" | "toggle";

export interface InputSpec {
  key: string;
  label: string;
  type: InputType;
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  /** For `segmented` inputs. */
  options?: { value: string; label: string }[];
  hint?: string;
  /** Show this input only when another input's value satisfies the predicate. */
  visibleIf?: (values: Record<string, any>) => boolean;
}

export type Tone = "brand" | "success" | "warning" | "danger" | "neutral" | "violet";

export type ResultBlock =
  | { type: "stat"; label: string; value: string; tone?: Tone; hint?: string }
  | { type: "section"; text: string }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "insight"; text: string; tone?: Tone };

export interface CalculatorDef {
  key: string;
  name: string;
  group: string;
  icon: FeatherName;
  desc: string;
  inputs: InputSpec[];
  /** Pure — no side effects. Receives coerced values (numbers for numeric inputs). */
  compute: (v: Record<string, any>) => ResultBlock[];
}
