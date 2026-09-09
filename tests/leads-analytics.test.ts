/**
 * The dashboard's numbers.
 *
 * ── Why this file exists in the shape it does ───────────────────────────────
 *
 * The first version of readDashboard() mapped a FAILED read and an EMPTY read
 * to the same value, and the page rendered both as "Nobody has messaged yet".
 * A dashboard that reports a quiet month while it is actually blind is the
 * worst failure available to this product — somebody decides where to spend
 * money with it — and it got past review because the two cases looked
 * identical in the type.
 *
 * So the first test below is the one that matters, and the rest of the file
 * checks that the counting is honest in the same way: unknowns stay visible,
 * withheld figures stay null rather than becoming zero, and the slices always
 * account for every lead.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { readDashboard } from "@/lib/leads/analytics";
import type { ExecutionContext } from "@/lib/connectors/types";

/* ── A Supabase stand-in ─────────────────────────────────────────────────── */

type TableData = Record<string, { rows: unknown[]; error?: { message: string } }>;

/**
 * The smallest thing that behaves like the query builder: every chained method
 * returns itself, and awaiting it yields the table's rows. Enough to exercise
 * the real function without a network, which is the whole point — the logic
 * under test is the aggregation, not PostgREST.
 */
function fakeDb(tables: TableData) {
  return {
    from(table: string) {
      const result = tables[table] ?? { rows: [] };
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const m of ["select", "order", "limit", "in", "eq", "is", "gte"]) {
        builder[m] = chain;
      }
      builder.then = (resolve: (v: unknown) => unknown) =>
        resolve(
          result.error
            ? { data: null, error: result.error }
            : { data: result.rows, error: null, count: result.rows.length }
        );
      return builder;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** The reviewable no-credentials identity: isDemo() is true, so no CRM is hit. */
const DEMO_CTX: ExecutionContext = {
  user: {
    userId: "u-demo",
    email: null,
    crmAccessToken: "demo",
    appRole: "owner",
    capabilities: [],
  },
  conversationId: null,
  turnId: "t-1",
};

function lead(over: Record<string, unknown> = {}) {
  return {
    id: "l-1",
    display_name: "Karim",
    phone: null,
    crm_customer_id: null,
    crm_link_method: null,
    first_seen_at: "2026-09-01T10:00:00Z",
    last_seen_at: "2026-09-08T10:00:00Z",
    ...over,
  };
}

function touch(over: Record<string, unknown> = {}) {
  return {
    lead_id: "l-1",
    brand: "voyah",
    channel: "instagram",
    source_kind: "ad_click",
    headline: "VOYAH Free",
    vehicle_context: "VOYAH Free",
    occurred_at: "2026-09-01T10:00:00Z",
    ...over,
  };
}

/* ── The distinction that got missed once ────────────────────────────────── */

describe("a failed read is never reported as an empty one", () => {
  test("a database error says UNAVAILABLE, not 'nobody has messaged'", async () => {
    const db = fakeDb({ leads: { rows: [], error: { message: "Invalid API key" } } });
    const data = await readDashboard(db, DEMO_CTX);

    assert.equal(data.state, "unavailable");
    assert.ok(data.caveats.length > 0, "it must say why");
    // And the wording must not imply an answer it does not have.
    const text = data.caveats.join(" ").toLowerCase();
    assert.ok(
      text.includes("could not be read") || text.includes("missing"),
      "the caveat must name the failure"
    );
  });

  test("a successful read of nothing says NOTHING_YET", async () => {
    const data = await readDashboard(fakeDb({ leads: { rows: [] } }), DEMO_CTX);
    assert.equal(data.state, "nothing_yet");
    assert.equal(data.caveats.length, 0, "nothing failed, so nothing to excuse");
  });

  test("the two states are genuinely different values", async () => {
    const failed = await readDashboard(
      fakeDb({ leads: { rows: [], error: { message: "boom" } } }),
      DEMO_CTX
    );
    const quiet = await readDashboard(fakeDb({ leads: { rows: [] } }), DEMO_CTX);
    assert.notEqual(
      failed.state,
      quiet.state,
      "if these ever collapse again, the dashboard starts lying"
    );
  });
});

/* ── Counting ────────────────────────────────────────────────────────────── */

describe("the counting is honest", () => {
  const db = () =>
    fakeDb({
      leads: {
        rows: [
          lead({ id: "l-1", crm_customer_id: "c-1", crm_link_method: "phone_exact", phone: "96170111111" }),
          lead({ id: "l-2", display_name: "rana.saad" }),
          lead({ id: "l-3", display_name: "Wassim" }),
          lead({ id: "l-4", crm_customer_id: "c-2", crm_link_method: "human_confirmed" }),
        ],
      },
      lead_touchpoints: {
        rows: [
          touch({ lead_id: "l-1", source_kind: "ad_click", channel: "whatsapp", brand: "voyah" }),
          touch({ lead_id: "l-2", source_kind: "social_post", channel: "instagram", brand: "voyah" }),
          touch({ lead_id: "l-3", source_kind: "direct", channel: "instagram", brand: "mhero" }),
          // l-4 deliberately has NO touchpoint.
        ],
      },
      lead_interests: {
        rows: [
          { lead_id: "l-1", car_key: "mhero-1", last_mentioned_at: "2026-09-08T10:00:00Z" },
          { lead_id: "l-2", car_key: "mhero-1", last_mentioned_at: "2026-09-07T10:00:00Z" },
          { lead_id: "l-3", car_key: "voyah-taishan", last_mentioned_at: "2026-09-06T10:00:00Z" },
        ],
      },
      lead_match_suggestions: { rows: [{ lead_id: "l-2" }, { lead_id: "l-3" }] },
    });

  test("the funnel counts what it says it counts", async () => {
    const d = await readDashboard(db(), DEMO_CTX);
    assert.equal(d.state, "ok");
    assert.equal(d.funnel.leads, 4);
    assert.equal(d.funnel.identified, 2);
    assert.equal(d.funnel.identifiedByPhone, 1, "only the phone match is automatic");
    assert.equal(d.funnel.awaitingReview, 2);
    assert.equal(d.funnel.withInterest, 3);
  });

  test("a lead with NO touchpoint is still counted, as untracked", async () => {
    // Silently dropping it would make the slices add to less than the total
    // and nobody would notice the gap.
    const d = await readDashboard(db(), DEMO_CTX);
    const total = d.bySource.reduce((n, s) => n + s.count, 0);
    assert.equal(total, d.funnel.leads, "every lead must appear in some slice");

    const untracked = d.bySource.find((s) => s.key === "direct");
    assert.ok(untracked, "the untracked slice must exist");
    assert.equal(untracked?.count, 2, "the direct lead AND the one with no touchpoint");
  });

  test("'Not tracked' is never dressed up as a marketing channel", async () => {
    const d = await readDashboard(db(), DEMO_CTX);
    const untracked = d.bySource.find((s) => s.key === "direct");
    assert.equal(untracked?.label, "Not tracked");
    assert.equal(untracked?.certain, false, "it must not be presented as a fact");

    for (const s of d.bySource) {
      const l = s.label.toLowerCase();
      assert.ok(!l.includes("organic"), "no slice may claim 'organic'");
      assert.ok(!l.includes("word of mouth"), "no slice may claim 'word of mouth'");
    }
  });

  test("platform-reported sources ARE marked certain", async () => {
    const d = await readDashboard(db(), DEMO_CTX);
    assert.equal(d.bySource.find((s) => s.key === "ad_click")?.certain, true);
    assert.equal(d.bySource.find((s) => s.key === "social_post")?.certain, true);
  });

  test("a withheld CRM figure is null, never zero", async () => {
    // Demo identity: there is no CRM to read. "Sold nothing" and "cannot look"
    // must not render as the same number.
    const d = await readDashboard(db(), DEMO_CTX);
    assert.equal(d.funnel.carsSold, null);
    assert.ok(d.caveats.length > 0, "and it must say why the figure is missing");
  });

  test("interests are counted per mention, and named in staff words", async () => {
    const d = await readDashboard(db(), DEMO_CTX);
    const top = d.topInterests[0];
    assert.equal(top.count, 2, "two people asked about the same car");
    assert.ok(
      /mhero/i.test(top.label),
      `the catalogue name should be shown, got "${top.label}"`
    );
    assert.ok(!top.label.includes("-"), "a raw key like 'mhero-1' must not reach the screen");
  });

  test("the first touch is the one reported, not the latest", async () => {
    const d = await readDashboard(
      fakeDb({
        leads: { rows: [lead({ id: "l-1" })] },
        lead_touchpoints: {
          rows: [
            touch({ lead_id: "l-1", source_kind: "ad_click", occurred_at: "2026-09-01T00:00:00Z" }),
            touch({ lead_id: "l-1", source_kind: "direct", occurred_at: "2026-09-09T00:00:00Z" }),
          ],
        },
        lead_interests: { rows: [] },
        lead_match_suggestions: { rows: [] },
      }),
      DEMO_CTX
    );
    // "Where did this customer come from" is answered by the FIRST arrival.
    assert.equal(d.bySource[0].key, "ad_click");
    assert.equal(d.recent[0].source, "ad_click");
  });

  test("an unidentified person is shown as unidentified, not invented", async () => {
    const d = await readDashboard(db(), DEMO_CTX);
    const anon = d.recent.find((r) => r.id === "l-3");
    assert.equal(anon?.identified, false);
    assert.equal(anon?.crmCustomerName, null, "no name is better than a guessed one");
  });
});
