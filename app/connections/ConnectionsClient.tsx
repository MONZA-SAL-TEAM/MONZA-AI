"use client";

import { useEffect, useState } from "react";

interface ApiConnection {
  key: string;
  label: string;
  description: string;
  connected: boolean;
  detail: string;
  source?: string;
  tools?: string[];
}

interface ApiResponse {
  demo: boolean;
  connectors: ApiConnection[];
  comingLater: string[];
  signIn?: string;
  checkedAt?: string;
}

export default function ConnectionsClient() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    // A hung request must become an error, never an eternal spinner.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 8000);
    fetch("/api/connections", { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<ApiResponse>;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [attempt]);

  if (failed) {
    return (
      <div className="note urgent">
        We couldn&apos;t check the connections just now.{" "}
        <button
          type="button"
          className="tag"
          style={{ cursor: "pointer" }}
          onClick={() => setAttempt((a) => a + 1)}
        >
          Try again
        </button>
      </div>
    );
  }

  if (!data) {
    return <div className="note">Checking each connection…</div>;
  }

  return (
    <div className="stack-lg">
      {data.demo && (
        <div className="note">
          Demo mode — nothing is connected yet, so the assistant answers with
          clearly-labelled sample data. As each system is connected, its card
          below turns green and answers switch to the real thing.
        </div>
      )}

      <div className="stack">
        {data.connectors.map((c) => (
          <div key={c.key} className="card pad">
            <div className="row-between">
              <div className="grow">
                <div className="row" style={{ gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{c.label}</span>
                  {c.connected ? (
                    <span className="tag live">
                      <span className="dot" />
                      Connected
                    </span>
                  ) : (
                    <span className="tag">Not connected</span>
                  )}
                </div>
                <div className="cap" style={{ marginTop: 4 }}>
                  {c.description}
                </div>
              </div>
            </div>
            <div className="cap" style={{ marginTop: 10 }}>
              <span style={{ color: "var(--ink-3)" }}>Source: </span>
              {c.source ?? "Not set"}
            </div>
            {c.tools && c.tools.length > 0 && (
              <div className="cap" style={{ marginTop: 4 }}>
                <span style={{ color: "var(--ink-3)" }}>Can answer about: </span>
                {c.tools.join(" · ")}
              </div>
            )}
            <div
              className="cap"
              style={{ marginTop: 10, color: "var(--ink-3)" }}
            >
              {c.detail}
            </div>
          </div>
        ))}
      </div>

      {(data.signIn || data.checkedAt) && (
        <p className="cap" style={{ margin: 0, color: "var(--ink-3)" }}>
          {data.signIn}
          {data.checkedAt &&
            ` Last checked ${new Date(data.checkedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}.`}
        </p>
      )}

      <div className="card pad">
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          Coming later
        </div>
        <p className="cap" style={{ margin: 0 }}>
          {data.comingLater.join(" · ")} — planned, not wired up yet. When they
          arrive they&apos;ll simply appear on this list like the others,
          nothing for you to do.
        </p>
      </div>
    </div>
  );
}
