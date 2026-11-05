"use client";

/**
 * The Notifications page: one switch for this phone or computer, and the reasons when it cannot ring
 * (lib/push/device.ts says which). The state and the actions are `usePush` in components/PushToggle.tsx —
 * the same code the inbox's bell uses, so the two can never disagree about whether this device is on.
 */

import { Bell, usePush } from "@/components/PushToggle";
import { pushHelp } from "@/lib/push/device";
import "../board.css";

export default function NotificationsClient() {
  const { path, ios, busy, message, turnOn, turnOff, sendTest } = usePush();
  const on = path === "on";

  return (
    <main className="board notify-board">
      <header className="board-head">
        <div className="eyebrow">System</div>
        <h1 className="h1">Notifications</h1>
        <p className="lede">Make this device ring for new customer messages, even when Monza AI is closed.</p>
      </header>

      <section className="card pad-lg notify-card" aria-labelledby="notify-state">
        <div className="notify-row">
          <span className="push-badge" data-on={on}>
            <Bell off={path === "blocked"} />
          </span>
          <div className="notify-text">
            <h2 id="notify-state" className="notify-title">
              {path === null ? "Checking this device…" : on ? "On — this device rings" : path === "blocked" ? "Blocked on this device" : path === "needs-install" ? "Install the app first" : path === "unsupported" ? "Not possible in this browser" : path === "not-set-up" ? "Not set up on the server" : "Off on this device"}
            </h2>
            {path && <p className="notify-help">{pushHelp(path, ios)}</p>}
          </div>
        </div>

        {message && (
          <p className="push-message" role="status">
            {message}
          </p>
        )}

        {path && path !== "unsupported" && path !== "not-set-up" && (
          <div className="notify-actions">
            {path === "off" && (
              <button type="button" className="btn primary" disabled={busy} onClick={() => void turnOn()}>
                {busy ? "Switching on…" : "Turn on notifications"}
              </button>
            )}
            {on && (
              <>
                <button type="button" className="btn" disabled={busy} onClick={() => void turnOff()}>
                  {busy ? "Switching off…" : "Turn off notifications"}
                </button>
                <button type="button" className="btn primary" disabled={busy} onClick={() => void sendTest()}>
                  Send a test
                </button>
              </>
            )}
            {path === "needs-install" && (
              <a className="btn primary" href="/install">
                How to install
              </a>
            )}
          </div>
        )}
      </section>

      <section className="card pad-lg notify-card" aria-labelledby="notify-what">
        <h2 id="notify-what" className="notify-title">
          What a notification says
        </h2>
        <ul className="notify-list">
          <li>Who wrote and on which channel — for example “New WhatsApp message · Rami · MONZA”. Never the message itself: a lock screen is public.</li>
          <li>Every new customer message on every brand. A sales alert rings on its own only when it is hot or overdue.</li>
          <li>Tapping it opens Monza AI — the chat on WhatsApp, the inbox on Instagram and Facebook.</li>
        </ul>
      </section>

      <section className="card pad-lg notify-card" aria-labelledby="notify-devices">
        <h2 id="notify-devices" className="notify-title">
          Each device on its own
        </h2>
        <ul className="notify-list">
          <li>The switch above is for the phone or computer you are holding. Open this page on each device that should ring and switch it on there.</li>
          <li>iPhone and iPad ring only from the installed app, never from a Safari tab (Apple’s rule).</li>
          <li>Switching off here stops this device only. Your other devices keep ringing until you switch them off too.</li>
          <li>If it stays quiet: check the phone’s own settings — Focus or Do Not Disturb, battery saver, and notifications allowed for Monza AI.</li>
        </ul>
      </section>
    </main>
  );
}
