import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "vietnamese"],
  variable: "--font-admin-sans",
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin", "vietnamese"],
  variable: "--font-admin-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "FB Tool Admin",
  description: "Bảng quản trị bản quyền và xác thực người dùng cho FB Automator",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi" className={`${inter.variable} ${jakarta.variable}`}>
      <body
        className={`${inter.className} bg-[#F5F7FB] text-[#0F172A] antialiased selection:bg-blue-600 selection:text-white`}
      >
        {children}
      </body>
    </html>
  );
}
