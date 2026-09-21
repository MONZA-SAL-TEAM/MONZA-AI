"use client";

/**
 * "Notifications" — the switch that lets THIS device ring when Monza AI is closed (lib/push/).
 *
 * Samer, 2026-09-21: "I'm not receiving notifications outside the app." A closed app has no page to
 * run, so the phone's own push service has to wake it; that needs the person's permission, asked by a
 * tap (browsers refuse to ask without one), on each device they want to ring.
 *
 *   PushToggle        the button at the foot of the side rail, and its small dialog
 *   usePush           the state and the actions, for anywhere else (the inbox's bell)
 *
 * On an iPhone or iPad this only works inside the INSTALLED app — Apple's rule — so in a Safari tab it
 * says so and points at the install steps instead of failing silently.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { PUSH_ON_FLAG, isIosDevice, keyBytes, pushHelp, pushPath, type PushFacts, type PushPath } from "@/lib/push/device";

const NO_FACTS: PushFacts = { supported: false, permission: "default", subscribed: false, serverReady: null, ios: false, standalone: false };

function setFlag(on: boolean) {
  try {
    if (on) localStorage.setItem(PUSH_ON_FLAG, "1");
    else localStorage.removeItem(PUSH_ON_FLAG);
  } catch {
    /* a private window: the inbox may then notify twice, nothing worse */
  }
}

// The server's public key, as last read.
let cachedKey: string | null = null;

async function readFacts(): Promise<PushFacts> {
  const ios = isIosDevice(navigator.userAgent, navigator.maxTouchPoints ?? 0);
  const standalone = window.matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches || (navigator as { standalone?: boolean }).standalone === true;
  const supported = window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!supported) return { ...NO_FACTS, ios, standalone };

  let subscribed = false;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    subscribed = Boolean(reg && (await reg.pushManager.getSubscription()));
  } catch {
    /* read as not subscribed */
  }
  let serverReady: boolean | null = null;
  let publicKey: string | null = null;
  try {
    const res = await fetch("/api/push/key", { cache: "no-store" });
    const body = (await res.json()) as { ok?: boolean; publicKey?: string | null };
    serverReady = body.ok === true;
    publicKey = body.publicKey ?? null;
  } catch {
    /* unknown: the switch still shows, and says what went wrong when pressed */
  }
  cachedKey = publicKey;
  return { supported, permission: Notification.permission, subscribed, serverReady, ios, standalone };
}

/** Tell the server about this device's address. Also called on every signed-in visit, which keeps the device trusted. */
async function register(sub: PushSubscription): Promise<string | null> {
  const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
  if (res.ok) return null;
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return body?.message ?? "Notifications could not be switched on just now.";
}

export function usePush() {
  const [facts, setFacts] = useState<PushFacts | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const f = await readFacts();
    setFacts(f);
    setFlag(f.subscribed && f.permission === "granted");
    return f;
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const f = await refresh();
      if (!alive || !f.subscribed || f.permission !== "granted") return;
      // Already on: confirm the address again, quietly. The browser replaces it now and then, and the
      // server trusts a device only for a while after a signed-in visit.
      try {
        const reg = await navigator.serviceWorker.getRegistration("/");
        const sub = reg && (await reg.pushManager.getSubscription());
        if (sub) await register(sub);
      } catch {
        /* next visit */
      }
    })();
    return () => {
      alive = false;
    };
  }, [refresh]);

  const turnOn = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        await refresh();
        return;
      }
      const key = cachedKey ? keyBytes(cachedKey) : null;
      if (!key) {
        setMessage("Notifications are not set up on Monza AI's server yet.");
        await refresh();
        return;
      }
      const reg = (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
      const problem = await register(sub);
      if (problem) {
        await sub.unsubscribe().catch(() => false);
        setMessage(problem);
      } else {
        setMessage("On. Press “Send a test” to hear it.");
      }
    } catch {
      setMessage("This device refused to switch notifications on. Close Monza AI, open it again and try once more.");
    } finally {
      await refresh();
      setBusy(false);
    }
  }, [refresh]);

  const turnOff = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = reg && (await reg.pushManager.getSubscription());
      if (sub) {
        await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => null);
        await sub.unsubscribe();
      }
      setMessage("Off on this device.");
    } catch {
      setMessage("Could not switch off just now.");
    } finally {
      await refresh();
      setBusy(false);
    }
  }, [refresh]);

  const sendTest = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setMessage(body?.message ?? (res.ok ? "Sent." : "The test could not be sent."));
    } catch {
      setMessage("The test could not be sent — check the connection.");
    } finally {
      setBusy(false);
    }
  }, []);

  const path: PushPath | null = facts ? pushPath(facts) : null;
  return { path, ios: facts?.ios ?? false, busy, message, turnOn, turnOff, sendTest };
}

