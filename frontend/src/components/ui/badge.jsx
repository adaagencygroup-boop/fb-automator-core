import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-blue-200 bg-primary-subtle text-primary",
        secondary: "border-border bg-secondary text-secondary-foreground",
        success: "border-emerald-200 bg-emerald-50 text-emerald-700 font-medium",
        warning: "border-amber-200 bg-amber-50 text-amber-700 font-medium",
        destructive: "border-red-200 bg-red-50 text-red-700 font-medium",
        info: "border-blue-200 bg-blue-50 text-blue-700 font-medium",
        outline: "text-slate-700 border-border bg-white",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({ className, variant, ...props }) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
