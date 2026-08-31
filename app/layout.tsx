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
          <span className="brand">Monza AI</span>
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
