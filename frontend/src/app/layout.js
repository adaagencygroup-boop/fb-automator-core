import "./globals.css";
import AppShell from "@/components/AppShell";
import Toaster from "@/components/Toaster";

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
      className="font-sans h-full antialiased"
      style={{
        "--font-heading": '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
        "--font-sans": '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
        "--font-display": '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
        "--font-mono": '"SFMono-Regular", Menlo, Consolas, monospace',
      }}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <AppShell>{children}</AppShell>
        <Toaster />
      </body>
    </html>
  );
}
