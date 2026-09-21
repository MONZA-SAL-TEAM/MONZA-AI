/**
 * MONZA AI AS AN INSTALLABLE APP (Samer, 2026-09-19: "make this Monza AI so we can install it as an
 * app from the website").
 *
 * A web app a browser can install needs three things: a manifest that names it, icons, and a secure
 * origin. This file is the manifest's content and the rules around it, kept pure so they are tested.
 *
 * WHAT INSTALLING IS NOT. It is the same website in its own window, with its own icon: the same
 * sign-in, the same permissions, the same server. It adds no access and keeps NOTHING NEW on the
 * device (the inbox's own saved copy in the browser, lib/inbox/cache.ts, is unchanged and still
 * cleared by "Clear saved chats") — and the service worker beside it (public/sw.js) keeps it so:
 *
 *   - NOTHING from MONZA AI is ever cached: no page, no API answer, no chat, no customer. Every
 *     request goes to the network, exactly as in a browser tab. A cached inbox on a shared or lost
 *     phone would be a copy of customers' conversations that no "sign out" could reach.
 *   - The one thing it keeps is a small offline page with no data in it, shown when there is no
 *     connection — instead of the browser's error screen.
 */

export const APP_NAME = "Monza AI";
export const APP_DESCRIPTION = "Monza SAL's staff workspace: the inbox, customers, sales and the assistant.";
/** --accent, the left of the brand gradient: the title bar of the installed window. */
export const THEME_COLOR = "#09705F";
/** --bg: the splash screen behind the icon while the app starts. */
export const BACKGROUND_COLOR = "#F3F5F9";
/** Where the installed app opens. The front door of the product is the inbox. */
export const START_URL = "/inbox";

export interface ManifestIcon {
  src: string;
  sizes: string;
  type: "image/png";
  purpose?: "any" | "maskable";
}

export interface AppManifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: "standalone";
  display_override: ("window-controls-overlay" | "standalone" | "minimal-ui")[];
  orientation: "any";
  theme_color: string;
  background_color: string;
  lang: string;
  dir: "ltr";
  categories: string[];
  prefer_related_applications: false;
  icons: ManifestIcon[];
  shortcuts: { name: string; short_name: string; url: string; icons: ManifestIcon[] }[];
}

