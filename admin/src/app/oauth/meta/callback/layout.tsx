import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Facebook OAuth Callback",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
  referrer: "no-referrer",
};

export default function OAuthCallbackLayout({ children }: { children: React.ReactNode }) {
  return children;
}
