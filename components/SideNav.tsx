"use client";

/**
 * The app shell's left sidebar.
 *
 * Desktop: a fixed rail of quiet groups. Phone: a top bar with the logotype and
 * a menu button; the rail slides over the content and closes on navigation,
 * outside tap, or Escape.
 *
 * Every destination comes from lib/nav.ts — the sidebar renders that list and
 * invents nothing, so the navigation, the sign-in matcher and the redirects
 * cannot drift apart.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/nav";

function Icon({ d }: { d: string }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

/* One line-icon per destination, drawn in currentColor. */
const ICONS: Record<string, string> = {
  inbox:
    "M22 12h-6l-2 3h-4l-2-3H2 M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
  customers:
    "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  automations:
    "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
  installments: "M1 4h22v16H1z M1 10h22",
  vehicles:
    "M5 17H3v-5l2-5h14l2 5v5h-2 M7 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0 M13 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0",
  sales: "M22 2L11 13 M22 2l-7 20-4-9-9-4z",
  chat:
    "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z",
  dashboard: "M12 2a10 10 0 1 0 10 10 M12 2v10l7-7",
  integrations: "M9 2v6 M15 2v6 M12 17v5 M5 8h14l-1 7a6 6 0 0 1-12 0z",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
};

function Brand() {
  return (
    <Link className="side-brand" href="/inbox">
      <span className="side-mark" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path
            d="M4 17V7l8 7 8-7v10"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="side-brand-name">Monza AI</span>
    </Link>
  );
}

export default function SideNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <>
      {/* Phone header: logotype + menu. Hidden on desktop via CSS. */}
      <div className="app-top">
        <Brand />
        <button
          type="button"
          className="side-toggle"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            {open ? (
              <path d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
        </button>
      </div>
      {open && <div className="side-scrim" onClick={close} aria-hidden="true" />}

      <aside className="side" data-open={open} aria-label="Main">
        <div className="side-head">
          <Brand />
          <div className="aurora" aria-hidden="true" />
        </div>

        <nav className="side-nav">
          {NAV.map((group) => (
            <div className="side-group" key={group.label}>
              <div className="side-group-label">{group.label}</div>
              {group.items.map((item) => {
                const active = item.exact
                  ? pathname === item.href
                  : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    className="side-link"
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={close}
                  >
                    <Icon d={ICONS[item.icon] ?? ICONS.chat} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="side-foot">Monza SAL — internal</div>
      </aside>
    </>
  );
}