const ICON_192: ManifestIcon = { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" };

/** The manifest, served at /manifest.webmanifest by app/manifest.ts. */
export function appManifest(): AppManifest {
  return {
    // A stable identity: changing start_url later must not make browsers think it is another app.
    id: "/?app=monza-ai",
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    start_url: `${START_URL}?source=app`,
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    theme_color: THEME_COLOR,
    background_color: BACKGROUND_COLOR,
    lang: "en",
    dir: "ltr",
    categories: ["business", "productivity"],
    prefer_related_applications: false,
    icons: [
      ICON_192,
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Long-press the icon (Android) or right-click it (Windows, macOS): straight to a screen.
    shortcuts: [
      { name: "Inbox", short_name: "Inbox", url: "/inbox?source=app-shortcut", icons: [ICON_192] },
      { name: "Customers", short_name: "Customers", url: "/customers?source=app-shortcut", icons: [ICON_192] },
      { name: "Sales library", short_name: "Sales", url: "/sales?source=app-shortcut", icons: [ICON_192] },
      { name: "Ask Monza AI", short_name: "Ask", url: "/chat?source=app-shortcut", icons: [ICON_192] },
    ],
  };
}

/* ── How this device installs it ─────────────────────────────────────────── */

export type InstallPath =
  /** Already running as the installed app: nothing to offer. */
  | "installed"
  /** Opened inside Instagram, Facebook, TikTok…: those mini-browsers cannot install anything. */
  | "in-app-browser"
  /** The browser handed us its install prompt (Chrome, Edge, Samsung Internet, Android): one tap. */
  | "prompt"
  /** iPhone / iPad: no prompt exists; it is Share → Add to Home Screen, and only in Safari. */
  | "ios-safari"
  | "ios-other-browser"
  /** Safari on a Mac: File → Add to Dock. */
  | "mac-safari"
  /** Firefox on a computer cannot install web apps at all. */
  | "unsupported"
  /** A browser that can install, but has not offered yet (or the app is installed already). */
  | "menu";

export interface InstallFacts {
  userAgent: string;
  /** display-mode: standalone, or navigator.standalone on iOS. */
  standalone: boolean;
  /** A `beforeinstallprompt` event is in hand. */
  hasPrompt: boolean;
  /** An iPad says it is a Mac; touch points tell them apart. */
  maxTouchPoints: number;
}

export function installPath(f: InstallFacts): InstallPath {
  if (f.standalone) return "installed";
  if (f.hasPrompt) return "prompt";
  const ua = f.userAgent;
  if (/Instagram|FBAN|FBAV|FB_IAB|Line\/|MicroMessenger|TikTok|musical_ly|Snapchat|LinkedInApp/.test(ua)) return "in-app-browser";
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && f.maxTouchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? "ios-other-browser" : "ios-safari";
  const chromium = /Chrome|Chromium|Edg\//.test(ua);
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !chromium) return "mac-safari";
  if (/Firefox/.test(ua) && !/Android/.test(ua)) return "unsupported";
  return "menu";
}

/** The steps, in the words staff will read. One short line each. */
export function installSteps(path: InstallPath): string[] {
  switch (path) {
    case "installed":
      return ["Monza AI is installed — you are using the app now."];
    case "prompt":
      return ["Press Install. Monza AI gets its own icon and opens in its own window."];
    case "in-app-browser":
      return ["This is a mini-browser inside another app — it cannot install anything.", "Open monza-ai.vercel.app in Safari (iPhone) or Chrome (Android), then press “Get the app” there."];
    case "ios-safari":
      return ["Tap the Share button (the square with the arrow).", "Scroll down and tap “Add to Home Screen”. If you see “Open as Web App”, keep it switched ON.", "Tap Add. Open Monza AI from the new icon — it opens as an app, with no address bar."];
    case "ios-other-browser":
      return ["On iPhone and iPad, apps install from Safari.", "Open monza-ai.vercel.app in Safari, then tap Share → “Add to Home Screen”."];
    case "mac-safari":
      return ["In Safari’s menu bar, choose File → “Add to Dock…”.", "Press Add. Monza AI appears in the Dock."];
    case "unsupported":
      return ["Firefox on a computer cannot install web apps.", "Open Monza AI in Chrome or Edge and press Install there."];
    case "menu":
      return ["Open the browser’s menu (⋮ or …).", "Choose “Install app” or “Add to Home screen” → INSTALL — never “Create shortcut”: a shortcut opens the browser.", "If neither is there, the app is already installed on this device."];
  }
}

/**
 * THE ICON THAT OPENS THE BROWSER (Samer, 2026-09-21: "when I open it, it opens the browser"). An icon made
 * with the browser's "Create shortcut", or made before the site was installable, is only a bookmark: it
 * opens a browser tab, address bar and all, and it never turns into the app. The real app's icon opens
 * `start_url`, which carries `source=app` — so a page opened WITH that mark but NOT in an app window was
 * launched from such a bookmark, and the product can say so and show the fix.
 */
export function isShortcutLaunch(search: string, standalone: boolean): boolean {
  if (standalone) return false;
  const source = new URLSearchParams(search).get("source");
  return source === "app" || source === "app-shortcut";
}

/** How to replace a bookmark icon with the real app, before the device's own install steps. */
export const REPLACE_SHORTCUT_STEPS: readonly string[] = [
  "That icon is only a browser bookmark, so it will always open the browser. It cannot be converted.",
  "Press and hold it on your home screen and remove it.",
];

/** "Get the app" is offered again this long after somebody closes it. */
export const BANNER_SNOOZE_DAYS = 7;
export function bannerSnoozed(dismissedAtMs: number | null, nowMs: number): boolean {
  return dismissedAtMs !== null && Number.isFinite(dismissedAtMs) && nowMs - dismissedAtMs < BANNER_SNOOZE_DAYS * 86_400_000;
}

/* ── What the service worker may touch ───────────────────────────────────── */

/**
 * The service worker's whole policy, as a pure function so it is tested: which requests it answers
 * itself. Exactly one — a page navigation that failed because there is no network gets the offline
 * page. Everything else is left to the browser, untouched and uncached.
 */
export function workerHandles(request: { mode: string; method: string; sameOrigin: boolean }): "offline-fallback" | "leave-alone" {
  return request.sameOrigin && request.method === "GET" && request.mode === "navigate" ? "offline-fallback" : "leave-alone";
}
