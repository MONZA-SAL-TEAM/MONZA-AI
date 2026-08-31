"use client";

/**
 * Sign-in against the Monza CRM project. Accounts are the CRM's own staff
 * accounts — nothing is created here. On success the access token is stored
 * in the 'monza-ai-token' cookie and passed through to every query the
 * assistant makes on the user's behalf.
 *
 * With no CRM configured this becomes the demo door: one button, no password.
 */

import { useState, type FormEvent } from "react";
import { createClient } from "@supabase/supabase-js";

const COOKIE_NAME = "monza-ai-token";

const CRM_URL = process.env.NEXT_PUBLIC_CRM_SUPABASE_URL ?? "";
const CRM_ANON = process.env.NEXT_PUBLIC_CRM_SUPABASE_ANON_KEY ?? "";
const CONFIGURED = Boolean(CRM_URL && CRM_ANON);

function storeToken(token: string, expiresIn: number | undefined) {
  const maxAge =
    typeof expiresIn === "number" && expiresIn > 0 ? expiresIn : 3600;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(
    token
  )}; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function plainWords(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "That email and password do not match a Monza CRM account. Check them and try again.";
  }
  if (m.includes("email not confirmed")) {
    return "This account's email has not been confirmed yet. Ask whoever manages your CRM account.";
  }
  if (m.includes("network") || m.includes("fetch")) {
    return "Could not reach the sign-in service. Check your connection and try again.";
  }
  return "Sign-in did not work. Check your email and password and try again.";
}

export default function LoginClient() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const crm = createClient(CRM_URL, CRM_ANON, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error: signInError } = await crm.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError || !data?.session?.access_token) {
        setError(plainWords(signInError?.message ?? ""));
        setBusy(false);
        return;
      }
      storeToken(data.session.access_token, data.session.expires_in);
      window.location.href = "/chat";
    } catch {
      setError("Something went wrong while signing in. Please try again.");
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div className="card pad-lg" style={{ width: "100%", maxWidth: 380 }}>
        <div className="stack-lg">
          <div className="stack" style={{ gap: 6 }}>
            <span className="eyebrow">Monza AI</span>
            <h1 className="h1">Sign in</h1>
            <p className="lede">
              {CONFIGURED
                ? "Sign in with your Monza CRM account — the same email and password you use every day."
                : "No systems are connected yet, so Monza AI is running on sample data."}
            </p>
          </div>

          {CONFIGURED ? (
            <form className="stack" onSubmit={onSubmit}>
              <label className="stack" style={{ gap: 5 }}>
                <span className="cap">Email</span>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@monza.com"
                />
              </label>
              <label className="stack" style={{ gap: 5 }}>
                <span className="cap">Password</span>
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                />
              </label>

              {error ? <div className="note urgent">{error}</div> : null}

              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>
          ) : (
            <div className="stack">
              <div className="note">
                Everything you see inside is invented sample data, clearly
                labelled — nothing real is connected.
              </div>
              <a className="btn primary" href="/chat" style={{ textAlign: "center" }}>
                Have a look around
              </a>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
