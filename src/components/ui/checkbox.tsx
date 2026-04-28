"use client";

import * as React from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

type CheckedState = boolean | "indeterminate";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "checked" | "type"> {
  checked?: CheckedState;
  onCheckedChange?: (checked: boolean) => void;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked = false, onCheckedChange, disabled, ...props }, ref) => {
    const isIndeterminate = checked === "indeterminate";
    const isChecked = checked === true;

    return (
      <label
        className={cn(
          "inline-flex items-center justify-center cursor-pointer select-none",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <input
          ref={ref}
          type="checkbox"
          className="sr-only peer"
          checked={isChecked}
          disabled={disabled}
          onChange={(e) => onCheckedChange?.(e.target.checked)}
          {...props}
        />
        <span
          className={cn(
            "inline-flex items-center justify-center h-4 w-4 rounded border transition-colors",
            "border-border bg-card",
            (isChecked || isIndeterminate) && "bg-[#00C4C8] border-[#00C4C8] text-white",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-[#00C4C8] peer-focus-visible:ring-offset-2",
            className
          )}
        >
          {isIndeterminate ? (
            <Minus className="h-3 w-3" strokeWidth={3} />
          ) : isChecked ? (
            <Check className="h-3 w-3" strokeWidth={3} />
          ) : null}
        </span>
      </label>
    );
  }
);
Checkbox.displayName = "Checkbox";
