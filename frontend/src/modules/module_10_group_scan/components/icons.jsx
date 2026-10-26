/** Icon SVG trích từ UI mẫu Figma / icon tiến trình Module 5. */
import { cn } from "@/lib/utils";

export function IconUsers({ className, color = "currentColor" }) {
  return (
    <svg
      className={cn("size-3.5 shrink-0", className)}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M10.667 14v-1.333A2.667 2.667 0 0 0 8 10H3.333A2.667 2.667 0 0 0 .667 12.667V14M5.667 7.333A2.667 2.667 0 1 0 5.667 2a2.667 2.667 0 0 0 0 5.333ZM15.333 14v-1.333a2.667 2.667 0 0 0-2-2.58M10.667 2.087a2.667 2.667 0 0 1 0 5.166"
        stroke={color}
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconTags({ className, color = "currentColor" }) {
  return (
    <svg
      className={cn("size-3.5 shrink-0", className)}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M13.78 8.447 8.453 3.12A1.333 1.333 0 0 0 7.507 2.667H3.333A1.333 1.333 0 0 0 2 4v4.173c0 .354.14.693.392.94l5.327 5.327a1.333 1.333 0 0 0 1.886 0l4.173-4.173a1.333 1.333 0 0 0 0-1.887ZM5 6.333a1.333 1.333 0 1 1 0-2.666 1.333 1.333 0 0 1 0 2.666Z"
        stroke={color}
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconLink({ className, color = "currentColor" }) {
  return (
    <svg
      className={cn("size-3.5 shrink-0", className)}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M6.667 8.667a3.333 3.333 0 0 0 5.04.36l2-2A3.333 3.333 0 0 0 9 2.293l-1.147 1.14M9.333 7.333a3.333 3.333 0 0 0-5.04-.36l-2 2A3.333 3.333 0 1 0 7 13.707l1.14-1.147"
        stroke={color}
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconUpload({ className, color = "currentColor" }) {
  return (
    <svg
      className={cn("size-3.5 shrink-0", className)}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M14 10v2.667A1.333 1.333 0 0 1 12.667 14H3.333A1.333 1.333 0 0 1 2 12.667V10M11.333 5.333 8 2 4.667 5.333M8 2v8"
        stroke={color}
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconPlay({ className, color = "currentColor" }) {
  return (
    <svg
      className={cn("size-4 shrink-0", className)}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M3.5 2.8v10.4L13 8 3.5 2.8Z" fill={color} />
    </svg>
  );
}

export function IconPause({ className, color = "currentColor" }) {
  return (
    <svg
      className={cn("size-4 shrink-0", className)}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M5 3h2.2v10H5V3Zm3.8 0H11v10H8.8V3Z" fill={color} />
    </svg>
  );
}

export function IconStop({ className, color = "currentColor" }) {
  return (
    <svg
      className={cn("size-4 shrink-0", className)}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="3.2" y="3.2" width="9.6" height="9.6" rx="1.2" fill={color} />
    </svg>
  );
}

export function IconSearch({ className, color = "currentColor" }) {
  return (
    <svg
      className={cn("size-3.5 shrink-0", className)}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M7.333 12.667A5.333 5.333 0 1 0 7.333 2a5.333 5.333 0 0 0 0 10.667ZM14 14l-2.9-2.9"
        stroke={color}
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconDownload({ className, color = "currentColor" }) {
  return (
    <svg
      className={cn("size-3.5 shrink-0", className)}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M14 10v2.667A1.333 1.333 0 0 1 12.667 14H3.333A1.333 1.333 0 0 1 2 12.667V10M4.667 6.667 8 10l3.333-3.333M8 10V2"
        stroke={color}
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconExternal({ className, color = "currentColor" }) {
  return (
    <svg
      className={cn("size-3 shrink-0", className)}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M9.5 6.5V9.5A1 1 0 0 1 8.5 10.5h-6A1 1 0 0 1 1.5 9.5v-6A1 1 0 0 1 2.5 2.5H5.5M7.5 1.5H10.5V4.5M5 7 10.5 1.5"
        stroke={color}
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconClose({ className, color = "currentColor" }) {
  return (
    <svg
      className={cn("size-3 shrink-0", className)}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M9 3 3 9M3 3l6 6" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** Icon checklist — dùng lại từ “Theo dõi tiến trình” Module 5. */
export function IconProgress({ className }) {
  return (
    <svg
      className={cn("size-3.5 shrink-0", className)}
      width="14"
      height="12"
      viewBox="0 0 14 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M4.15625 0.165039C4.42969 0.456706 4.44792 0.766602 4.21094 1.09473L2.24219 3.28223V3.28223C2.11458 3.42806 1.95964 3.50098 1.77734 3.50098C1.57682 3.50098 1.41276 3.43717 1.28516 3.30957L0.191406 2.21582V2.21582C-0.0638021 1.90592 -0.0638021 1.59603 0.191406 1.28613C0.501302 1.03092 0.811198 1.03092 1.12109 1.28613L1.72266 1.8877V1.8877L3.22656 0.219727V0.219727C3.51823 -0.0537109 3.82812 -0.0719401 4.15625 0.165039V0.165039V0.165039M4.15625 4.54004C4.42969 4.83171 4.44792 5.1416 4.21094 5.46973L2.24219 7.65723V7.65723C2.11458 7.80306 1.95964 7.87598 1.77734 7.87598C1.57682 7.87598 1.41276 7.81217 1.28516 7.68457L0.191406 6.59082V6.59082C-0.0638021 6.28092 -0.0638021 5.97103 0.191406 5.66113C0.501302 5.40592 0.811198 5.40592 1.12109 5.66113L1.72266 6.2627V6.2627L3.22656 4.59473V4.59473C3.51823 4.32129 3.82812 4.30306 4.15625 4.54004V4.54004V4.54004M6.125 1.75098C6.125 1.49577 6.20703 1.28613 6.37109 1.12207V1.12207V1.12207C6.53516 0.958008 6.74479 0.875977 7 0.875977H13.125V0.875977C13.3802 0.875977 13.5898 0.958008 13.7539 1.12207C13.918 1.28613 14 1.49577 14 1.75098C14 2.00618 13.918 2.21582 13.7539 2.37988C13.5898 2.54395 13.3802 2.62598 13.125 2.62598H7V2.62598C6.74479 2.62598 6.53516 2.54395 6.37109 2.37988C6.20703 2.21582 6.125 2.00618 6.125 1.75098V1.75098V1.75098M6.125 6.12598C6.125 5.87077 6.20703 5.66113 6.37109 5.49707V5.49707V5.49707C6.53516 5.33301 6.74479 5.25098 7 5.25098H13.125V5.25098C13.3802 5.25098 13.5898 5.33301 13.7539 5.49707C13.918 5.66113 14 5.87077 14 6.12598C14 6.38119 13.918 6.59082 13.7539 6.75488C13.5898 6.91895 13.3802 7.00098 13.125 7.00098H7V7.00098C6.74479 7.00098 6.53516 6.91895 6.37109 6.75488C6.20703 6.59082 6.125 6.38119 6.125 6.12598V6.12598V6.12598M4.375 10.501C4.375 10.2458 4.45703 10.0361 4.62109 9.87207V9.87207V9.87207C4.78516 9.70801 4.99479 9.62598 5.25 9.62598H13.125V9.62598C13.3802 9.62598 13.5898 9.70801 13.7539 9.87207C13.918 10.0361 14 10.2458 14 10.501C14 10.7562 13.918 10.9658 13.7539 11.1299C13.5898 11.2939 13.3802 11.376 13.125 11.376H5.25V11.376C4.99479 11.376 4.78516 11.2939 4.62109 11.1299C4.45703 10.9658 4.375 10.7562 4.375 10.501V10.501V10.501M1.3125 9.18848C1.80469 9.20671 2.1875 9.42546 2.46094 9.84473C2.67969 10.2822 2.67969 10.7197 2.46094 11.1572C2.1875 11.5765 1.80469 11.7952 1.3125 11.8135C0.820312 11.7952 0.4375 11.5765 0.164062 11.1572C-0.0546875 10.7197 -0.0546875 10.2822 0.164062 9.84473C0.4375 9.42546 0.820312 9.20671 1.3125 9.18848V9.18848V9.18848"
        fill="#2563EB"
      />
    </svg>
  );
}

export function IconInfo({ className, color = "#D97706" }) {
  return (
    <svg
      className={cn("size-3.5 shrink-0", className)}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M8 14.667A6.667 6.667 0 1 0 8 1.333a6.667 6.667 0 0 0 0 13.334ZM8 10.667V8M8 5.333h.007"
        stroke={color}
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
