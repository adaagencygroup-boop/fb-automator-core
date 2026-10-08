import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-xs font-semibold ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover shadow-sm active:scale-[0.99]",
        primary: "bg-primary text-primary-foreground hover:bg-primary-hover shadow-sm active:scale-[0.99]",
        destructive: "bg-destructive text-destructive-foreground hover:bg-red-600 shadow-sm",
        outline: "border border-border bg-white text-foreground hover:bg-muted hover:text-foreground shadow-sm",
        secondary: "bg-secondary text-secondary-foreground hover:bg-slate-200",
        ghost: "hover:bg-muted text-slate-700 hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        success: "bg-success text-white hover:bg-emerald-600 shadow-sm",
        subtle: "bg-primary-subtle text-primary hover:bg-blue-100 font-medium",
      },
      size: {
        default: "h-9 px-4 py-2 text-xs",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-6 text-sm",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

const Button = React.forwardRef(({ className, variant, size, ...props }, ref) => {
  return (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  );
});
Button.displayName = "Button";

export { Button, buttonVariants };
