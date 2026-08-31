import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Monza AI",
  description: "Ask the Monza systems anything, in plain language.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
        <header className="topbar">
          <Link
            className="brand"
            href="/chat"
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            {/* Small mark: an M inside a rounded square, drawn in currentColor
                so it follows the theme automatically. */}
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              focusable="false"
            >
              <rect
                x="2.5"
                y="2.5"
                width="19"
                height="19"
                rx="6"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path
                d="M7.5 15.5v-7l4.5 4.5 4.5-4.5v7"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Monza AI
          </Link>
          <nav className="row" style={{ gap: 4 }} aria-label="Main">
            <Link className="navlink" href="/chat">
              Chat
            </Link>
            <Link className="navlink" href="/dashboard">
              Overview
            </Link>
            <Link className="navlink" href="/connections">
              Connections
            </Link>
            <Link className="navlink" href="/settings">
              Settings
            </Link>
          </nav>
        </header>
        <main style={{ flex: 1, minHeight: 0, display: "flex" }}>{children}</main>
      </body>
    </html>
  );
}
