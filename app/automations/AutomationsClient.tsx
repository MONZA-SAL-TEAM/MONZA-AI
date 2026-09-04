"use client";

/**
 * The Automations screen.
 *
 * Each card is one automation, with the thing that matters most in the biggest
 * type: how many customers it would act on RIGHT NOW, computed by the real
 * engine on the server. Expanding a card shows the actual messages, word for
 * word, before anybody switches anything on.
 *
 * The switch is deliberately not wired yet. Enabling an automation is a promise
 * to send real messages to real people, and that promise cannot be kept until
 * an outbound channel exists — so the control says so instead of pretending.
 * A toggle that silently does nothing is worse than no toggle.
 */

import { useState } from "react";
import Link from "next/link";
import {
  ACTION_LABEL,
  TRIGGER_LABEL,
  type ActionKind,
  type TriggerKind,
} from "@/lib/automations/types";
import { longDate } from "@/lib/format";
import "../board.css";

export interface AutomationView {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  triggerKind: TriggerKind;
  actionKinds: ActionKind[];
  /** How many customers this would act on today, per the real engine. */
  wouldActNow: number;
  examples: {
    customerName: string;
    actionKind: ActionKind;
    text: string;
  }[];
}

interface Props {
  demo: boolean;
  sourceLabel: string;
  today: string;
  eventCount: number;
  automations: AutomationView[];
}

export default function AutomationsClient({
  demo,
  sourceLabel,
  today,
  eventCount,
  automations,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  const totalWould = automations.reduce((n, a) => n + a.wouldActNow, 0);
  const anyEnabled = automations.some((a) => a.enabled);

  return (
    <main className="board">
      <header className="board-head">
        <div className="eyebrow">Communication</div>
        <h1 className="h1">Automations</h1>
        <p className="lede">
          When something happens, say the right thing — every time, without
          anybody remembering to.
        </p>
      </header>

      <p className={`board-note${anyEnabled ? "" : " board-warn"}`}>
        {anyEnabled
          ? "Some automations are switched on."
          : "Every automation is switched OFF. Nothing is being sent to anybody."}{" "}
        Turning one on will need a connected outbound channel first — until then
        the numbers below are a preview, not activity.
      </p>

      <div className="tiles">
        <div className="tile">
          <p className="tile-label">Automations</p>
          <p className="tile-value">{automations.length}</p>
          <p className="tile-foot">
            {automations.filter((a) => a.enabled).length} switched on
          </p>
        </div>
        <div className="tile">
          <p className="tile-label">Things that happened</p>
          <p className="tile-value">{eventCount}</p>
          <p className="tile-foot">Read from {sourceLabel.toLowerCase()}</p>
        </div>
        <div className="tile">
          <p className="tile-label">Would act now</p>
          <p className="tile-value">{totalWould}</p>
          <p className="tile-foot">If everything were switched on</p>
        </div>
        <div className="tile">
          <p className="tile-label">As of</p>
          <p className="tile-value" style={{ fontSize: "var(--t-lg)" }}>
            {longDate(today)}
          </p>
          <p className="tile-foot">{demo ? "Example data" : "Live"}</p>
        </div>
      </div>

      <ul className="rows">
        {automations.map((a) => {
          const isOpen = openId === a.id;
          return (
            <li className="rowcard" key={a.id}>
              <div className="rowcard-top">
                <div className="grow">
                  <p className="rowcard-name">{a.name}</p>
                  <p className="rowcard-sub">{a.description}</p>
                </div>
                <div className="rowcard-tags">
                  <span className={`tag${a.enabled ? " live" : ""}`}>
                    {a.enabled ? "On" : "Off"}
                  </span>
                  {a.wouldActNow > 0 && (
                    <span className="tag mine">
                      {a.wouldActNow} would act now
                    </span>
                  )}
                </div>
              </div>

              <p className="cap">
                When: {TRIGGER_LABEL[a.triggerKind]} · Then:{" "}
                {a.actionKinds.map((k) => ACTION_LABEL[k]).join(", ")}
              </p>

              {isOpen && (
                <div className="stack">
                  {a.examples.length === 0 ? (
                    <p className="cap">
                      Nothing matches this automation today, so it would do
                      nothing.
                    </p>
                  ) : (
                    a.examples.map((e, i) => (
                      <div key={`${a.id}-${i}`}>
                        <p className="cap">
                          {ACTION_LABEL[e.actionKind]} — {e.customerName}
                        </p>
                        <p className="preview">{e.text}</p>
                      </div>
                    ))
                  )}
                  {a.wouldActNow > a.examples.length && (
                    <p className="cap">
                      …and {a.wouldActNow - a.examples.length} more like this.
                    </p>
                  )}
                </div>
              )}

              <div className="rowcard-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setOpenId(isOpen ? null : a.id)}
                >
                  {isOpen ? "Hide the messages" : "Show the messages"}
                </button>
                <button type="button" className="btn quiet" disabled>
                  Switch on — needs a connected channel
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="section-head">
        <h2 className="h2">How this stays safe</h2>
      </div>
      <ul className="rows">
        <li className="rowcard">
          <p className="rowcard-sub">
            <strong>Nobody is messaged twice.</strong> Every action is keyed to
            the thing that happened — this installment, this job — never to the
            time it was noticed. Re-running the whole thing an hour later
            recognises what was already done and sends nothing.
          </p>
        </li>
        <li className="rowcard">
          <p className="rowcard-sub">
            <strong>A late payment is chased once, not daily.</strong> After
            that the automation stops and hands it to a person.
          </p>
        </li>
        <li className="rowcard">
          <p className="rowcard-sub">
            <strong>Only known messages go out.</strong> An automation chooses
            from a fixed set of templates. It cannot compose its own text, and
            no AI writes to a customer through this path.
          </p>
        </li>
        <li className="rowcard">
          <p className="rowcard-sub">
            <strong>Everything is written down.</strong> Every attempt — sent,
            failed or skipped — is recorded, and a failure that keeps failing is
            surfaced for somebody to look at rather than retried forever.
          </p>
        </li>
      </ul>

      <p className="cap">
        Connect a channel on the{" "}
        <Link href="/integrations">integrations</Link> screen.
      </p>
    </main>
  );
}
