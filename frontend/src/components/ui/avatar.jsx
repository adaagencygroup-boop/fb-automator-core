"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const Avatar = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "relative flex h-8 w-8 shrink-0 overflow-hidden rounded-full border border-border bg-slate-100",
      className
    )}
    {...props}
  />
));
Avatar.displayName = "Avatar";

const AvatarImage = React.forwardRef(
  ({ className, src, alt = "", referrerPolicy, onLoad, onError, ...props }, ref) => {
    const innerRef = React.useRef(null);
    const [failedSrc, setFailedSrc] = React.useState(null);
    const [loadedSrc, setLoadedSrc] = React.useState(null);

    const setMergedRef = React.useCallback(
      (node) => {
        innerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [ref]
    );

    React.useEffect(() => {
      const el = innerRef.current;
      if (!src || !el) return;
      if (el.complete) {
        if (el.naturalWidth === 0) setFailedSrc(src);
        else setLoadedSrc(src);
      }
    }, [src]);

    if (!src || failedSrc === src) return null;

    const isLoaded = loadedSrc === src;
    return (
      <img
        ref={setMergedRef}
        src={src}
        alt={alt}
        referrerPolicy={referrerPolicy ?? "no-referrer"}
        onLoad={(e) => {
          setLoadedSrc(src);
          onLoad?.(e);
        }}
        onError={(e) => {
          setFailedSrc(src);
          onError?.(e);
        }}
        className={cn(
          "absolute inset-0 z-10 aspect-square h-full w-full object-cover transition-opacity duration-150",
          isLoaded ? "opacity-100" : "opacity-0",
          className
        )}
        {...props}
      />
    );
  }
);
AvatarImage.displayName = "AvatarImage";

const AvatarFallback = React.forwardRef(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex h-full w-full items-center justify-center rounded-full bg-primary-subtle text-primary font-bold text-xs",
      className
    )}
    {...props}
  >
    {children}
  </div>
));
AvatarFallback.displayName = "AvatarFallback";

export { Avatar, AvatarImage, AvatarFallback };
