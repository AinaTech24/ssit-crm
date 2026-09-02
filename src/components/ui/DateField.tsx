"use client";

/**
 * Drop-in replacement for <input type="date">. Same call-site shape — `value`
 * (ISO yyyy-mm-dd) + `onChange(e)` reading `e.target.value` — but renders our
 * branded calendar <DatePicker>.
 *
 * Convert:  <input type="date" …/>  →  <DateField …/>
 */

import { DatePicker } from "./DatePicker";

function layoutClasses(cn?: string): string {
  if (!cn) return "";
  const KEEP = /^(w-|min-w-|max-w-|flex$|flex-|grow|shrink|basis-|col-span-|row-span-|order-|self-|justify-self-|m-|mt-|mb-|ml-|mr-|mx-|my-|!w-)/;
  return cn.split(/\s+/).filter((c) => KEEP.test(c)).join(" ");
}

export function DateField({
  value,
  onChange,
  className,
  disabled,
  min,
  max,
  id,
  name,
  size = "md",
  "aria-label": ariaLabel,
}: {
  value?: string | null;
  onChange?: (e: { target: { value: string; name?: string } }) => void;
  className?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
  id?: string;
  name?: string;
  size?: "sm" | "md";
  "aria-label"?: string;
  // tolerate leftover native props from a mechanical conversion
  required?: boolean;
  title?: string;
  placeholder?: string;
}) {
  const fire = (iso: string) => {
    const ev: any = {
      target: { value: iso, name },
      currentTarget: { value: iso, name },
      stopPropagation() {},
      preventDefault() {},
    };
    onChange?.(ev);
  };
  return (
    <DatePicker
      value={value ?? ""}
      onChange={fire}
      className={layoutClasses(className) || "w-full"}
      disabled={disabled}
      min={min}
      max={max}
      ariaLabel={ariaLabel}
      size={size}
    />
  );
}
