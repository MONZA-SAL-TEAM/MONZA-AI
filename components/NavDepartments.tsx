"use client";

/**
 * The Departments dropdown. A plain <details> stays open across App Router
 * navigations (the root layout persists), so this small client component
 * closes it the three ways people expect: choosing an item, clicking
 * anywhere outside, and pressing Escape.
 */

import { useEffect, useRef } from "react";
import Link from "next/link";
import { DEPARTMENTS } from "@/lib/chat/departments";

export default function NavDepartments() {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => ref.current?.removeAttribute("open");

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <details className="nav-dd" ref={ref}>
      <summary>Departments</summary>
      <div className="nav-dd-panel">
        {DEPARTMENTS.map((d) => (
          <Link
            key={d.slug}
            className="nav-dd-item"
            href={`/departments/${d.slug}`}
            onClick={close}
          >
            {d.label}
          </Link>
        ))}
      </div>
    </details>
  );
}
