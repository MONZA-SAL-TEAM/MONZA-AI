/**
 * Server-side Supabase reads must never be served from a cache: a stale
 * channel_accounts list made the Monza SAL accounts "not connected" in two
 * routes (2026-09-10).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { noStoreFetch } from "@/lib/supabase-fetch";

test("every request goes out with cache: no-store, keeping everything else", async () => {
  const seen: { input: unknown; init: RequestInit | undefined }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    seen.push({ input, init });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await noStoreFetch("https://example.supabase.co/rest/v1/channel_accounts", {
      method: "GET",
      headers: { apikey: "k" },
      cache: "force-cache",
    });
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(seen.length, 1);
  assert.equal(seen[0].input, "https://example.supabase.co/rest/v1/channel_accounts");
  assert.equal(seen[0].init?.cache, "no-store", "a caller's cache setting must not win");
  assert.equal(seen[0].init?.method, "GET");
  assert.deepEqual(seen[0].init?.headers, { apikey: "k" });
});
