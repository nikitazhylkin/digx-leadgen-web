"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Sheet — a right-side slide-in panel built on base-ui Dialog.
 * Used for lead detail preview without leaving the table context (Clay-style).
 */

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = DialogPrimitive.Portal;

export function SheetBackdrop({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      className={cn(
        "fixed inset-0 z-50 bg-black/40 backdrop-blur-sm",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  );
}

export interface SheetContentProps extends DialogPrimitive.Popup.Props {
  side?: "right" | "left";
  widthClass?: string;
}

export const SheetContent = React.forwardRef<HTMLDivElement, SheetContentProps>(
  ({ className, children, side = "right", widthClass = "w-[640px] max-w-[92vw]", ...props }, ref) => (
    <SheetPortal>
      <SheetBackdrop />
      <DialogPrimitive.Popup
        ref={ref}
        className={cn(
          "fixed top-0 bottom-0 z-50 flex flex-col bg-background border-border shadow-2xl outline-none",
          side === "right" ? "right-0 border-l" : "left-0 border-r",
          widthClass,
          "data-[state=open]:animate-in data-[state=closed]:animate-out duration-200",
          side === "right"
            ? "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
            : "data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </SheetPortal>
  )
);
SheetContent.displayName = "SheetContent";

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-start justify-between gap-4 px-6 py-4 border-b border-border shrink-0", className)}
      {...props}
    />
  );
}

export function SheetTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      className={cn("text-lg font-semibold leading-tight text-foreground", className)}
      {...props}
    />
  );
}

export function SheetDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export function SheetBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 overflow-y-auto px-6 py-5", className)} {...props} />;
}

export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center justify-end gap-2 px-6 py-3 border-t border-border shrink-0", className)}
      {...props}
    />
  );
}

export function SheetCloseButton() {
  return (
    <SheetClose
      className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      aria-label="Close"
    >
      <X className="h-4 w-4" />
    </SheetClose>
  );
}
