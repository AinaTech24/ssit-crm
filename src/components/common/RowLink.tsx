"use client";

/**
 * Makes an entire table row clickable (navigates to `href`) while leaving inner
 * links/buttons working on their own. Drop-in for a <tr>:
 *
 *   <RowLink href={`/dashboard/x/${id}`} className="border-b hover:bg-secondary/40">
 *     <td>…</td> …
 *   </RowLink>
 */

import React from "react";
import { useRouter } from "next/navigation";

export function RowLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  return (
    <tr
      onClick={(e) => {
        // Don't hijack clicks that landed on a real interactive element inside
        // the row (its own link/button/input still does its own thing).
        if ((e.target as HTMLElement).closest("a,button,input,select,label,[role='button']")) return;
        router.push(href);
      }}
      className={`cursor-pointer ${className}`}
    >
      {children}
    </tr>
  );
}
