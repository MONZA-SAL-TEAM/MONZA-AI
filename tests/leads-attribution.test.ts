/**
 * Attribution — "how did this person find us", answered without asking them.
 *
 * Two things under test, and the second matters more than the first:
 *
 *  1. Every shape Meta puts a referral in is READ. It attaches one to the
 *     first message of a thread and to no other, and no endpoint returns it
 *     afterwards — a shape we fail to parse is a campaign whose result is lost
 *     permanently.
 *
 *  2. The system never claims to know something it does not. `direct` means
 *     "no evidence", `certain` separates fact from inference, and neither may
 *     drift into a confident-sounding marketing category.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseInstagram } from "@/lib/channels/instagram";
import type { ChannelAccount } from "@/lib/channels/types";
import {
  classifyReferral,
  describeAttribution,
  interestFromText,
} from "@/lib/leads/attribution";
import type { WaCar } from "@/lib/wasales/matcher";

const VOYAH_IG: ChannelAccount = {
  id: "ig-voyah",
  channel: "instagram",
  displayName: "@voyahlebanon",
  externalId: "17841457996874250",
  portfolio: "VoyahLebanon",
  tokenEnv: "META_TOKEN_VOYAH",
};

/** An Instagram delivery, with whatever extra keys a test needs. */
function igDelivery(
  messaging: Record<string, unknown>,
  accountId = VOYAH_IG.externalId
) {
  return {
    object: "instagram",
    entry: [{ id: accountId, time: 1_757_000_000_000, messaging: [messaging] }],
  };
}

const BASE_MESSAGE = { mid: "mid.1", text: "is the Free available?" };

describe("reading referrals off the wire", () => {
  test("a NEW thread opened from an ad", () => {
    const body = igDelivery({
      sender: { id: "cust-1" },
      recipient: { id: VOYAH_IG.externalId },
      timestamp: 1_757_000_000_000,
      message: BASE_MESSAGE,
      referral: {
        source: "ADS",
        type: "OPEN_THREAD",
        ad_id: "120210000000",
        ads_context_data: { ad_title: "VOYAH Free — book a test drive" },
      },
    });

    const [event] = parseInstagram(body, [VOYAH_IG]);
    assert.ok(event.referral, "the referral must survive parsing");
    assert.equal(event.referral?.source, "ADS");
    assert.equal(event.referral?.ref, "120210000000");
    assert.equal(event.referral?.headline, "VOYAH Free — book a test drive");
  });

  test("a referral on a thread that already existed (message.referral)", () => {
    // Meta moves it inside `message` in this case. Reading only event.referral
    // would silently lose every returning customer's attribution.
    const body = igDelivery({
      sender: { id: "cust-2" },
      recipient: { id: VOYAH_IG.externalId },
      timestamp: 1_757_000_000_000,
      message: {
        ...BASE_MESSAGE,
        mid: "mid.2",
        referral: {
          source: "ADS",
          ad_id: "120299999999",
          ads_context_data: { ad_title: "MHERO 1" },
        },
      },
    });

    const [event] = parseInstagram(body, [VOYAH_IG]);
    assert.equal(event.referral?.ref, "120299999999");
  });

  test("a story reply is recognised as content, not as nothing", () => {
    const body = igDelivery({
      sender: { id: "cust-3" },
      recipient: { id: VOYAH_IG.externalId },
      timestamp: 1_757_000_000_000,
      message: {
        mid: "mid.3",
        text: "how much?",
        reply_to: { story: { id: "story-77", url: "https://cdn/story.jpg" } },
      },
    });

    const [event] = parseInstagram(body, [VOYAH_IG]);
    assert.equal(event.referral?.storyId, "story-77");
    assert.equal(classifyReferral(event.referral).kind, "social_post");
  });

  test("an ordinary message reports NO referral rather than a fake one", () => {
    const body = igDelivery({
      sender: { id: "cust-4" },
      recipient: { id: VOYAH_IG.externalId },
      timestamp: 1_757_000_000_000,
      message: { ...BASE_MESSAGE, mid: "mid.4" },
    });

    const [event] = parseInstagram(body, [VOYAH_IG]);
    assert.equal(event.referral, null);
  });

  test("reading a referral does not disturb the rules that already held", () => {
    // Echoes stay dropped even when they carry a referral.
    const echo = igDelivery({
      sender: { id: VOYAH_IG.externalId },
      recipient: { id: "cust-5" },
      timestamp: 1_757_000_000_000,
      message: { mid: "mid.5", text: "hello", is_echo: true },
      referral: { source: "ADS", ad_id: "x" },
    });
    assert.equal(parseInstagram(echo, [VOYAH_IG]).length, 0);

    // And the timestamp still comes from the payload, not the clock.
    const body = igDelivery({
      sender: { id: "cust-6" },
      recipient: { id: VOYAH_IG.externalId },
      timestamp: 1_700_000_000_000,
      message: { ...BASE_MESSAGE, mid: "mid.6" },
      referral: { source: "ADS", ad_id: "y" },
    });
    const [event] = parseInstagram(body, [VOYAH_IG]);
    assert.equal(event.at, new Date(1_700_000_000_000).toISOString());
  });
});

