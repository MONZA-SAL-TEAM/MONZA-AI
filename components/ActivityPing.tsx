"use client";

/**
 * Counts the minutes a staff member actively uses MONZA AI (Samer, 2026-10-13): once a minute, if the window
 * is visible and was used (a click, a key, a scroll, a touch) in the last two minutes, it tells the server
 * which SECTION is open. Nothing else is sent — no page address, no customer. Public pages are never counted,
 * and after a refusal (signed out) it stays quiet until the next page. One timer for the whole visit, so
 * moving between pages does not restart the minute.
 */

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { isActive, sectionOf } from "@/lib/insights/activity";

export default function ActivityPing() {
  const pathname = usePathname();
  const section = useRef<string | null>(null);
  const stopped = useRef(false);

  useEffect(() => {
    section.current = sectionOf(pathname ?? "/");
    stopped.current = false;
  }, [pathname]);

  useEffect(() => {
    let lastInput = Date.now();
    const touched = () => {
      lastInput = Date.now();
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart", "wheel"] as const;
    for (const e of events) window.addEventListener(e, touched, { passive: true, capture: true });
    const timer = window.setInterval(() => {
      const s = section.current;
      if (!s || stopped.current || !isActive(document.visibilityState === "visible", lastInput, Date.now())) return;
      void fetch("/api/me/activity", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ section: s }), keepalive: true })
        .then((r) => {
          if (r.status === 401 || r.status === 403) stopped.current = true;
        })
        .catch(() => undefined);
    }, 60_000);
    return () => {
      window.clearInterval(timer);
      for (const e of events) window.removeEventListener(e, touched, { capture: true });
    };
  }, []);
  return null;
}
