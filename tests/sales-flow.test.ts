/**
 * The runner (lib/wasales/flow.ts): one inbound message through the engine,
 * the templates and the send policy — exactly what the simulator shows and a
 * webhook handler would call.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { previewSendContext, runConversation, runTurn } from "@/lib/wasales/flow";
import { decide, type EngineInput } from "@/lib/wasales/engine";
import { freshState } from "@/lib/wasales/context";
import { MONZA_KNOWLEDGE, type SalesKnowledge } from "@/lib/wasales/knowledge";
import { folderMedia, loadCatalog } from "@/lib/wasales/catalog";
import { planLines } from "@/lib/wasales/templates";

const CATALOG = loadCatalog();

/** The real catalogue and files, with obviously fake approved facts. */
const K: SalesKnowledge = {
  ...MONZA_KNOWLEDGE,
  models: MONZA_KNOWLEDGE.models.map((m) =>
    m.code === "COURAGE"
      ? {
          ...m,
          facts: {
            HORSEPOWER: { value: "TEST-HP-COURAGE", approved: true, source: "test" },
            RANGE: { value: "TEST-RANGE-COURAGE", approved: true, source: "test" },
          },
        }
      : m.code === "PASSION_L"
        ? { ...m, facts: { RANGE: { value: "TEST-RANGE-PASSION-L", approved: true, source: "test" } } }
        : m
  ),
};

const DEPS = { knowledge: K, catalog: CATALOG, media: folderMedia, ttlHours: 72 };

function inputs(msgs: (string | Partial<EngineInput>)[], brand = "voyah"): EngineInput[] {
  return msgs.map((m, i) => ({
    text: "",
    brand,
    conversationIsNew: i === 0,
    now: new Date(Date.UTC(2026, 8, 14, 9, i)).toISOString(),
    ...(typeof m === "string" ? { text: m } : m),
  }));
}

describe("the definition of done, as a customer on Instagram would receive it", () => {
  const { turns } = runConversation(
    inputs(["hp?", { payload: "MODEL:COURAGE" }, "BLACK", "range?", "what about Passion L?", "what's the range?"]),
    DEPS,
    previewSendContext("instagram")
  );
  const said = turns.map((t) => planLines(t.plan));

  test("each step, word for word", () => {
    assert.deepEqual(said[0], [
      "Which model are you interested in? [quick_replies: Voyah Free 318 | Voyah Courage | Voyah Dream | Voyah Passion | Voyah Passion L | Voyah Taishan]",
    ]);
    assert.deepEqual(said[1], [
      "Here is the Voyah Courage brochure.",
      "[PDF: Voyah courage 2026 catalogue.pdf]",
      "Horsepower of the Voyah Courage: TEST-HP-COURAGE.",
      "Which colour would you like to see? We can show you the Voyah Courage in Black, Grey or White. [quick_replies: Black | Grey | White]",
    ]);
    assert.equal(said[2][0], "Here is the Voyah Courage in Black.");
    assert.match(said[2][1], /^\[Video: All Black Voyah Courage/);
    assert.deepEqual(said[3], ["Range of the Voyah Courage: TEST-RANGE-COURAGE."]);
    assert.deepEqual(said[4], [
      "Here is the Voyah Passion L brochure.",
      "[PDF: VOYAH PASSION L Catalogue 2026.pdf]",
      "Which colour would you like to see? We can show you the Voyah Passion L in Black or Grey. [quick_replies: Black | Grey]",
    ]);
    assert.deepEqual(said[5], ["Range of the Voyah Passion L: TEST-RANGE-PASSION-L."]);
  });

  test("and none of it is sent: live sending is off", () => {
    for (const t of turns) {
      assert.equal(t.policy.wouldSend, false);
      assert.ok(t.policy.blocked.some((b) => /rule 24/.test(b)));
    }
  });
});

describe("runConversation", () => {
  test("threads the state exactly as decide() would", () => {
    const msgs = inputs(["hi", "2", "grey", "range?"]);
    const { turns, state } = runConversation(msgs, DEPS, previewSendContext("whatsapp"));
    let s = freshState();
    msgs.forEach((input, i) => {
      const d = decide(input, s, DEPS);
      assert.deepEqual(turns[i].decision, d);
      s = d.nextState;
    });
    assert.deepEqual(state, s);
  });
});

describe("the log line", () => {
  test("carries what was decided and nothing the customer wrote", () => {
    const secret = "my number is 03123456 and my name is Rami Haddad, courage price?";
    const t = runTurn(inputs([secret])[0], freshState(), DEPS, previewSendContext("instagram"));
    const line = JSON.stringify(t.trace);
    for (const leak of ["03123456", "Rami", "Haddad", "my number"]) {
      assert.ok(!line.includes(leak), leak);
    }
    assert.equal(t.trace.model, "COURAGE");
    // "my number is …" is not a request for OUR number: "number" is a weak
    // word, and yields to the price question beside it.
    assert.deepEqual(t.trace.intents, ["PRICE"]);
    assert.equal(t.trace.wouldSend, false);
  });

  test("names an exclusion by kind, never by content", () => {
    const t = runTurn(
      inputs(["Meta Business Support: your page will be disabled https://example.com/x"])[0],
      freshState(),
      DEPS,
      previewSendContext("facebook")
    );
    assert.equal(t.trace.outcome, "EXCLUDED");
    assert.equal(t.trace.exclusion, "META_SCAM");
    assert.ok(!JSON.stringify(t.trace).includes("example.com"));
  });
});

describe("an account with no known brand", () => {
  test("renders nothing and sends nothing", () => {
    const t = runTurn(inputs(["courage"], "kia")[0], freshState(), DEPS, previewSendContext("instagram"));
    assert.deepEqual(t.plan, []);
    assert.equal(t.decision.outcome, "NO_AUTOMATIC_ACTION");
  });
});
