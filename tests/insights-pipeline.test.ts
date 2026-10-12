/**
 * Connections & Data Pipeline Health (lib/insights/pipeline.ts): three questions answered apart, and a
 * failure is never shown as zero.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { accountHealth, stateOfCode, type AccountInput, type PipelineCounts } from "@/lib/insights/pipeline";

const NOW = Date.parse("2026-10-12T14:00:00Z");
const counts = (p: Partial<PipelineCounts> = {}): PipelineCounts => ({
  conversations: 10, customerMessages: 100, ourMessages: 50, lastCustomerMessage: "2026-10-12T13:00:00Z", lastOurMessage: null,
  labelled: 98, lastLabelled: "2026-10-12T13:00:05Z", facts: 20, unlabelledSinceRebuild: 0, unlabelledBefore: 2, testMessages: 5, ...p,
});
const input = (p: Partial<AccountInput> = {}): AccountInput => ({
  id: "wa-monza", channel: "whatsapp", brand: "monza", label: "WhatsApp", externalId: "1", connectedAt: null, keySet: true, instagramLoginKey: false,
  counts: counts(), run: null, whatsappRebuild: { state: "done", finishedAt: "2026-10-12T12:56:00Z" }, ...p,
});

describe("each question answered apart", () => {
  test("WhatsApp: arriving, history read, labelled", () => {
    const h = accountHealth(input(), NOW);
    assert.deepEqual([h.live.state, h.history.state, h.labels.state], ["working", "working", "working"]);
  });
  test("counts that could not be read are a database failure — never zero", () => {
    const h = accountHealth(input({ counts: null }), NOW);
    assert.equal(h.live.state, "database_failure");
    assert.equal(h.labels.state, "database_failure");
    assert.equal(h.counts, null);
  });
  test("messages arriving but not being read is a recognition failure", () => {
    const h = accountHealth(input({ counts: counts({ unlabelledSinceRebuild: 7, lastLabelled: "2026-10-12T10:00:00Z", lastCustomerMessage: "2026-10-12T13:00:00Z" }) }), NOW);
    assert.equal(h.labels.state, "recognition_failure");
  });
  test("Instagram with no webhook delivery ever: connected, no data — and says why", () => {
    const h = accountHealth(input({ id: "ig-voyah", channel: "instagram", keySet: true, instagramLoginKey: true, counts: counts({ customerMessages: 0, testMessages: 0, labelled: 0, lastCustomerMessage: null }), run: { state: "not_started", code: null, threads: 0, signals: 0, updatedAt: null } }), NOW);
    assert.equal(h.live.state, "connected_no_data");
    assert.match(h.live.detail, /rule 43/);
    assert.equal(h.history.state, "not_started");
  });
  test("no key at all", () => {
    assert.equal(accountHealth(input({ keySet: false }), NOW).live.state, "no_key");
  });
});

describe("Meta's stop codes", () => {
  test("map to the state that needs the right fix", () => {
    assert.equal(stateOfCode("meta_190"), "auth_invalid");
    assert.equal(stateOfCode("meta_10"), "permissions");
    assert.equal(stateOfCode("empty_first_page"), "permissions");
    assert.equal(stateOfCode("meta_4"), "rate_limited");
    assert.equal(stateOfCode("usage_over_75"), "rate_limited");
    assert.equal(stateOfCode("meta_-2_2534084"), "unknown");
    assert.equal(stateOfCode("no_token"), "no_key");
  });
});

describe("no key ever reaches the page", () => {
  test("the server sends only whether a key is set", () => {
    const src = readFileSync(join(process.cwd(), "lib/insights/pipeline-server.ts"), "utf8");
    assert.match(src, /keySet: channelToken\(a\.tokenEnv\) !== null/);
    assert.doesNotMatch(src, /token:\s*channelToken/);
  });
});
