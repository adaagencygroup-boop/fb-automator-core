import { Plus_Jakarta_Sans, Inter } from "next/font/google";
import "./globals.css";

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

export const metadata = {
  title: "Facebook Automator Pro",
  description: "Enterprise Automation Platform for Facebook Fanpages & Accounts",
  icons: {
    icon: "/icons/app_brand_logo.svg",
    shortcut: "/icons/app_brand_logo.svg",
    apple: "/icons/app_brand_logo.svg",
  },
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="vi"
      className={`${fontHeading.variable} ${fontSans.variable} font-sans h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}
