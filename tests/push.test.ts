/**
 * Notifications when the app is closed (lib/push/). Samer, 2026-09-21: "I'm not receiving
 * notifications outside the app."
 *
 * What must hold: the server only ever knocks on a real push service (never a URL a browser made up);
 * unconfigured refuses; the knock carries nothing; the one line shown says who and where and never a
 * customer's words; a tap can only open Monza AI; and a person is told, per device, why it cannot ring.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GENERIC_NOTE, alertNote, isPushEndpoint, messageNote, outcomeOf, pushRequest, safeNoteUrl, sendPush, vapidFromEnv, vapidToken, type VapidKeys } from "@/lib/push/webpush";
import { isIosDevice, keyBytes, pushHelp, pushPath, type PushFacts } from "@/lib/push/device";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

function makeKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pub = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const prv = privateKey.export({ format: "jwk" }) as { d: string };
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]);
  return { publicKey: point.toString("base64url"), privateKey: prv.d, subject: "mailto:someone@example.com" };
}

const FCM = "https://fcm.googleapis.com/fcm/send/abc123:APA91b";
const APPLE = "https://web.push.apple.com/QGxyz";

describe("only a real push service is ever called", () => {
  test("the four services' hosts are accepted", () => {
    for (const e of [FCM, APPLE, "https://updates.push.services.mozilla.com/wpush/v2/gAAAA", "https://db5p.notify.windows.com/w/?token=abc"]) assert.equal(isPushEndpoint(e), true, e);
  });

  test("anything else is refused — a subscription is typed by a browser, and the server POSTs to it", () => {
    for (const e of [
      "http://fcm.googleapis.com/fcm/send/abc", // not https
      "https://fcm.googleapis.com.evil.example/fcm/send/abc",
      "https://evil.example/fcm.googleapis.com",
      "https://user:pass@fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com:8443/fcm/send/abc",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/x",
      "https://push.apple.com.evil.example/x",
      "https://okxpsvukzjjubinhamek.supabase.co/rest/v1/customers",
      "javascript:alert(1)",
      "",
      null,
      42,
      "https://fcm.googleapis.com/" + "a".repeat(1100),
    ]) assert.equal(isPushEndpoint(e), false, String(e).slice(0, 60));
    assert.equal(pushRequest("https://evil.example/x", makeKeys(), Date.now()), null);
  });

  test("a refused address is reported as gone, and nothing is fetched", async () => {
    let called = 0;
    const fake = (async () => (called++, new Response(null, { status: 201 }))) as unknown as typeof fetch;
    assert.equal(await sendPush("https://evil.example/x", makeKeys(), undefined, fake), "gone");
    assert.equal(called, 0);
  });
});

describe("unconfigured refuses", () => {
  const k = makeKeys();
  const env = { WEB_PUSH_VAPID_PUBLIC_KEY: k.publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: k.privateKey, WEB_PUSH_SUBJECT: k.subject };

  test("all three are needed, and each must be the right shape", () => {
    assert.deepEqual(vapidFromEnv(env), k);
    assert.equal(vapidFromEnv({}), null);
    for (const name of Object.keys(env)) assert.equal(vapidFromEnv({ ...env, [name]: "" }), null, name);
    assert.equal(vapidFromEnv({ ...env, WEB_PUSH_VAPID_PUBLIC_KEY: k.privateKey }), null);
    assert.equal(vapidFromEnv({ ...env, WEB_PUSH_VAPID_PRIVATE_KEY: k.publicKey }), null);
    assert.equal(vapidFromEnv({ ...env, WEB_PUSH_SUBJECT: "someone@example.com" }), null);
    assert.equal(vapidFromEnv({ ...env, WEB_PUSH_SUBJECT: "http://example.com" }), null);
  });

  test("a value saved with spaces round it still works", () => {
    assert.deepEqual(vapidFromEnv({ ...env, WEB_PUSH_VAPID_PRIVATE_KEY: ` ${k.privateKey}\n` }), k);
  });
});

describe("the knock: a signed token and nothing else", () => {
  const keys = makeKeys();
  const now = Date.UTC(2026, 8, 21, 9, 0, 0);

  test("the token verifies against the public key, names the push service, and lasts under a day", () => {
    const token = vapidToken(keys, "https://fcm.googleapis.com", now);
    const [h, c, s] = token.split(".");
    assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    assert.equal(claims.aud, "https://fcm.googleapis.com");
    assert.equal(claims.sub, keys.subject);
    assert.ok(claims.exp > now / 1000 && claims.exp <= now / 1000 + 24 * 3600);

    const pub = Buffer.from(keys.publicKey, "base64url");
    const key = createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") } });
    const sig = Buffer.from(s, "base64url");
    assert.equal(sig.length, 64); // raw r‖s, which is what a JWT wants — not DER
    assert.equal(verify("sha256", Buffer.from(`${h}.${c}`), { key, dsaEncoding: "ieee-p1363" }, sig), true);
    // Somebody else's key does not verify it.
    const other = Buffer.from(makeKeys().publicKey, "base64url");
    const otherKey = createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: other.subarray(1, 33).toString("base64url"), y: other.subarray(33).toString("base64url") } });
    assert.equal(verify("sha256", Buffer.from(`${h}.${c}`), { key: otherKey, dsaEncoding: "ieee-p1363" }, sig), false);
  });

  test("the request has no body, the audience is the endpoint's own origin, and the private key is nowhere in it", () => {
    const req = pushRequest(APPLE, keys, now, "chat-wa-monza:abc/def");
    assert.ok(req);
    assert.equal(req.url, APPLE);
    assert.equal(req.headers["Content-Length"], "0");
    assert.equal(req.headers.TTL, "3600");
    assert.equal(req.headers.Urgency, "high");
    assert.match(req.headers.Topic, /^[A-Za-z0-9_-]{1,32}$/);
    assert.match(req.headers.Authorization, new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${keys.publicKey}$`));
    const claims = JSON.parse(Buffer.from(req.headers.Authorization.split(".")[1], "base64url").toString());
    assert.equal(claims.aud, "https://web.push.apple.com");
    assert.ok(!JSON.stringify(req).includes(keys.privateKey));
  });

  test("sendPush POSTs exactly that, with no body", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => (seen.push({ url, init }), new Response(null, { status: 201 }))) as unknown as typeof fetch;
    assert.equal(await sendPush(FCM, keys, "chat-1", fake), "sent");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, FCM);
    assert.equal(seen[0].init.method, "POST");
    assert.equal(seen[0].init.body, undefined);
  });

  test("what the push service answers decides what happens to the device", async () => {
    assert.equal(outcomeOf(201), "sent");
    assert.equal(outcomeOf(404), "gone");
    assert.equal(outcomeOf(410), "gone");
    assert.equal(outcomeOf(403), "rejected");
    assert.equal(outcomeOf(429), "failed");
    assert.equal(outcomeOf(500), "failed");
    const down = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    assert.equal(await sendPush(FCM, keys, undefined, down), "failed");
  });
});

describe("what a notification says", () => {
  test("a new message: who and where, and a tap opens that chat", () => {
    const n = messageNote({ threadId: "wa-monza~abc", channel: "whatsapp", who: "Rami K.", brand: "monza" });
    assert.equal(n.title, "New WhatsApp message");
    assert.equal(n.body, "Rami K. · MONZA");
    assert.equal(n.url, "/inbox?open=wa-monza~abc");
    assert.equal(safeNoteUrl(n.url), n.url);
  });

  test("Instagram and Facebook chats are read live, so the tap opens the inbox", () => {
    const n = messageNote({ threadId: null, channel: "instagram", who: null, brand: "voyah" });
    assert.equal(n.title, "New Instagram message");
    assert.equal(n.body, "A customer · VOYAH");
    assert.equal(n.url, "/inbox");
  });

  test("an urgent alert says why, in the engine's words", () => {
    assert.equal(alertNote({ threadId: "t1", label: "Wants to buy", cars: ["VOYAH Courage"], who: "+96170000000", urgency: "hot" }).title, "Ready to buy");
    assert.equal(alertNote({ threadId: "t1", label: "Waiting", cars: [], who: null, urgency: "overdue" }).title, "Kept waiting — reply now");
  });

  test("the types have no place for a customer's words, and no money", () => {
    const src = read("lib/push/webpush.ts");
    // What the two notes are built FROM: ids, a channel, a name, a brand, the engine's label and cars. Nothing else.
    const inputs = [...src.matchAll(/export function (?:messageNote|alertNote)\(\w: \{([^}]*)\}/g)].map((m) =>
      m[1].split(";").map((f) => f.split(":")[0].trim()).filter(Boolean)
    );
    assert.deepEqual(inputs, [
      ["threadId", "channel", "who", "brand"],
      ["threadId", "label", "cars", "who", "urgency"],
    ]);
    for (const n of [GENERIC_NOTE, messageNote({ threadId: null, channel: "facebook", who: null, brand: null })]) assert.doesNotMatch(`${n.title} ${n.body}`, /[$€£]|\bUSD\b|price/i);
  });

  test("a tap can only open Monza AI itself", () => {
    for (const bad of ["https://evil.example", "//evil.example", "javascript:alert(1)", "/inbox\nx", "/a b", "", null, 7, "inbox"]) assert.equal(safeNoteUrl(bad), "/inbox", String(bad));
    assert.equal(safeNoteUrl("/inbox?open=wa-monza~abc%2Fdef"), "/inbox?open=wa-monza~abc%2Fdef");
  });
});

describe("the device: can it ring, and if not, why", () => {
  const base: PushFacts = { supported: true, permission: "default", subscribed: false, serverReady: true, ios: false, standalone: false };

  test("the six answers", () => {
    assert.equal(pushPath(base), "off");
    assert.equal(pushPath({ ...base, permission: "granted", subscribed: true }), "on");
    // Permission alone is not "on": the old in-tab alerts granted it, and the phone still never rang.
    assert.equal(pushPath({ ...base, permission: "granted", subscribed: false }), "off");
    assert.equal(pushPath({ ...base, permission: "denied", subscribed: true }), "blocked");
    assert.equal(pushPath({ ...base, serverReady: false }), "not-set-up");
    assert.equal(pushPath({ ...base, serverReady: null }), "off");
    assert.equal(pushPath({ ...base, supported: false }), "unsupported");
  });

  test("an iPhone in a Safari tab is told to install first — Apple's rule", () => {
    assert.equal(pushPath({ ...base, supported: false, ios: true, standalone: false }), "needs-install");
    assert.equal(pushPath({ ...base, supported: false, ios: true, standalone: true }), "unsupported"); // iOS older than 16.4
    assert.equal(pushPath({ ...base, ios: true, standalone: true }), "off");
    assert.match(pushHelp("needs-install", true), /Add to Home Screen/);
    assert.match(pushHelp("blocked", true), /Settings/);
  });

  test("an iPad says it is a Mac", () => {
    assert.equal(isIosDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)", 5), true);
    assert.equal(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5), true);
    assert.equal(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0), false);
    assert.equal(isIosDevice("Mozilla/5.0 (Linux; Android 14)", 5), false);
  });

  test("the public key becomes the 65 bytes the browser wants, or nothing", () => {
    const k = makeKeys();
    const bytes = keyBytes(k.publicKey);
    assert.ok(bytes);
    assert.equal(bytes.length, 65);
    assert.equal(bytes[0], 4);
    assert.deepEqual(Buffer.from(bytes), Buffer.from(k.publicKey, "base64url"));
    assert.equal(keyBytes(k.privateKey), null);
    assert.equal(keyBytes("not a key!"), null);
    assert.equal(keyBytes(""), null);
  });

  test("the page-side helper pulls in nothing from node", () => {
    assert.doesNotMatch(read("lib/push/device.ts"), /^\s*import\s/m);
  });
});

describe("the service worker's half", () => {
  const code = read("public/sw.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("it asks one address, never keeps the answer, and ALWAYS shows something", () => {
    assert.match(code, /const PUSH_NOTE_URL = "\/api\/push\/latest";/);
    assert.match(code, /cache: "no-store"/);
    assert.match(code, /addEventListener\("push"/);
    assert.match(code, /showNotification\(/);
    // Every failure path ends in the generic line — a silent wake-up gets the permission withdrawn.
    assert.ok((code.match(/return GENERIC_NOTE;/g) ?? []).length >= 3);
    // The push event's own data is never read: the knock carries nothing.
    assert.doesNotMatch(code, /event\.data/);
  });

  test("the worker and the server say the same generic line and apply the same tap rule", () => {
    assert.ok(code.includes(JSON.stringify(GENERIC_NOTE.body)));
    assert.ok(code.includes(`/^\\/(?!\\/)[A-Za-z0-9/_?=&%.~-]*$/`));
    assert.match(code, /notificationclick/);
    assert.match(code, /openWindow\(url\)/);
  });
});

describe("the webhook can never be failed by a notification", () => {
  test("it is called inside its own try/catch, before the bot answers, with a budget", () => {
    const route = read("app/api/channels/meta/route.ts");
    const at = route.indexOf("await notifyNewMessages(result.fresh, PUSH_BUDGET_MS)");
    assert.ok(at > 0);
    assert.ok(at < route.indexOf("await runAutoreply("));
    assert.match(route.slice(at - 120, at + 200), /try \{[\s\S]*catch/);
    assert.match(route, /const PUSH_BUDGET_MS = \d_\d{3};/);
  });

  test("the private key is only ever read from the environment, and the table is closed", () => {
    const sql = read("database/migrations/019_push_notifications.sql");
    assert.equal((sql.match(/enable row level security/g) ?? []).length, 2);
    assert.doesNotMatch(sql, /create policy/i);
    assert.doesNotMatch(read("app/api/push/key/route.ts"), /privateKey/);
  });
});
