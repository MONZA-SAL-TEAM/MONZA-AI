"use client";

import { useEffect, useState } from "react";

interface ApiConnection {
  key: string;
  label: string;
  description: string;
  connected: boolean;
  detail: string;
}

interface ApiResponse {
  demo: boolean;
  connectors: ApiConnection[];
  comingLater: string[];
}

export default function ConnectionsClient() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/connections")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<ApiResponse>;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <div className="note urgent">
        We couldn&apos;t check the connections just now. Refresh the page to
        try again.
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
            <div
              className="cap"
              style={{ marginTop: 10, color: "var(--ink-3)" }}
            >
              {c.detail}
            </div>
          </div>
        ))}
      </div>

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
