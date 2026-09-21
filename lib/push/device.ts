/**
 * Notifications, seen from the DEVICE: can this phone or computer be woken, and if not, why not —
 * in words a person can act on. Pure, so it is tested without a browser (tests/push.test.ts).
 * The server half is lib/push/webpush.ts; this file must stay free of node: imports (it runs in the page).
 */

export interface PushFacts {
  /** serviceWorker, PushManager and Notification all exist. On an iPhone they exist ONLY inside the installed app. */
  supported: boolean;
  /** Notification.permission. */
  permission: "default" | "granted" | "denied";
  /** This device holds a push subscription. */
  subscribed: boolean;
  /** The server has its keys (GET /api/push/key). null: not asked yet, or the question failed. */
  serverReady: boolean | null;
  /** iPhone or iPad (an iPad says it is a Mac; touch points tell them apart). */
  ios: boolean;
  /** Running as the installed app. */
  standalone: boolean;
}

export type PushPath =
  /** On: this device is woken. */
  | "on"
  /** Can be switched on with one tap. */
  | "off"
  /** The person (or the phone) said no: only the device's own settings can undo that. */
  | "blocked"
  /** An iPhone or iPad in a Safari tab: Apple allows notifications only to the installed app. */
  | "needs-install"
  /** This browser cannot do it at all. */
  | "unsupported"
  /** Monza AI's server has no push keys yet — nothing the person can do. */
  | "not-set-up";

export function pushPath(f: PushFacts): PushPath {
  if (!f.supported) return f.ios && !f.standalone ? "needs-install" : "unsupported";
  if (f.permission === "denied") return "blocked";
  if (f.serverReady === false) return "not-set-up";
  return f.permission === "granted" && f.subscribed ? "on" : "off";
}

export function isIosDevice(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/** What to say under the switch. One sentence, no jargon. */
export function pushHelp(path: PushPath, ios: boolean): string {
  switch (path) {
    case "on":
      return "This device rings for new messages, even when Monza AI is closed.";
    case "off":
      return "Get a notification for every new message, even when Monza AI is closed.";
    case "blocked":
      return ios
        ? "Notifications are switched off for Monza AI on this iPhone. Open Settings → Notifications → Monza AI and allow them."
        : "Notifications are blocked for Monza AI in this browser. Tap the padlock next to the address (or the app's Site settings) → Notifications → Allow, then come back.";
    case "needs-install":
      return "On iPhone and iPad, notifications only reach the installed app. Install Monza AI first (Share → Add to Home Screen), open it from the Home Screen, then switch notifications on there.";
    case "unsupported":
      return "This browser cannot show notifications for Monza AI. Use Chrome, Edge or Safari.";
    case "not-set-up":
      return "Notifications are not set up on Monza AI's server yet.";
  }
}

/** The server's public key as the bytes `pushManager.subscribe` wants. Null if it is not a P-256 point. */
export function keyBytes(base64url: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(base64url)) return null;
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4);
  let raw: string;
  try {
    raw = atob(b64);
  } catch {
    return null;
  }
  if (raw.length !== 65 || raw.charCodeAt(0) !== 4) return null;
  const out = new Uint8Array(65);
  for (let i = 0; i < 65; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Set while this device is subscribed, so the inbox does not ALSO raise its own notification for the same message. */
export const PUSH_ON_FLAG = "monza-ai:push-on";
