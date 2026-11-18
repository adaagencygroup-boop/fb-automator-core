import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-slate-200/75", className)}
      {...props}
    />
  );
}

export { Skeleton };
