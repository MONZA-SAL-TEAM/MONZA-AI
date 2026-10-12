import type { Metadata } from "next";
import Link from "next/link";
import { requireInsightsAccess } from "@/lib/auth-server";
import { channelDb } from "@/lib/channels/store";
import { encodeThreadId } from "@/lib/channels/live-map";
import { carName, factLabel } from "@/lib/insights/facts";
import { latestOverrides, overrideKey, reviewReason, REVIEW_LABEL, type Override, type ReviewReason } from "@/lib/insights/review";
import type { ObservationRow } from "@/lib/insights/insights";
import { MODEL_CODES } from "@/lib/wasales/knowledge";
import { COLOUR_FAMILIES } from "@/lib/wasales/observe-lexicon";
import { longDate } from "@/lib/format";
import NotAllowed from "../NotAllowed";
import { InsightsNav } from "../parts";
import ReviewActions from "./ReviewActions";
import "../../board.css";
import "../insights.css";

export const metadata: Metadata = { title: "Review — Monza AI Insights" };
export const dynamic = "force-dynamic";

/**
 * /insights/review — the facts the reader was least sure of, for a person to confirm, correct or remove.
 * Open the chat to read it; decide here. Every decision is kept with who and when (insight_overrides) and
 * applies to every page at once — the reading itself is never rewritten.
 */

const REASONS = Object.keys(REVIEW_LABEL) as ReviewReason[];

export default async function ReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireInsightsAccess("/insights/review");
  if (!access.allowed) return <NotAllowed />;
  const sp = await searchParams;
  const reason = typeof sp.reason === "string" && (REASONS as string[]).includes(sp.reason) ? (sp.reason as ReviewReason) : null;
  const sb = channelDb();
  if (!sb) {
    return (
      <div className="board">
        <header className="board-head"><p className="eyebrow">Insights · Review</p><h1 className="h1">Facts to review</h1></header>
        <InsightsNav current="/insights/quality" />
        <p className="board-note board-warn">Monza AI&apos;s database could not be read here, so nothing is shown.</p>
      </div>
    );
  }
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const [facts, decisions, convs, accounts] = await Promise.all([
    sb.from("sales_observations").select("id, conversation_id, account_id, at, kind, stance, model, binding, part, value, detail, rule, external_message_id").in("kind", ["unresolved", "colour", "mention", "category"]).gte("at", since).order("at", { ascending: false }).limit(3000),
    sb.from("insight_overrides").select("account_id, external_message_id, kind, value, model, action, new_value, new_model, by_name, at").order("at", { ascending: false }).limit(5000),
    sb.from("channel_conversations").select("id, account_id, peer_display, meta_conversation_id"),
    sb.from("channel_accounts").select("id, channel"),
  ]);
  const failed = Boolean(facts.error || decisions.error);
  const decided = latestOverrides((decisions.data ?? []) as Override[]);
  const channelOf = new Map(((accounts.data ?? []) as { id: string; channel: string }[]).map((a) => [a.id, a.channel]));
  const convById = new Map(((convs.data ?? []) as { id: string; account_id: string; peer_display: string | null; meta_conversation_id: string | null }[]).map((c) => [c.id, c]));
  type Item = ObservationRow & { id: string; reason: ReviewReason };
  const all: Item[] = ((facts.data ?? []) as (ObservationRow & { id: string })[])
    .map((o) => ({ ...o, reason: reviewReason(o) }))
    .filter((o): o is Item => o.reason !== null && !decided.has(overrideKey(o)));
  const counts = new Map<ReviewReason, number>();
  for (const i of all) counts.set(i.reason, (counts.get(i.reason) ?? 0) + 1);
  const shown = all.filter((i) => !reason || i.reason === reason).slice(0, 100);
  const models = MODEL_CODES.map((c) => ({ value: c, label: carName(c) }));
  const recent = ((decisions.data ?? []) as Override[]).slice(0, 15);
  const threadOf = (convId: string) => {
    const c = convById.get(convId);
    if (!c) return null;
    if (channelOf.get(c.account_id) === "whatsapp") return encodeThreadId(c.account_id, c.id);
    return c.meta_conversation_id ? encodeThreadId(c.account_id, c.meta_conversation_id) : null;
  };

  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">Insights · Data quality · Review</p>
        <h1 className="h1">Facts to review</h1>
        <p className="lede">
          The last 90 days&apos; facts the reader was least sure of. Open the chat, then confirm, correct or remove. A decision applies to every page at
          once and is kept with who made it and when; the summaries pick it up at the next rebuild (nightly, or &quot;Rebuild the summaries now&quot; in the Lab).
        </p>
      </header>
      <InsightsNav current="/insights/quality" />
      {failed ? (
        <p className="board-note board-warn">The facts could not be read just now — this is not an empty queue.</p>
      ) : (
        <>
          <div className="chips" role="group" aria-label="Why">
            <Link className="chip" aria-pressed={!reason} href="/insights/review">
              All ({all.length})
            </Link>
            {REASONS.map((r) => (
              <Link key={r} className="chip" aria-pressed={reason === r} href={`/insights/review?reason=${r}`}>
                {REVIEW_LABEL[r]} ({counts.get(r) ?? 0})
              </Link>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="board-empty">Nothing to review here.</p>
          ) : (
            <ul className="rows">
              {shown.map((i) => {
                const thread = threadOf(i.conversation_id);
                const conv = convById.get(i.conversation_id);
                return (
                  <li key={i.id} className="rowcard">
                    <div className="rowcard-top">
                      <div>
                        <p className="rowcard-name">
                          {i.kind === "unresolved" ? `Could be the ${carName(i.model)}` : i.kind === "mention" ? `Named the ${carName(i.model)} with a misspelling` : factLabel(i)}
                        </p>
                        <p className="rowcard-sub">
                          {REVIEW_LABEL[i.reason]} · {conv?.peer_display ?? "Customer"} · {longDate(i.at.slice(0, 10))} · rule {i.rule}
                        </p>
                      </div>
                      {thread && (
                        <Link className="btn quiet" href={`/inbox?open=${encodeURIComponent(thread)}`}>
                          Open the chat
                        </Link>
                      )}
                    </div>
                    <ReviewActions id={i.id} kind={i.kind} models={models} colours={Object.keys(COLOUR_FAMILIES)} />
                  </li>
                );
              })}
            </ul>
          )}
          <section className="ins-panel">
            <h2 className="ins-h2">Latest decisions</h2>
            {recent.length === 0 ? (
              <p className="ins-empty">None yet.</p>
            ) : (
              <ul className="ins-people">
                {recent.map((d, n) => (
                  <li key={n}>
                    {d.by_name ?? "Staff"} · {d.action.replace("_", " ")} · {d.kind} {d.value}
                    {d.model ? ` (${carName(d.model)})` : ""}
                    {d.new_model ? ` → ${carName(d.new_model)}` : ""}
                    {d.new_value ? ` → ${d.new_value}` : ""} <span className="ins-known">{longDate(d.at.slice(0, 10))}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
