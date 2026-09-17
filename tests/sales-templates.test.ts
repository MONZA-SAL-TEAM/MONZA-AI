/**
 * The executor's words and shapes (lib/wasales/templates.ts), and the send
 * policy that decides whether any of them may leave (lib/wasales/actions.ts).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  actionLabel,
  contactFallbackText,
  planLines,
  renderPlan,
  type OutboundPart,
} from "@/lib/wasales/templates";
import { applySendPolicy, finalizeActions, type EngineAction, type SendContext } from "@/lib/wasales/actions";
import { MONZA_KNOWLEDGE, type SalesChannel } from "@/lib/wasales/knowledge";
import { folderMedia, loadCatalog } from "@/lib/wasales/catalog";
import { previewSendContext, runConversation } from "@/lib/wasales/flow";
import { SAMPLE_MESSAGES } from "@/lib/wasales/catalog-data";

const K = MONZA_KNOWLEDGE;

function render(actions: EngineAction[], channel: SalesChannel = "instagram", brand: "voyah" | "mhero" | "monza" = "voyah") {
  return renderPlan(actions, { channel, brand, knowledge: K });
}

function texts(parts: OutboundPart[]): string[] {
  return parts.filter((p) => p.kind === "text").map((p) => (p.kind === "text" ? p.text : ""));
}

const BROCHURE: EngineAction = {
  type: "SEND_BROCHURE",
  model: "COURAGE",
  asset: { name: "Voyah courage 2026 catalogue.pdf", bytes: 31_465_661 },
  explicit: false,
};

describe("the words", () => {
  test("the contact fallback is the workbook's hand-off, exactly", () => {
    assert.equal(contactFallbackText(K), "For further assistance, please contact us on 70 70 85 85.");
    assert.deepEqual(texts(render([{ type: "SEND_CONTACT_FALLBACK", reasons: [{ kind: "CONTACT_NUMBER" }] }])), [
      "For further assistance, please contact us on 70 70 85 85.",
    ]);
  });

  test("a brochure is a sentence, then the PDF — two messages", () => {
    const parts = render([BROCHURE]);
    assert.deepEqual(planLines(parts), [
      "Here is the VOYAH Courage brochure.",
      "[PDF: Voyah courage 2026 catalogue.pdf]",
    ]);
  });

  test("a fact carries its approved value and nothing else", () => {
    const one = (fact: "RANGE" | "HORSEPOWER", value: string): EngineAction => ({
      type: "SEND_FACTS",
      scope: "one",
      rows: [{ model: "PASSION_L", fact, value, confirmed: true }],
    });
    assert.deepEqual(texts(render([one("RANGE", "TEST-RANGE")])), ["The VOYAH Passion L offers TEST-RANGE."]);
    assert.deepEqual(texts(render([one("HORSEPOWER", "TEST-HP")])), ["The VOYAH Passion L produces TEST-HP."]);
  });

  test("a fact the workbook does not state is 'not confirmed yet', with the number", () => {
    const empty: EngineAction = {
      type: "SEND_FACTS",
      scope: "one",
      rows: [{ model: "PASSION_L", fact: "BATTERY", value: "", confirmed: false }],
    };
    assert.deepEqual(texts(render([empty])), [
      "The exact battery capacity of the VOYAH Passion L is not confirmed yet. Our team can confirm it for you on 70 70 85 85.",
    ]);
  });

  test("several cars: one labelled line each; every car: the workbook's header", () => {
    const rows = [
      { model: "COURAGE" as const, fact: "HORSEPOWER" as const, value: "320 kW / 435 PS", confirmed: true },
      { model: "MHERO_1" as const, fact: "HORSEPOWER" as const, value: "805 hp", confirmed: true },
    ];
    assert.deepEqual(texts(render([{ type: "SEND_FACTS", scope: "several", rows }])), [
      "Power:\n• VOYAH Courage — 320 kW / 435 PS\n• MHERO 1 — 805 hp",
    ]);
    assert.deepEqual(texts(render([{ type: "SEND_FACTS", scope: "all", rows }])), [
      "Here is the power output for our current models:\n• VOYAH Courage — 320 kW / 435 PS\n• MHERO 1 — 805 hp",
    ]);
  });

  test("a single-colour video names no colour; a picked one says so", () => {
    const video = (onlyOption: boolean, chosenForThem: boolean): EngineAction => ({
      type: "SEND_COLOUR_VIDEO",
      model: "DREAM",
      colour: "standard",
      colourName: "Standard",
      asset: { name: "dream.mp4", bytes: 1 },
      chosenForThem,
      onlyOption,
    });
    assert.deepEqual(texts(render([video(true, false)])), ["Here is a video of the VOYAH Dream."]);
    assert.deepEqual(texts(render([video(false, true)])), [
      "Here is the VOYAH Dream in Standard — a favourite of ours.",
    ]);
  });

  test("the welcome names the account's own brand", () => {
    const hello: EngineAction = { type: "SHOW_MODEL_CHOICES", models: ["MHERO_1", "MHERO_2"], greet: true, narrowed: false };
    // The brand replaces "Monza S.A.L." and the sentence keeps its full stop.
    assert.equal(
      texts(render([hello], "instagram", "mhero"))[0],
      "Hello and welcome to MHERO Lebanon. How can we help you today?\n\nWhich model are you interested in?"
    );
    assert.match(texts(render([hello], "whatsapp", "monza"))[0], /^Hello and welcome to Monza S\.A\.L\. How can we help you today\?/);
    assert.match(texts(render([hello], "whatsapp", "voyah"))[0], /^Hello and welcome to VOYAH Lebanon\./);
  });

  test("the department menu: the welcome, then Sales / Service & Parts / Administration", () => {
    // The same full stop on the department menu.
    const [p] = render([{ type: "SHOW_DEPARTMENTS" }], "whatsapp", "voyah");
    assert.ok(p.kind === "text");
    if (p.kind === "text") {
      assert.equal(p.text, "Hello and welcome to VOYAH Lebanon. How can we help you today?\n\nPlease choose an option:");
      assert.deepEqual(p.choices.map((c) => c.title), ["Sales", "Service & Parts", "Administration"]);
      assert.deepEqual(p.choices.map((c) => c.payload), ["DEPT:SALES", "DEPT:SERVICE", "DEPT:ADMIN"]);
    }
  });

  test("the fixed hand-offs, word for word", () => {
    const say = (key: "PRICE_HANDOFF" | "SERVICE_CONTACT" | "OTHER_BRAND", models: "COURAGE"[] = []) =>
      texts(render([{ type: "SEND_TEXT", key, models }]))[0];
    assert.equal(say("PRICE_HANDOFF", ["COURAGE"]), "For current pricing of the VOYAH Courage, please contact our sales team on 70 70 85 85.");
    assert.equal(say("SERVICE_CONTACT"), "For Service, Maintenance, or Spare Parts, please contact 76 877 278.");
    assert.equal(say("OTHER_BRAND"), "We currently specialize in VOYAH and MHERO vehicles in Lebanon.");
  });

  test("the colour question names the car and its colours", () => {
    const [p] = render([
      { type: "SHOW_COLOUR_CHOICES", model: "COURAGE", colours: [{ id: "black", name: "Black" }, { id: "grey", name: "Grey" }] },
    ]);
    assert.ok(p.kind === "text");
    if (p.kind === "text") {
      assert.equal(p.text, "Which exterior colour would you like to see? We can show you the VOYAH Courage in Black or Grey.");
    }
  });

  test("gaps and staff flags are never shown to a customer", () => {
    assert.deepEqual(
      render([
        { type: "CONTENT_GAP", model: "COURAGE", content: "FACT", key: "RANGE", status: "MISSING", detail: "x" },
        { type: "FLAG_FOR_STAFF", reason: "y" },
      ]),
      []
    );
  });
});

describe("choices, shaped for the channel", () => {
  const models = (n: number): EngineAction => ({
    type: "SHOW_MODEL_CHOICES",
    models: Array.from({ length: n }, (_, i) => K.models[i % K.models.length].code),
    greet: false,
    narrowed: false,
  });
  const style = (a: EngineAction, ch: SalesChannel) => {
    const p = render([a], ch)[0];
    return p.kind === "text" ? p.style : null;
  };

  test("Instagram and Messenger: quick replies up to 13", () => {
    assert.equal(style(models(6), "instagram"), "quick_replies");
    assert.equal(style(models(8), "facebook"), "quick_replies");
  });

  test("WhatsApp: buttons up to 3, a list up to 10, numbers beyond", () => {
    assert.equal(style(models(3), "whatsapp"), "buttons");
    assert.equal(style(models(8), "whatsapp"), "list");
    assert.equal(style(models(11), "whatsapp"), "numbered");
  });

  test("a numbered list is written out, and asks for the number", () => {
    const p = render([models(11)], "whatsapp")[0];
    assert.ok(p.kind === "text");
    if (p.kind === "text") {
      assert.match(p.text, /\n1\. VOYAH Free 318\n2\. VOYAH Courage\n/);
      assert.match(p.text, /Reply with the number\.$/);
    }
  });

  test("titles too long for a button fall back to numbers", () => {
    const long: EngineAction = {
      type: "SHOW_COLOUR_CHOICES",
      model: "COURAGE",
      colours: [{ id: "a", name: "Obsidian Midnight Black Pearl" }, { id: "b", name: "Grey" }],
    };
    assert.equal(style(long, "instagram"), "numbered");
    assert.equal(style(long, "whatsapp"), "numbered");
  });

  test("every choice carries its stable payload", () => {
    const p = render([
      { type: "SHOW_COLOUR_CHOICES", model: "COURAGE", colours: [{ id: "black", name: "Black" }] },
    ])[0];
    assert.ok(p.kind === "text");
    if (p.kind === "text") assert.deepEqual(p.choices, [{ title: "Black", payload: "COLOUR:COURAGE:BLACK" }]);
    const m = render([models(2)])[0];
    if (m.kind === "text") assert.deepEqual(m.choices.map((c) => c.payload), ["MODEL:FREE_318", "MODEL:COURAGE"]);
  });
});

describe("the staff labels", () => {
  test("read the way the specification writes them", () => {
    assert.equal(actionLabel(BROCHURE), "SEND COURAGE BROCHURE");
    assert.equal(
      actionLabel({ type: "SEND_FACTS", scope: "all", rows: [{ model: "COURAGE", fact: "RANGE", value: "x", confirmed: true }] }),
      "SEND COURAGE RANGE (ALL MODELS)"
    );
    assert.equal(
      actionLabel({ type: "SEND_TEXT", key: "PRICE_HANDOFF", models: ["MHERO_1", "MHERO_2"] }),
      "SAY PRICE HANDOFF (MHERO 1, MHERO 2)"
    );
    assert.equal(
      actionLabel({ type: "SHOW_COLOUR_CHOICES", model: "PASSION_L", colours: [] }),
      "SHOW PASSION L COLOURS"
    );
  });
});

describe("every conversation renders to real words", () => {
  test("no placeholder, no undefined, no empty message — on every channel", () => {
    const catalog = loadCatalog();
    for (const channel of ["instagram", "facebook", "whatsapp"] as const) {
      for (const brand of ["voyah", "mhero", "monza"]) {
        for (const s of SAMPLE_MESSAGES) {
          const { turns } = runConversation(
            [s.text, "2", "1", "range?"].map((text, i) => ({
              text,
              brand,
              conversationIsNew: i === 0,
              now: new Date(Date.UTC(2026, 8, 14, 9, i)).toISOString(),
            })),
            { knowledge: K, catalog, media: folderMedia, ttlHours: 72 },
            previewSendContext(channel)
          );
          for (const t of turns) {
            for (const line of planLines(t.plan)) {
              assert.ok(line.trim().length > 3, line);
              assert.doesNotMatch(line, /undefined|null|NaN|\{\{|\[object/, line);
            }
          }
        }
      }
    }
  });
});

describe("the send policy", () => {
  const LIVE: SendContext = {
    channel: "instagram",
    autoSendEnabled: true,
    replyWindowOpen: true,
    humanLock: false,
    liveSending: true,
    attachmentsSupported: true,
  };
  const FALLBACK: EngineAction = { type: "SEND_CONTACT_FALLBACK", reasons: [{ kind: "CONTACT_NUMBER" }] };

  test("today nothing may leave: live sending is off, and files cannot be sent", () => {
    const p = applySendPolicy([BROCHURE, FALLBACK], previewSendContext("instagram"), K);
    assert.equal(p.wouldSend, false);
    assert.ok(p.blocked.some((b) => /rule 24/.test(b)));
    assert.ok(p.verdicts[0].blocked.some((b) => /cannot send files/.test(b)));
  });

  test("each of the owner's switches blocks everything, with its own reason", () => {
    for (const [change, reason] of [
      [{ autoSendEnabled: false }, /switched off/],
      [{ humanLock: true }, /person is handling/],
      [{ replyWindowOpen: false }, /24-hour/],
    ] as const) {
      const p = applySendPolicy([FALLBACK], { ...LIVE, ...change }, K);
      assert.equal(p.wouldSend, false);
      assert.ok(p.blocked.some((b) => reason.test(b)));
    }
  });

  test("with everything on, a text answer could go", () => {
    assert.equal(applySendPolicy([FALLBACK], LIVE, K).wouldSend, true);
  });

  test("a file too big, or the wrong format, for the channel blocks the whole plan", () => {
    const passion: EngineAction = { ...BROCHURE, model: "PASSION", asset: { name: "passion.pdf", bytes: 71_628_445 } };
    const onInstagram = applySendPolicy([passion, FALLBACK], LIVE, K);
    assert.equal(onInstagram.wouldSend, false);
    assert.match(onInstagram.verdicts[0].blocked[0], /Instagram: 71\.6 MB is over the 25\.0 MB limit/);

    const mov: EngineAction = {
      type: "SEND_COLOUR_VIDEO",
      model: "TAISHAN",
      colour: "black",
      colourName: "Black",
      asset: { name: "clip.mov", bytes: 10_000_000 },
      chosenForThem: false,
      onlyOption: false,
    };
    const onWhatsApp = applySendPolicy([mov], { ...LIVE, channel: "whatsapp" }, K);
    assert.match(onWhatsApp.verdicts[0].blocked[0], /WhatsApp: \.mov video is not accepted/);
  });

  test("a fact that is not approved as sent is blocked, whatever the engine said", () => {
    const forged: EngineAction = {
      type: "SEND_FACTS",
      scope: "one",
      rows: [{ model: "COURAGE", fact: "RANGE", value: "470 km", confirmed: true }],
    };
    const p = applySendPolicy([forged], LIVE, K);
    assert.equal(p.wouldSend, false, "470 km is not the workbook's value");
    assert.match(p.verdicts[0].blocked[0], /no longer approved/);
    // The workbook's 440 km is HELD (pending Samer's confirmation), so even that figure is blocked.
    const held: EngineAction = {
      type: "SEND_FACTS",
      scope: "one",
      rows: [{ model: "COURAGE", fact: "RANGE", value: "440 km WLTP", confirmed: true }],
    };
    assert.equal(applySendPolicy([held], LIVE, K).wouldSend, false, "a held fact never goes, whatever the engine said");
    const real: EngineAction = {
      type: "SEND_FACTS",
      scope: "one",
      rows: [{ model: "COURAGE", fact: "HORSEPOWER", value: "320 kW / 435 PS", confirmed: true }],
    };
    assert.equal(applySendPolicy([real], LIVE, K).wouldSend, true, "the workbook's own confirmed value may go");
  });
});

describe("finalizeActions", () => {
  test("orders, merges the number, and drops colour choices once a video goes", () => {
    const out = finalizeActions([
      { type: "SHOW_COLOUR_CHOICES", model: "COURAGE", colours: [] },
      { type: "SEND_CONTACT_FALLBACK", reasons: [{ kind: "CONTACT_NUMBER" }] },
      {
        type: "SEND_COLOUR_VIDEO",
        model: "COURAGE",
        colour: "black",
        colourName: "Black",
        asset: { name: "b.mp4", bytes: 1 },
        chosenForThem: false,
        onlyOption: false,
      },
      { type: "SEND_CONTACT_FALLBACK", reasons: [{ kind: "CONTACT_NUMBER" }, { kind: "MORE_INFO", model: "COURAGE" }] },
      BROCHURE,
      BROCHURE,
    ]);
    assert.deepEqual(out.map((a) => a.type), ["SEND_BROCHURE", "SEND_COLOUR_VIDEO", "SEND_CONTACT_FALLBACK"]);
    const f = out[2];
    assert.equal(f.type === "SEND_CONTACT_FALLBACK" && f.reasons.length, 2);
  });
});
