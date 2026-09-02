"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export function SheetContent({ side = "right", className, children, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { side?: "left" | "right" | "bottom" }) {
  const position = side === "left" ? "inset-y-0 left-0 h-full w-[min(90vw,28rem)]" : side === "bottom" ? "inset-x-0 bottom-0 max-h-[85vh] w-full rounded-t-lg" : "inset-y-0 right-0 h-full w-[min(90vw,28rem)]";
  return <DialogPrimitive.Portal><DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-foreground/35 backdrop-blur-[1px]" /><DialogPrimitive.Content className={cn("fixed z-[91] overflow-y-auto border bg-popover p-5 text-popover-foreground shadow-xl", position, className)} {...props}>{children}<DialogPrimitive.Close className="btn-icon absolute right-3 top-3 size-8" aria-label="Close panel"><X className="size-4" /></DialogPrimitive.Close></DialogPrimitive.Content></DialogPrimitive.Portal>;
}

export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;
