import { Plus_Jakarta_Sans, Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";
import Toaster from "@/components/Toaster";
import { ToastProvider } from "@/components/ui/toast";

const fontHeading = Plus_Jakarta_Sans({
  subsets: ["latin", "vietnamese"],
  variable: "--font-heading",
  weight: ["500", "600", "700", "800"],
  display: "swap",
});

const fontSans = Inter({
  subsets: ["latin", "vietnamese"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Tiêu đề lớn màn Đăng nhập / Đăng ký (class `font-display`)
const fontDisplay = Space_Grotesk({
  subsets: ["latin", "vietnamese"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
  display: "swap",
});

// Mã HWID ở màn Đăng nhập (class `font-mono`)
const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["500", "600"],
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
      className={`${fontHeading.variable} ${fontSans.variable} ${fontDisplay.variable} ${fontMono.variable} font-sans h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {/* ToastProvider: toast của các module (useToast). Toaster: toast màn đăng nhập (lib/toast) */}
        <AppShell>
          <ToastProvider>{children}</ToastProvider>
        </AppShell>
        <Toaster />
      </body>
    </html>
  );
}
