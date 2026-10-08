"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

const Checkbox = React.forwardRef(({ className, checked, onCheckedChange, disabled, ...props }, ref) => {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      ref={ref}
      className={cn(
        "peer h-4 w-4 shrink-0 rounded border border-slate-300 bg-white ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-colors flex items-center justify-center",
        checked && "bg-primary border-primary text-white",
        className
      )}
      {...props}
    >
      {checked && <Check className="h-3 w-3 stroke-[3]" />}
    </button>
  );
});
Checkbox.displayName = "Checkbox";

export { Checkbox };