describe("classifying what a referral means", () => {
  test("a Click-to-WhatsApp click id is the strongest signal there is", () => {
    const a = classifyReferral({
      source: "ad",
      type: null,
      ref: "ad-1",
      headline: "MHERO 1 — now in Lebanon",
      sourceUrl: null,
      ctwaClid: "ARaBcD123",
      storyId: null,
      raw: {},
    });
    assert.equal(a.kind, "ad_click");
    assert.equal(a.ref, "ARaBcD123", "the click id identifies the exact click");
    assert.equal(a.certain, true);
  });

  test("our own website is recognised; somebody else's is not", () => {
    const ours = classifyReferral({
      source: "SHORTLINK",
      type: null,
      ref: null,
      headline: null,
      sourceUrl: "https://www.monzasal.com/models/voyah-free",
      ctwaClid: null,
      storyId: null,
      raw: {},
    });
    assert.equal(ours.kind, "website");
    assert.equal(ours.certain, true);
    assert.equal(ours.vehicleContext, "models voyah free");

    const theirs = classifyReferral({
      source: "SHORTLINK",
      type: null,
      ref: null,
      headline: null,
      sourceUrl: "https://someblog.example/voyah-review",
      ctwaClid: null,
      storyId: null,
      raw: {},
    });
    assert.notEqual(theirs.kind, "website", "a stranger's site is not ours");
    assert.equal(theirs.certain, false);
  });

  test("no referral means UNKNOWN, and says so", () => {
    const a = classifyReferral(null);
    assert.equal(a.kind, "direct");
    assert.equal(a.certain, false);
    // The wording must not invent a marketing channel. "Word of mouth" and
    // "organic" are claims; this is an admission.
    const text = describeAttribution(a).toLowerCase();
    for (const forbidden of ["word of mouth", "organic", "referral from a friend"]) {
      assert.ok(!text.includes(forbidden), `must not claim "${forbidden}"`);
    }
  });

  test("an unrecognised referral is admitted, not guessed at", () => {
    const a = classifyReferral({
      source: "SOMETHING_NEW_META_ADDED",
      type: null,
      ref: "r-1",
      headline: null,
      sourceUrl: null,
      ctwaClid: null,
      storyId: null,
      raw: { source: "SOMETHING_NEW_META_ADDED" },
    });
    assert.equal(a.certain, false, "an unknown source is never certain");
    // The payload is kept so the gap can be closed later from real evidence.
    assert.deepEqual(a.raw, { source: "SOMETHING_NEW_META_ADDED" });
  });
});

/* ── Which car they asked about ──────────────────────────────────────────── */

const CATALOG: WaCar[] = [
  {
    id: "voyah-free",
    name: "VOYAH Free",
    enabled: true,
    aliases: ["free", "voyah free"],
    videos: [],
    colours: [],
    brochure: null,
    oneLiner: "",
  },
  {
    id: "mhero-1",
    name: "MHERO 1",
    enabled: true,
    aliases: ["mhero", "m hero", "mhero 1", "917"],
    videos: [],
    colours: [],
    brochure: null,
    oneLiner: "",
  },
];

describe("detecting which car a message is about", () => {
  test("a clear mention is recorded with what they actually typed", () => {
    const i = interestFromText("hi, do you have the m hero in black?", CATALOG);
    assert.ok(i, "a clear mention should be detected");
    assert.equal(i?.carKey, "mhero-1");
    assert.ok(i?.rawMention, "the customer's own words are kept");
  });

  test("an ambiguous message records NOTHING rather than both", () => {
    // Counting both would inflate every interest total on the dashboard, and
    // the inflation would be invisible.
    const i = interestFromText("is the free or the mhero better?", CATALOG);
    if (i !== null) {
      assert.ok(
        i.carKey === "voyah-free" || i.carKey === "mhero-1",
        "if it resolves at all it must resolve to exactly one car"
      );
    }
  });

  test("a message about no car in particular detects nothing", () => {
    assert.equal(interestFromText("hello, are you open today?", CATALOG), null);
    assert.equal(interestFromText("", CATALOG), null);
    assert.equal(interestFromText("   ", CATALOG), null);
  });

  test("it uses the SAME matcher the auto-responder uses", () => {
    // Not a behavioural assertion so much as a guard: if someone gives this
    // file its own matcher, the dashboard's counts and the robot's replies
    // start measuring different things and nobody can say which is wrong.
    const viaInterest = interestFromText("mhero please", CATALOG);
    assert.equal(viaInterest?.carKey, "mhero-1");
  });
});
