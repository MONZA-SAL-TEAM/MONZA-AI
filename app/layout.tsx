import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Sora, Manrope } from "next/font/google";
import SideNav from "@/components/SideNav";
import { InstallBanner } from "@/components/InstallApp";
import { APP_DESCRIPTION, APP_NAME, THEME_COLOR } from "@/lib/pwa";
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
  // Installable as an app (lib/pwa.ts): the manifest is app/manifest.ts, the icons are public/icons.
  applicationName: APP_NAME,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // iPhone and iPad: "Add to Home Screen" opens it full-screen, with this name under the icon.
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
  // Phone numbers in chats are handled by the inbox itself; iOS must not turn every number into a blue link.
  formatDetection: { telephone: false, date: false, address: false, email: false },
  other: { "mobile-web-app-capable": "yes", "msapplication-TileColor": THEME_COLOR, "application-description": APP_DESCRIPTION },
  // A staff tool: never in a search engine.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // The phone's status bar takes the app's own background, by day and by night, so the window reads as
  // one surface — not a coloured browser strip above a page.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#121926" },
  ],
  width: "device-width",
  initialScale: 1,
  // The notch and the home bar of an installed phone app.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sora.variable} ${manrope.variable}`}>
      <body className="app-shell">
        <SideNav />
        {/* Phones and tablets in the browser: "Get the app", where nobody can miss it. Never inside the app. */}
        <InstallBanner />
        <main className="app-main">{children}</main>
      </body>
    </html>
  );
}
