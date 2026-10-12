import type { Metadata } from "next";
import { requireInsightsAccess } from "@/lib/auth-server";
import { readPipeline } from "@/lib/insights/pipeline-server";
import { HEALTH_LABEL, HEALTH_TONE, type AccountHealth, type HealthState } from "@/lib/insights/pipeline";
import { longDate } from "@/lib/format";
import NotAllowed from "../NotAllowed";
import { InsightsNav } from "../parts";
import PipelineActions from "./PipelineActions";
import "../../board.css";
import "../insights.css";

export const metadata: Metadata = { title: "Connections & imports — Monza AI Insights" };
export const dynamic = "force-dynamic";

/**
 * /insights/connections — every connected account: are new messages arriving, has the past been read, is
 * what arrives being read into labels — each answered separately, with the counts behind it and the
 * actions that move it on. A count that could not be read says so; it is never shown as zero.
 */

const CHANNEL: Readonly<Record<string, string>> = { whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Messenger" };
const BRAND: Readonly<Record<string, string>> = { voyah: "VOYAH", mhero: "MHERO", monza: "Monza S.A.L." };

function when(iso: string | null): string {
  if (!iso) return "never";
  return `${longDate(iso.slice(0, 10))} ${new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Beirut" })}`;
}

function Status({ title, s }: { title: string; s: { state: HealthState; detail: string } }) {
  return (
    <div className="ins-health">
      <span className="ins-health-dot" data-tone={HEALTH_TONE[s.state]} aria-hidden="true" />
      <div>
        <p className="ins-health-title">
          {title}: <strong>{HEALTH_LABEL[s.state]}</strong>
        </p>
        <p className="ins-known">{s.detail}</p>
      </div>
    </div>
  );
}

function Account({ a }: { a: AccountHealth }) {
  const c = a.counts;
  return (
    <li className="ins-car">
      <div className="ins-car-head">
        <div>
          <h3 className="ins-car-name">
            {CHANNEL[a.channel] ?? a.channel} · {BRAND[a.brand] ?? a.brand}
          </h3>
          <p className="ins-car-sub">
            {a.label} · id {a.externalId}
          </p>
        </div>
      </div>
      <Status title="New messages" s={a.live} />
      <Status title="History" s={a.history} />
      <Status title="Labels" s={a.labels} />
      {c ? (
        <dl className="ins-car-stats ins-pipe-stats">
          <div><dt>Chats stored</dt><dd>{c.conversations}</dd></div>
          <div><dt>Customer msgs</dt><dd>{c.customerMessages}</dd></div>
          <div><dt>Labelled</dt><dd>{c.labelled}</dd></div>
          <div><dt>Facts</dt><dd>{c.facts}</dd></div>
          <div><dt>Waiting</dt><dd className={c.unlabelledSinceRebuild > 0 ? "is-hot" : ""}>{c.unlabelledSinceRebuild}</dd></div>
        </dl>
      ) : (
        <p className="board-note board-warn">The counts for this account could not be read.</p>
      )}
      {c && (
        <p className="ins-known">
          Last customer message {when(c.lastCustomerMessage)} · last labelled {when(c.lastLabelled)} · {c.unlabelledBefore} left out by the engine · {c.testMessages} from the test
          phones (never counted)
          {a.run && a.run.updatedAt ? ` · history last run ${when(a.run.updatedAt)}` : ""}
        </p>
      )}
      <p className="ins-known">
        <span className="cap">History available</span> {a.historySupport}
      </p>
      <p className="ins-known">
        <span className="cap">Permissions needed</span> {a.permissions}
      </p>
      <PipelineActions accountId={a.id} channel={a.channel} runState={a.run?.state ?? null} />
    </li>
  );
}

export default async function ConnectionsPage() {
  const access = await requireInsightsAccess("/insights/connections");
  if (!access.allowed) return <NotAllowed />;
  const read = await readPipeline();
  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">Insights · Connections &amp; imports</p>
        <h1 className="h1">Where the data comes from</h1>
        <p className="lede">
          For every account: are new messages arriving, has the past been read, and is everything that arrives being read. Keys are checked on the
          server and never shown. Read {read.state === "ok" ? when(read.readAt) : "—"}.
        </p>
      </header>
      <InsightsNav current="/insights/connections" />
      {read.state === "unavailable" ? (
        <p className="board-note board-warn">{read.reason} Nothing here is shown as zero.</p>
      ) : (
        <ul className="ins-cars">
          {read.accounts.map((a) => (
            <Account key={a.id} a={a} />
          ))}
        </ul>
      )}
    </div>
  );
}
