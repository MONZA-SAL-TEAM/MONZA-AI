"use client";

/**
 * The one refresh timer for open screens — the rule is lib/poll.ts.
 *
 * It replaces a plain setInterval: the caller still does its own first load, and this asks again after
 * `pollDelay`, slower when the screen is left open and not at all (or rarely) behind another tab. Coming back
 * — the tab in front again, or the first touch after being idle — asks at once if the last answer is stale.
 * One ask at a time: a slow Meta never stacks a second request on the first.
 */

import { useEffect, useRef } from "react";
import { pollDelay, staleOnReturn, type PollRule } from "@/lib/poll";

/** When this window was last used. One listener set for the whole page, shared by every timer. */
let lastInputAt = Date.now();
const wakers = new Set<() => void>();
let listening = false;

function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const touched = () => {
    const wasIdle = Date.now() - lastInputAt > 60_000;
    lastInputAt = Date.now();
    if (wasIdle) for (const w of wakers) w();
  };
  for (const e of ["pointerdown", "keydown", "scroll", "touchstart", "wheel"] as const) {
    window.addEventListener(e, touched, { passive: true, capture: true });
  }
}

export function usePoll(run: () => unknown, rule: PollRule, enabled = true): void {
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (!enabled) return;
    listen();
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let busy = false;
    let lastRunAt = Date.now();

    const visible = () => document.visibilityState === "visible";

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!alive) return;
      const wait = pollDelay(rule, visible(), lastInputAt, Date.now());
      if (wait !== null) timer = setTimeout(() => void tick(), wait);
    };

    const tick = async () => {
      if (!alive || busy) return;
      busy = true;
      lastRunAt = Date.now();
      try {
        await runRef.current();
      } catch {
        // The caller shows its own problem; the timer keeps going.
      } finally {
        busy = false;
        schedule();
      }
    };

    const wake = () => {
      if (!alive || !visible()) return;
      if (staleOnReturn(rule, lastRunAt, Date.now())) void tick();
      else schedule();
    };

    const onVisibility = () => (visible() ? wake() : schedule());
    document.addEventListener("visibilitychange", onVisibility);
    wakers.add(wake);
    schedule();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      wakers.delete(wake);
    };
  }, [enabled, rule]);
}
