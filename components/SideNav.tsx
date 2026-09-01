"use client";

/**
 * The app shell's left sidebar — the navigation for the whole product.
 *
 * Desktop: a fixed rail with three quiet groups (Assistant / Departments /
 * System). Phone: a top bar with the logotype and a menu button; the rail
 * slides over the content and closes on navigation, outside tap, or Escape.
 * Active route gets the accent pill. All colors via tokens.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DEPARTMENTS } from "@/lib/chat/departments";

function Icon({ d, box = 24 }: { d: string; box?: number }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox={`0 0 ${box} ${box}`}
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
  chat: "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z",
  crm: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  installments: "M1 4h22v16H1z M1 10h22",
  garage: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
  finance: "M3 3v18h18 M7 13l4-4 4 4 5-5",
  dashboard: "M12 2a10 10 0 1 0 10 10 M12 2v10l7-7",
  connections: "M9 2v6 M15 2v6 M12 17v5 M5 8h14l-1 7a6 6 0 0 1-12 0z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
};

function Brand() {
  return (
    <Link className="side-brand" href="/chat">
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
  const asideRef = useRef<HTMLElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const linkFor = (
    href: string,
    label: string,
    iconKey: string,
    exact = false
  ) => {
    const active = exact ? pathname === href : pathname.startsWith(href);
    return (
      <Link
        key={href}
        className="side-link"
        href={href}
        aria-current={active ? "page" : undefined}
        onClick={close}
      >
        <Icon d={ICONS[iconKey] ?? ICONS.chat} />
        <span>{label}</span>
      </Link>
    );
  };

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

      <aside className="side" data-open={open} ref={asideRef} aria-label="Main">
        <div className="side-head">
          <Brand />
          <div className="aurora" aria-hidden="true" />
        </div>

        <nav className="side-nav">
          <div className="side-group">
            <div className="side-group-label">Assistant</div>
            {linkFor("/chat", "Chat", "chat", true)}
          </div>

          <div className="side-group">
            <div className="side-group-label">Departments</div>
            {DEPARTMENTS.map((d) =>
              linkFor(`/departments/${d.slug}`, d.label, d.key)
            )}
          </div>

          <div className="side-group">
            <div className="side-group-label">System</div>
            {linkFor("/dashboard", "Overview", "dashboard")}
            {linkFor("/connections", "Connections", "connections")}
            {linkFor("/settings", "Settings", "settings")}
          </div>
        </nav>

        <div className="side-foot">Monza SAL — internal</div>
      </aside>
    </>
  );
}
