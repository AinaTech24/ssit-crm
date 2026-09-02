"use client";

/**
 * Drop-in replacement for a native <select>. Keeps the SAME call-site shape —
 * `value`, an `onChange(e)` that reads `e.target.value`, and `<option>` children
 * — but renders our branded custom <Select> (no black outline, styled popup).
 *
 * Convert by renaming the tag:  <select …>…</select>  →  <SelectField …>…</SelectField>
 *
 * Only layout-affecting classes (width / flex / grid-span / margin) are kept
 * from the original className so the custom control's own chrome isn't doubled.
 */

import React from "react";
import { Select, type SelectOption } from "./Select";

/** Keep only width / flex / grid / margin classes — drop visual ones that would
 *  fight the custom control's own border/height/background. */
function layoutClasses(cn?: string): string {
  if (!cn) return "";
  const KEEP = /^(w-|min-w-|max-w-|flex$|flex-|grow|shrink|basis-|col-span-|row-span-|order-|self-|justify-self-|m-|mt-|mb-|ml-|mr-|mx-|my-|!w-)/;
  return cn
    .split(/\s+/)
    .filter((c) => KEEP.test(c))
    .join(" ");
}

function collectOptions(children: React.ReactNode): SelectOption[] {
  const out: SelectOption[] = [];
  React.Children.forEach(children, (child: any) => {
    if (!child || typeof child !== "object") return;
    if (child.type === "option") {
      const value = child.props.value != null ? String(child.props.value) : "";
      const c = child.props.children;
      const label =
        typeof c === "string" || typeof c === "number"
          ? String(c)
          : Array.isArray(c)
            ? c.filter((x: any) => typeof x === "string" || typeof x === "number").join("")
            : String(c ?? value);
      out.push({ value, label: label || value, disabled: !!child.props.disabled });
    } else if (child.type === "optgroup") {
      out.push(...collectOptions(child.props.children));
    } else if (child.props && child.props.children) {
      out.push(...collectOptions(child.props.children)); // fragments / arrays
    }
  });
  return out;
}

export function SelectField({
  value,
  onChange,
  children,
  options: optionsProp,
  className,
  disabled,
  id,
  name,
  size = "md",
  placeholder,
  searchable = false,
  searchPlaceholder,
  "aria-label": ariaLabel,
}: {
  value?: string | number | null;
  onChange?: (e: { target: { value: string; name?: string } }) => void;
  children?: React.ReactNode;
  options?: SelectOption[];
  className?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  size?: "sm" | "md";
  placeholder?: string;
  /** Show a filter box at the top of the menu — handy for long option lists. */
  searchable?: boolean;
  searchPlaceholder?: string;
  "aria-label"?: string;
  // tolerate (and ignore) leftover native props from a mechanical conversion
  required?: boolean;
  title?: string;
}) {
  const options = optionsProp ?? collectOptions(children);
  // Synthetic event tolerant of handlers that call e.stopPropagation()/
  // preventDefault() or read e.currentTarget — so a mechanical conversion of a
  // native onChange never crashes.
  const fire = (v: string) => {
    const ev: any = {
      target: { value: v, name },
      currentTarget: { value: v, name },
      stopPropagation() {},
      preventDefault() {},
    };
    onChange?.(ev);
  };
  return (
    <Select
      value={value != null ? String(value) : ""}
      onChange={fire}
      options={options}
      placeholder={placeholder ?? "Select…"}
      disabled={disabled}
      className={layoutClasses(className) || "w-full"}
      ariaLabel={ariaLabel}
      size={size}
      id={id}
      searchable={searchable}
      searchPlaceholder={searchPlaceholder}
    />
  );
}
