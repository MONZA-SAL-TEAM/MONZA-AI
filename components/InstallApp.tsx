"use client";

/**
 * "Install app" — MONZA AI as an app on this phone or computer (lib/pwa.ts).
 *
 * Chrome, Edge and Android hand the page an install prompt (`beforeinstallprompt`); the button then
 * installs in one tap. iPhone, iPad and Safari on a Mac have no such prompt, so the button opens the
 * three steps for that device instead. Inside the installed app the button is not shown at all.
 *
 * It also registers the service worker (public/sw.js), which caches nothing of MONZA AI's — see there.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { installPath, installSteps, type InstallPath } from "@/lib/pwa";

/** Chrome's event; not in lib.dom. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// One prompt per page, shared by every copy of the button (the side rail and the phone header).
let savedPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
let wired = false;

function wireOnce() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own button, where staff will find it
    savedPrompt = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    savedPrompt = null;
    listeners.forEach((l) => l());
  });
  // The worker is tiny and caches nothing of ours. Registering is what makes "Install" appear on Android.
  if ("serviceWorker" in navigator && window.isSecureContext) {
    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        /* Installing is a convenience: a failed registration must never break the product. */
      });
    };
    // This runs after hydration, when "load" has usually fired already — waiting for it would wait forever.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }
}

function currentPath(): InstallPath {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: window-controls-overlay)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return installPath({
    userAgent: navigator.userAgent,
    standalone,
    hasPrompt: savedPrompt !== null,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  });
}

export default function InstallApp() {
  const [path, setPath] = useState<InstallPath | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    wireOnce();
    const update = () => setPath(currentPath());
    update();
    listeners.add(update);
    const mq = window.matchMedia("(display-mode: standalone)");
    mq.addEventListener?.("change", update);
    return () => {
      listeners.delete(update);
      mq.removeEventListener?.("change", update);
    };
  }, []);

  useEffect(() => {
    if (!showSteps) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setShowSteps(false);
    document.addEventListener("keydown", onKey);
    dialog.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [showSteps]);

  const onClick = useCallback(async () => {
    if (savedPrompt) {
      setBusy(true);
      try {
        await savedPrompt.prompt();
        await savedPrompt.userChoice;
      } finally {
        savedPrompt = null; // a prompt can be used once
        setBusy(false);
        setPath(currentPath());
      }
      return;
    }
    setShowSteps(true);
  }, []);

  // Nothing until we know the device; nothing inside the installed app.
  if (path === null || path === "installed") return null;

  const steps = installSteps(path);
  return (
    <>
      <button type="button" className="install-btn" onClick={onClick} disabled={busy}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
        </svg>
        <span>{path === "prompt" ? "Install app" : "Install as an app"}</span>
      </button>

      {showSteps && (
        <div className="install-scrim" onClick={() => setShowSteps(false)}>
          <div
            className="install-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-title"
            tabIndex={-1}
            ref={dialog}
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" width={56} height={56} alt="" className="install-icon" />
            <h2 id="install-title" className="install-title">
              Install Monza AI
            </h2>
            <p className="install-lede">Its own icon and its own window. It is the same Monza AI, with the same sign-in.</p>
            <ol className="install-steps">
              {steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <button type="button" className="btn primary" onClick={() => setShowSteps(false)}>
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
