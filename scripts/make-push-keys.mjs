#!/usr/bin/env node
/**
 * Makes the key pair Monza AI signs its push notifications with (lib/push/webpush.ts).
 *
 *   node scripts/make-push-keys.mjs you@your-company.com
 *
 * Run it ONCE, in your own terminal, and paste the three lines into Vercel → Project monza-ai →
 * Settings → Environment Variables (Production), then redeploy. Never paste them into a chat, a
 * screenshot or this repository (it is PUBLIC). The private key is a secret; the public one is not.
 *
 * Making a NEW pair later switches notifications off on every device until each one presses
 * "Turn on notifications" again — so keep the pair you have unless the private key leaked.
 */
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = privateKey.export({ format: "jwk" });
const pub = publicKey.export({ format: "jwk" });
const point = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]);

console.log("\nPaste these three into Vercel (Production), then redeploy:\n");
console.log(`WEB_PUSH_VAPID_PUBLIC_KEY=${point.toString("base64url")}`);
console.log(`WEB_PUSH_VAPID_PRIVATE_KEY=${jwk.d}`);
// An address a push service (Apple, Google) can write to if something misbehaves. Yours — it is not shown to anybody.
console.log(`WEB_PUSH_SUBJECT=mailto:${process.argv[2] ?? "PUT-YOUR-EMAIL-HERE"}`);
console.log("\nThe private key is a secret: Vercel only. Close this window when you are done.\n");
