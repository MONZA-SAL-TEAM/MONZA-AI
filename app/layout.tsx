import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Sora, Manrope } from "next/font/google";
import SideNav from "@/components/SideNav";
import "./globals.css";

/* The product's two voices: Sora carries headings and big numbers,
   Manrope carries everything people read. */
const sora = Sora({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display",
  display: "swap",
});
const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Monza AI",
  description: "Ask the Monza systems anything, in plain language.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sora.variable} ${manrope.variable}`}>
      <body className="app-shell">
        <SideNav />
        <main className="app-main">{children}</main>
      </body>
    </html>
  );
}