function Bell({ off = false }: { off?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}

export function PushDialog({ push, onClose }: { push: ReturnType<typeof usePush>; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const { path, ios, busy, message } = push;
  if (!path) return null;
  return (
    <div className="install-scrim" onClick={onClose}>
      <div className="install-dialog" role="dialog" aria-modal="true" aria-labelledby="push-title" tabIndex={-1} ref={dialog} onClick={(e) => e.stopPropagation()}>
        <span className="push-badge" data-on={path === "on"}>
          <Bell off={path === "blocked"} />
        </span>
        <h2 id="push-title" className="install-title">
          {path === "on" ? "Notifications are on" : "Notifications"}
        </h2>
        <p className="install-lede">{pushHelp(path, ios)}</p>
        {path === "on" && <p className="push-note">It shows who wrote and on which channel — never the message itself. Switch it on separately on each phone or computer that should ring.</p>}
        {message && (
          <p className="push-message" role="status">
            {message}
          </p>
        )}
        <div className="push-actions">
          {path === "off" && (
            <button type="button" className="btn primary" disabled={busy} onClick={() => void push.turnOn()}>
              {busy ? "Switching on…" : "Turn on notifications"}
            </button>
          )}
          {path === "on" && (
            <>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void push.sendTest()}>
                Send a test
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => void push.turnOff()}>
                Turn off on this device
              </button>
            </>
          )}
          {path === "needs-install" && (
            <a className="btn primary" href="/install">
              How to install
            </a>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

const NUDGE_KEY = "monza-ai:push-nudge-closed";
const NUDGE_SNOOZE_DAYS = 7;

/**
 * One line across the inbox while this device CAN ring and does not yet: the side rail's button is
 * inside the phone's hidden menu, where the first Install button was never found either.
 */
export function PushNudge({ push, onOpen }: { push: ReturnType<typeof usePush>; onOpen: () => void }) {
  const [closed, setClosed] = useState(true);
  useEffect(() => {
    try {
      const at = Number(localStorage.getItem(NUDGE_KEY) ?? 0);
      setClosed(Number.isFinite(at) && at > 0 && Date.now() - at < NUDGE_SNOOZE_DAYS * 86_400_000);
    } catch {
      setClosed(false);
    }
  }, []);
  if (closed || (push.path !== "off" && push.path !== "needs-install")) return null;
  const close = () => {
    setClosed(true);
    try {
      localStorage.setItem(NUDGE_KEY, String(Date.now()));
    } catch {
      /* it will show again; nothing worse */
    }
  };
  return (
    <div className="push-nudge" role="region" aria-label="Notifications">
      <Bell />
      <span className="push-nudge-text">{push.path === "off" ? "This device does not ring when Monza AI is closed." : "On iPhone, notifications need the installed app."}</span>
      <button type="button" className="push-nudge-go" onClick={onOpen}>
        {push.path === "off" ? "Turn on" : "How"}
      </button>
      <button type="button" className="push-nudge-x" aria-label={`Not now (asks again in ${NUDGE_SNOOZE_DAYS} days)`} onClick={close}>
        ×
      </button>
    </div>
  );
}

/** The side rail's button. Shown in the browser AND inside the installed app. */
export default function PushToggle() {
  const push = usePush();
  const [open, setOpen] = useState(false);
  if (!push.path || push.path === "unsupported") return null;
  const on = push.path === "on";
  return (
    <>
      <button type="button" className="install-btn push-btn" data-on={on} onClick={() => setOpen(true)}>
        <Bell off={push.path === "blocked"} />
        {on ? "Notifications on" : push.path === "blocked" ? "Notifications blocked" : "Turn on notifications"}
      </button>
      {open && <PushDialog push={push} onClose={() => setOpen(false)} />}
    </>
  );
}
