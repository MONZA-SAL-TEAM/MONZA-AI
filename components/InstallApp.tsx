"use client";

/**
 * "Get the app" — MONZA AI as a real app on this phone or computer (lib/pwa.ts).
 *
 * Chrome, Edge and Android hand the page an install prompt (`beforeinstallprompt`); the button then
 * installs in one tap. iPhone, iPad and Safari on a Mac have no such prompt, so the button opens the
 * steps for that device instead. Inside the installed app none of this is shown.
 *
 * It appears where nobody can miss it (Samer, 2026-09-21: the first version sat at the foot of the
 * phone's hidden menu, so people used the browser's own "Add to Home screen → shortcut", which only
 * bookmarks the site and opens the browser):
 *
 *   InstallApp      the button at the foot of the side rail (computers)
 *   InstallBanner   a bar across the top on phones and tablets, in the browser only; closable for a week.
 *                   It also notices an icon that is only a browser bookmark, and says how to replace it.
 *   InstallCard     the button and the steps, written out: the sign-in page and /install
 *
 * It also registers the service worker (public/sw.js), which caches nothing of MONZA AI's — see there.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { BANNER_SNOOZE_DAYS, REPLACE_SHORTCUT_STEPS, bannerSnoozed, installPath, installSteps, isShortcutLaunch, type InstallPath } from "@/lib/pwa";

/** Chrome's event; not in lib.dom. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// One prompt per page, shared by every copy of the button.
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

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: window-controls-overlay)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function currentPath(): InstallPath {
  return installPath({
    userAgent: navigator.userAgent,
    standalone: isStandalone(),
    hasPrompt: savedPrompt !== null,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  });
}

/** What this device can do, and the one action: install now, or (where there is no prompt) say "show the steps". */
function useInstall() {
  const [path, setPath] = useState<InstallPath | null>(null);
  const [busy, setBusy] = useState(false);

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

  /** True when the browser's own install dialog was shown; false when the steps must be shown instead. */
  const install = useCallback(async (): Promise<boolean> => {
    if (!savedPrompt) return false;
    setBusy(true);
    try {
      await savedPrompt.prompt();
      await savedPrompt.userChoice;
    } finally {
      savedPrompt = null; // a prompt can be used once
      setBusy(false);
      setPath(currentPath());
    }
    return true;
  }, []);

  return { path, busy, install };
}

const DownloadIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
  </svg>
);

function Steps({ path, replacing }: { path: InstallPath; replacing: boolean }) {
  const steps = [...(replacing ? REPLACE_SHORTCUT_STEPS : []), ...installSteps(path)];
  return (
    <ol className="install-steps">
      {steps.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ol>
  );
}

function StepsDialog({ path, replacing, onClose }: { path: InstallPath; replacing: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    dialog.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="install-scrim" onClick={onClose}>
      <div className="install-dialog" role="dialog" aria-modal="true" aria-labelledby="install-title" tabIndex={-1} ref={dialog} onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" width={56} height={56} alt="" className="install-icon" />
        <h2 id="install-title" className="install-title">
          {replacing ? "This icon only opens the browser" : "Get the Monza AI app"}
        </h2>
        <p className="install-lede">
          {replacing ? "Replace it with the real app — two minutes, once." : "Its own icon and its own window, with no address bar. The same Monza AI, the same sign-in."}
        </p>
        <Steps path={path} replacing={replacing} />
        <button type="button" className="btn primary" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}

/** The side rail's button (computers; on phones it sits in the menu). */
export default function InstallApp() {
  const { path, busy, install } = useInstall();
  const [showSteps, setShowSteps] = useState(false);
  if (path === null || path === "installed") return null;
  return (
    <>
      <button type="button" className="install-btn" disabled={busy} onClick={async () => !(await install()) && setShowSteps(true)}>
        <DownloadIcon />
        <span>Get the app</span>
      </button>
      {showSteps && <StepsDialog path={path} replacing={false} onClose={() => setShowSteps(false)} />}
    </>
  );
}

const DISMISSED_KEY = "monza-ai:install-dismissed";

/**
 * Phones and tablets, in the browser: a bar across the top. And the bookmark detector — an icon that opened
 * the browser with the app's own start mark is only a shortcut; say so at once, with the fix.
 */
export function InstallBanner() {
  const pathname = usePathname();
  const { path, busy, install } = useInstall();
  const [hidden, setHidden] = useState(true);
  const [dialog, setDialog] = useState<null | "install" | "replace">(null);

  useEffect(() => {
    if (path === null || path === "installed") return;
    if (isShortcutLaunch(window.location.search, isStandalone())) {
      setDialog("replace");
      setHidden(false);
      return;
    }
    let at: number | null = null;
    try {
      const raw = localStorage.getItem(DISMISSED_KEY);
      at = raw ? Number(raw) : null;
    } catch {
      /* private mode: offered every visit */
    }
    setHidden(bannerSnoozed(at, Date.now()));
  }, [path]);

  // /install IS the offer, written out in full: no bar above it.
  if (path === null || path === "installed" || pathname === "/install") return null;
  const close = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {
      /* not remembered */
    }
  };
  return (
    <>
      {!hidden && (
        <div className="install-banner" role="region" aria-label="Get the Monza AI app">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" width={36} height={36} alt="" className="install-banner-icon" />
          <div className="install-banner-text">
            <strong>Monza AI app</strong>
            <span>Opens like an app — no address bar.</span>
          </div>
          <button type="button" className="install-banner-go" disabled={busy} onClick={async () => !(await install()) && setDialog("install")}>
            {path === "prompt" ? "Install" : "Get"}
          </button>
          <button type="button" className="install-banner-x" aria-label={`Not now (asks again in ${BANNER_SNOOZE_DAYS} days)`} onClick={close}>
            ✕
          </button>
        </div>
      )}
      {dialog && <StepsDialog path={path} replacing={dialog === "replace"} onClose={() => setDialog(null)} />}
    </>
  );
}

/** Written out in full: the sign-in page and /install. `full` also says so once it is installed. */
export function InstallCard({ full = false }: { full?: boolean }) {
  const { path, busy, install } = useInstall();
  const [open, setOpen] = useState(full);
  if (path === null) return null;
  if (path === "installed") {
    return full ? <p className="install-card-done">Monza AI is installed — you are using the app now.</p> : null;
  }
  return (
    <div className="install-card">
      <button type="button" className="btn install-card-btn" disabled={busy} onClick={async () => !(await install()) && setOpen(true)}>
        <DownloadIcon />
        <span>{path === "prompt" ? "Install the Monza AI app" : "Get the Monza AI app"}</span>
      </button>
      {open && (
        <>
          <Steps path={path} replacing={false} />
          <p className="install-card-note">
            Already have a Monza AI icon that opens the browser? It is only a bookmark — remove it first, then follow the steps above.
          </p>
        </>
      )}
    </div>
  );
}
