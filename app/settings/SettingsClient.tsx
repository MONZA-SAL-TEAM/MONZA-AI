"use client";

import { useState } from "react";

export interface SettingsView {
  demo: boolean;
  /** Plain words, never a raw model identifier. */
  modelLabel: string;
  maxToolCalls: string;
  assistantOn: boolean;
  env: { name: string; purpose: string; set: boolean }[];
  envTemplate: string;
}

export default function SettingsClient({ view }: { view: SettingsView }) {
  const [copied, setCopied] = useState(false);

  async function copyTemplate() {
    try {
      await navigator.clipboard.writeText(view.envTemplate);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the block below is selectable by hand.
    }
  }

  const allEnvSet = view.env.every((e) => e.set);

  return (
    <div className="stack-lg">
      {view.demo && (
        <div className="note">
          Demo mode — nothing is configured yet, so what you see below are
          simply the defaults the assistant ships with.
        </div>
      )}

      {/* The one paragraph that matters */}
      <div className="card pad">
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          Who sees what
        </div>
        <p style={{ margin: 0 }}>
          The short version: a customer can only ever see{" "}
          <strong>their own</strong> records — their car, their payment plan,
          their garage jobs — plus public information like our models and the
          showroom. Every question runs with the signed-in account&apos;s own
          access, the administrator can switch individual abilities off, and
          every single lookup is recorded.
        </p>
        <p className="cap" style={{ marginTop: 8 }}>
          The assistant&apos;s own database holds only conversations,
          permissions and the activity record. It never holds customers,
          vehicles, payments, garage jobs or any business records — those stay
          in the Monza systems, and the assistant asks them fresh every time.
        </p>
      </div>

      {/* Current configuration, plain words */}
      <div className="card">
        <div className="pad" style={{ borderBottom: "1px solid var(--line-soft)" }}>
          <div className="row-between">
            <div>
              <div style={{ fontWeight: 600 }}>Assistant</div>
              <div className="cap">The whole assistant can be paused at once.</div>
            </div>
            {view.assistantOn ? (
              <span className="tag live">
                <span className="dot" />
                On
              </span>
            ) : (
              <span className="tag urgent">Paused</span>
            )}
          </div>
        </div>
        <div className="pad" style={{ borderBottom: "1px solid var(--line-soft)" }}>
          <div className="row-between">
            <div>
              <div style={{ fontWeight: 600 }}>Assistant model</div>
              <div className="cap">Which brain answers customer questions.</div>
            </div>
            <span className="tag">{view.modelLabel}</span>
          </div>
        </div>
        <div className="pad">
          <div className="row-between">
            <div>
              <div style={{ fontWeight: 600 }}>Lookups per question</div>
              <div className="cap">
                One question may check the systems at most this many times.
              </div>
            </div>
            <span className="tag">Up to {view.maxToolCalls}</span>
          </div>
        </div>
      </div>

      {/* Environment checklist — presence only, never values */}
      <div className="card pad">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 600 }}>Setup checklist</div>
            <div className="cap">
              What the server has been given so far — only whether each piece
              is in place, never the value itself.
            </div>
          </div>
          {allEnvSet ? (
            <span className="tag live">
              <span className="dot" />
              Complete
            </span>
          ) : (
            <span className="tag">Incomplete</span>
          )}
        </div>

        <div className="stack" style={{ gap: 10 }}>
          {view.env.map((e) => (
            <div key={e.name} className="row-between">
              <div className="grow">
                <div
                  className="cap"
                  style={{
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                    color: "var(--ink)",
                  }}
                >
                  {e.name}
                </div>
                <div className="cap" style={{ color: "var(--ink-3)" }}>
                  {e.purpose}
                </div>
              </div>
              {e.set ? (
                <span className="tag live">Set</span>
              ) : (
                <span className="tag">Missing</span>
              )}
            </div>
          ))}
        </div>

        <hr className="rule" style={{ margin: "16px 0" }} />

        <div className="row-between" style={{ marginBottom: 8 }}>
          <div className="cap">
            Paste this into <code>.env.local</code> and fill in the values:
          </div>
          <button type="button" className="btn quiet" onClick={copyTemplate}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre
          style={{
            margin: 0,
            padding: "12px 14px",
            background: "var(--sunk)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-sm)",
            fontSize: "var(--t-sm)",
            overflowX: "auto",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          }}
        >
          {view.envTemplate}
        </pre>
      </div>
    </div>
  );
}
