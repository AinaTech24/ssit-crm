"use client";

/**
 * Thin client wrappers that make a server-rendered table `<tr>` interactive
 * without converting the whole table to a client component. The `<td>` cells
 * are passed through as children.
 *
 *   <ClickableRow href="/…">  — navigates on row click
 *   <PdfRow pdfUrl downloadUrl> — opens the shared PdfModal on row click
 *
 * Both ignore clicks that land on a nested link/button/input/select so the
 * row's own controls keep working.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PdfModal } from "./PdfModal";

const INTERACTIVE = "a, button, input, select, [role='switch'], [role='menu'], [data-no-row-nav]";

export function ClickableRow({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <tr
      className={`${className ?? ""} cursor-pointer`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
        router.push(href);
      }}
    >
      {children}
    </tr>
  );
}

export function PdfRow({
  title,
  pdfUrl,
  downloadUrl,
  disabled,
  className,
  children,
}: {
  title: string;
  pdfUrl: string;
  downloadUrl?: string;
  /** When true the row is not clickable (e.g. no document exists yet). */
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr
        className={`${className ?? ""} ${disabled ? "" : "cursor-pointer"}`}
        onClick={(e) => {
          if (disabled) return;
          if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
          setOpen(true);
        }}
      >
        {children}
      </tr>
      {open && <PdfModal title={title} pdfUrl={pdfUrl} downloadUrl={downloadUrl} onClose={() => setOpen(false)} />}
    </>
  );
}
