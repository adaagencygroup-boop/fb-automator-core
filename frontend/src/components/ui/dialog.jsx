"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
const Dialog = ({ open, onOpenChange, children }) => {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onOpenChange?.(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenChange]);

  React.useEffect(() => {
    if (open) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [open]);

  if (!open || !mounted || typeof document === "undefined") return null;

  const content = (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-3 sm:p-5 select-none bg-slate-900/60 backdrop-blur-sm overflow-hidden"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange?.(false);
      }}
    >
      <div className="relative z-50 w-full flex items-center justify-center max-h-full">
        {React.Children.map(children, (child) => {
          if (React.isValidElement(child)) {
            return React.cloneElement(child, { onClose: () => onOpenChange?.(false) });
          }
          return child;
        })}
      </div>
    </div>
  );
  return createPortal(content, document.body);
};
const DialogContent = React.forwardRef(({ className, children, onClose, ...props }, ref) => (
  <div
    ref={ref}
    onClick={(e) => e.stopPropagation()}
    className={cn(
      "relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card text-card-foreground p-6 shadow-2xl transition-all duration-200 animate-in zoom-in-95 select-text",
      className
    )}
    {...props}
  >
    {children}
    {onClose && (
      <button
        onClick={onClose}
        className="absolute right-4 top-4 p-1 rounded-md opacity-70 ring-offset-background transition-opacity hover:opacity-100 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        title="Đóng"
      >
        <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
        <span className="sr-only">Close</span>
      </button>
    )}
  </div>
));
DialogContent.displayName = "DialogContent";
const DialogHeader = ({ className, ...props }) => (
  <div className={cn("flex flex-col space-y-1.5 text-left mb-4", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";
const DialogFooter = ({ className, ...props }) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 mt-6", className)} {...props} />
);
DialogFooter.displayName = "DialogFooter";
const DialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <h2
    ref={ref}
    className={cn("text-base font-bold font-heading leading-none tracking-tight text-foreground", className)}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";
const DialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-xs text-muted-foreground mt-1", className)} {...props} />
));
DialogDescription.displayName = "DialogDescription";
export {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
