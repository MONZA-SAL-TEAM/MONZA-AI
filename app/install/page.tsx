import type { Metadata } from "next";
import { InstallCard } from "@/components/InstallApp";

/**
 * /install — "download the app", as a page anyone on the team can be sent (Samer, 2026-09-21). Public on
 * purpose: it holds no data, and somebody has to be able to read how to install BEFORE they have the app.
 * What installing is and is not: lib/pwa.ts.
 */
export const metadata: Metadata = { title: "Get the app — Monza AI" };

export default function InstallPage() {
  return (
    <div className="install-page">
      <div className="card pad-lg install-page-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" width={72} height={72} alt="" className="install-icon" />
        <span className="eyebrow">Monza AI</span>
        <h1 className="h1">Get the app</h1>
        <p className="lede">
          Monza AI on your phone or computer as a real app: its own icon, its own window, no address bar. It is the same
          Monza AI with the same sign-in — nothing else to download, and it updates by itself.
        </p>
        <InstallCard full />
      </div>
    </div>
  );
}
