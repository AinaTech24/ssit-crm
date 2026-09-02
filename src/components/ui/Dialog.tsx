"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, showClose = true, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { showClose?: boolean }) {
  return <DialogPrimitive.Portal><DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-foreground/35 backdrop-blur-[1px] data-[state=open]:animate-fade-in" /><DialogPrimitive.Content className={cn("fixed left-1/2 top-1/2 z-[91] max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-popover p-5 text-popover-foreground shadow-xl data-[state=open]:animate-dialog-in", className)} {...props}>{children}{showClose && <DialogPrimitive.Close className="btn-icon absolute right-3 top-3 size-8" aria-label="Close dialog"><X className="size-4" /></DialogPrimitive.Close>}</DialogPrimitive.Content></DialogPrimitive.Portal>;
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn("space-y-1 pr-8", className)} {...props} />; }
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn("mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />; }
export function DialogTitle({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) { return <DialogPrimitive.Title className={cn("text-base font-semibold", className)} {...props} />; }
export function DialogDescription({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) { return <DialogPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />; }

