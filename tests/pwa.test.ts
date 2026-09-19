/**
 * MONZA AI as an installable app (lib/pwa.ts): the manifest a browser needs, the install steps per
 * device, and — the part that matters — a service worker that never keeps staff or customer data.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { appManifest, installPath, installSteps, workerHandles, START_URL, THEME_COLOR } from "@/lib/pwa";
import { decideGate, isProtectedPath } from "@/lib/gate";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Width and height of a PNG, from its IHDR chunk. */
function pngSize(path: string): { width: number; height: number; alpha: boolean } {
  const b = readFileSync(join(ROOT, path));
  assert.equal(b.subarray(1, 4).toString("latin1"), "PNG", `${path} is not a PNG`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), alpha: b[25] === 6 || b[25] === 4 };
}

describe("the manifest", () => {
  const m = appManifest();

  test("has what Chrome, Edge and Android require to offer Install", () => {
    assert.equal(m.name, "Monza AI");
    assert.ok(m.short_name.length <= 12, "the name under the icon is not cut off");
    assert.equal(m.display, "standalone");
    assert.equal(m.scope, "/");
    assert.ok(m.start_url.startsWith(START_URL));
    assert.ok(m.start_url.startsWith("/") && m.id.startsWith("/"), "same-origin, relative");
    assert.match(m.theme_color, /^#[0-9A-F]{6}$/i);
    assert.equal(m.theme_color, THEME_COLOR);
    const sizes = m.icons.map((i) => `${i.sizes}:${i.purpose}`);
    assert.ok(sizes.includes("192x192:any") && sizes.includes("512x512:any"), "a 192 and a 512 icon are required");
    assert.ok(sizes.includes("512x512:maskable"), "Android crops a maskable icon to its own shape");
  });

  test("every icon it names exists, is a PNG, and is the size it claims", () => {
    for (const icon of [...m.icons, ...m.shortcuts.flatMap((s) => s.icons)]) {
      const file = `public${icon.src}`;
      assert.ok(existsSync(join(ROOT, file)), file);
      const { width, height } = pngSize(file);
      assert.equal(`${width}x${height}`, icon.sizes, file);
    }
    // iOS paints transparency black: the home-screen icon is a full, opaque square.
    const apple = pngSize("public/icons/apple-touch-icon.png");
    assert.deepEqual([apple.width, apple.height, apple.alpha], [180, 180, false]);
  });

  test("the app opens on, and its shortcuts point at, screens that are behind the sign-in", () => {
    for (const url of [m.start_url, ...m.shortcuts.map((s) => s.url)]) {
      const path = url.split("?")[0];
      assert.ok(isProtectedPath(path), `${path} must be a protected screen — installing adds no access`);
      assert.deepEqual(decideGate({ pathname: path, search: "", token: undefined, crmConfigured: true }).action, "redirect");
    }
  });

  test("the layout links the manifest, the icons and the iPhone settings", () => {
    const layout = read("app/layout.tsx");
    assert.match(layout, /manifest: "\/manifest\.webmanifest"/);
    assert.match(layout, /apple-touch-icon\.png/);
    assert.match(layout, /appleWebApp/);
    assert.match(layout, /themeColor: \[/);
    assert.match(layout, /capable: true/);
    assert.match(read("app/manifest.ts"), /appManifest\(\)/);
  });

  test("what the browser must fetch WITHOUT a sign-in is not behind the gate", () => {
    for (const path of ["/manifest.webmanifest", "/sw.js", "/offline.html", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/icons/apple-touch-icon.png"]) {
      assert.equal(isProtectedPath(path), false, path);
      assert.equal(decideGate({ pathname: path, search: "", token: undefined, crmConfigured: true }).action, "pass", path);
    }
  });
});

describe("the service worker never keeps Monza's data", () => {
  const sw = read("public/sw.js");

  test("policy: only a failed page navigation is answered — with the offline page", () => {
    assert.equal(workerHandles({ mode: "navigate", method: "GET", sameOrigin: true }), "offline-fallback");
    for (const r of [
      { mode: "cors", method: "GET", sameOrigin: true }, // an API read
      { mode: "same-origin", method: "POST", sameOrigin: true }, // a send
      { mode: "no-cors", method: "GET", sameOrigin: true }, // an image, a file
      { mode: "navigate", method: "POST", sameOrigin: true }, // a form
      { mode: "navigate", method: "GET", sameOrigin: false },
    ]) assert.equal(workerHandles(r), "leave-alone", JSON.stringify(r));
  });

  test("the file itself: it writes to a cache ONCE, at install, and only the offline page and its icon", () => {
    const code = sw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.match(code, /const OFFLINE_FILES = \["\/offline\.html", "\/icons\/icon-192\.png"\];/);
    // No response is ever put in a cache: no cache.put, no cache.add outside the install list.
    assert.doesNotMatch(code, /\.put\(/);
    assert.equal((code.match(/\.addAll\(/g) ?? []).length, 1);
    assert.doesNotMatch(code, /\.add\((?!All)/);
    // Nothing is ever READ from a cache except the offline page.
    const matches = code.match(/\.match\(([^)]*)\)/g) ?? [];
    assert.deepEqual(matches, ['.match("/offline.html")']);
    // The fetch handler mirrors the tested policy, and never names the API.
    assert.match(code, /request\.method === "GET" && request\.mode === "navigate"/);
    assert.doesNotMatch(code, /\/api\//);
    // An older worker's caches are removed.
    assert.match(code, /caches\.delete/);
  });

  test("the offline page carries no data and no script that reads any", () => {
    const html = read("public/offline.html");
    assert.doesNotMatch(html, /fetch\(|localStorage|indexedDB|cookie/i);
    assert.match(html, /No internet connection/);
  });

  test("it is registered from the app, and a failed registration never breaks the page", () => {
    const c = read("components/InstallApp.tsx");
    assert.match(c, /serviceWorker\.register\("\/sw\.js", \{ scope: "\/" \}\)\.catch\(/);
    assert.match(read("components/SideNav.tsx"), /<InstallApp \/>/);
  });
});

describe("inside the installed app it behaves like an app, not a page", () => {
  const css = read("app/globals.css");
  test("no address bar is the manifest's job: a standalone window, never 'browser' or 'minimal-ui' first", () => {
    const m = appManifest();
    assert.equal(m.display, "standalone");
    assert.equal(m.display_override[0], "standalone");
  });
  test("no page tells: no rubber-band, no tap flash, no zoom into fields, the phone's real height, safe areas", () => {
    const standalone = css.slice(css.indexOf("@media (display-mode: standalone), (display-mode: fullscreen)"));
    assert.match(standalone, /overscroll-behavior: none/);
    assert.match(standalone, /-webkit-tap-highlight-color: transparent/);
    assert.match(standalone, /-webkit-touch-callout: none/);
    assert.match(standalone, /env\(safe-area-inset-top\)/);
    assert.match(standalone, /env\(safe-area-inset-bottom\)/);
    assert.match(css, /@media \(pointer: coarse\) \{\s*input, textarea, select \{ font-size: 16px; \}/);
    assert.match(css, /height: 100dvh/);
    assert.match(read("app/layout.tsx"), /viewportFit: "cover"/);
  });
  test("what staff need to copy stays selectable: selection is only switched off on controls", () => {
    const rule = css.match(/([^{}]*)\{[^{}]*user-select: none;/g) ?? [];
    assert.ok(rule.length >= 1);
    for (const r of rule) assert.doesNotMatch(r.split("{")[0], /(^|[\s,])(body|html|\*|main|p|\.app-main)(\s|,|$)/, r.split("{")[0]);
  });
});

describe("the install button says the right thing on each device", () => {
  const UA = {
    chromeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    edgeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0",
    android: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
    iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.0.0 Mobile/15E148 Safari/604.1",
    ipadAsMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    firefoxWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0",
  };
  const at = (userAgent: string, o: Partial<{ standalone: boolean; hasPrompt: boolean; maxTouchPoints: number }> = {}) =>
    installPath({ userAgent, standalone: false, hasPrompt: false, maxTouchPoints: 0, ...o });

  test("one tap where the browser offers it; the right steps where it cannot", () => {
    assert.equal(at(UA.chromeWin, { hasPrompt: true }), "prompt");
    assert.equal(at(UA.android, { hasPrompt: true }), "prompt");
    assert.equal(at(UA.edgeWin), "menu");
    assert.equal(at(UA.macChrome), "menu");
    assert.equal(at(UA.iphoneSafari, { maxTouchPoints: 5 }), "ios-safari");
    assert.equal(at(UA.iphoneChrome, { maxTouchPoints: 5 }), "ios-other-browser");
    assert.equal(at(UA.ipadAsMac, { maxTouchPoints: 5 }), "ios-safari", "an iPad calls itself a Mac");
    assert.equal(at(UA.ipadAsMac, { maxTouchPoints: 0 }), "mac-safari");
    assert.equal(at(UA.firefoxWin), "unsupported");
    // Inside the installed app, nothing is offered — whatever the device.
    for (const ua of Object.values(UA)) assert.equal(at(ua, { standalone: true, hasPrompt: true }), "installed");
  });

  test("every path has short, plain steps", () => {
    for (const p of ["installed", "prompt", "ios-safari", "ios-other-browser", "mac-safari", "unsupported", "menu"] as const) {
      const steps = installSteps(p);
      assert.ok(steps.length >= 1 && steps.length <= 3, p);
      for (const s of steps) assert.ok(s.length <= 110, `${p}: ${s}`);
    }
    assert.match(installSteps("ios-safari").join(" "), /Add to Home Screen/);
    assert.match(installSteps("mac-safari").join(" "), /Add to Dock/);
  });
});
