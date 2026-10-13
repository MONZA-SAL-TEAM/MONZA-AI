"use client";

/**
 * The signed-in person is here (Samer, 2026-10-13: Employees, and Team & access — "when online and what is
 * doing"). It tells the server which SECTION is open: at once when the section changes, and once a minute
 * while the window is visible — with `active` when it was used (a click, a key, a scroll, a touch) in the last
 * two minutes, which is what counts as time in the app. Nothing else is sent — no page address, no customer.
 * Public pages are never counted, and after a refusal (signed out) it stays quiet until the next page. One
 * timer for the whole visit, so moving between pages does not restart the minute.
 */

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { isActive, sectionOf } from "@/lib/insights/activity";

function device(): "phone" | "tablet" | "computer" {
  const w = window.innerWidth;
  const touch = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  if (w < 768) return "phone";
  if (touch && w < 1200) return "tablet";
  return "computer";
}

function send(body: Record<string, unknown>): Promise<number> {
  return fetch("/api/me/activity", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, device: device() }), keepalive: true })
    .then((r) => r.status)
    .catch(() => 0);
}

export default function ActivityPing() {
  const pathname = usePathname();
  const section = useRef<string | null>(null);
  const stopped = useRef(false);
  const lastInput = useRef(Date.now());

  useEffect(() => {
    section.current = sectionOf(pathname ?? "/");
    stopped.current = false;
    lastInput.current = Date.now();
    const s = section.current;
    if (s) void send({ section: s, nav: true }).then((st) => {
      if (st === 401 || st === 403) stopped.current = true;
    });
  }, [pathname]);

  useEffect(() => {
    const touched = () => {
      lastInput.current = Date.now();
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart", "wheel"] as const;
    for (const e of events) window.addEventListener(e, touched, { passive: true, capture: true });
    const timer = window.setInterval(() => {
      const s = section.current;
      if (!s || stopped.current || document.visibilityState !== "visible") return;
      void send({ section: s, active: isActive(true, lastInput.current, Date.now()) }).then((st) => {
        if (st === 401 || st === 403) stopped.current = true;
      });
    }, 60_000);
    return () => {
      window.clearInterval(timer);
      for (const e of events) window.removeEventListener(e, touched, { capture: true });
    };
  }, []);
  return null;
}
