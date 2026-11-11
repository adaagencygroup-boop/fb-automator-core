import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";
import DesktopUpdater from "@/components/DesktopUpdater";
import Toaster from "@/components/Toaster";

const fontSans = Inter({
  subsets: ["latin", "latin-ext", "vietnamese"],
  variable: "--font-sans",
  display: "swap",
});

const fontHeading = Plus_Jakarta_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-heading",
  display: "swap",
});

export const metadata = {
  title: "Facebook Automator Pro",
  description: "Enterprise Automation Platform for Facebook Fanpages & Accounts",
  icons: {
    icon: "/icons/app_favicon_facebook.svg",
    shortcut: "/icons/app_favicon_facebook.svg",
    apple: "/icons/app_favicon_facebook_180.png",
  },
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="vi"
      suppressHydrationWarning
      className={`${fontSans.variable} ${fontHeading.variable} h-full font-sans antialiased`}
      style={{
        "--font-display": "var(--font-heading)",
        "--font-mono": '"SFMono-Regular", Menlo, Consolas, monospace',
      }}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <AppShell>{children}</AppShell>
        <DesktopUpdater />
        <Toaster />
      </body>
    </html>
  );
}
