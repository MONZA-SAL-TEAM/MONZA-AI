import type { Metadata } from "next";
import Link from "next/link";
import { PAGES } from "@/lib/access/access";
import "../board.css";

export const metadata: Metadata = { title: "Not available — Monza AI" };

/** Where a page refused by Team & access sends people: a plain reason, no data. */
export default function NoAccessPage({ searchParams }: { searchParams: { page?: string } }) {
  const page = PAGES.find((p) => p.key === searchParams.page)?.label ?? (searchParams.page === "admin" ? "Team & access" : "This page");
  return (
    <div className="board">
      <header className="board-head">
        <p className="eyebrow">Monza AI</p>
        <h1 className="h1">{page} is not open to you</h1>
        <p className="lede">Your access to MONZA AI is set by the owner. Ask him if you need it.</p>
      </header>
      <p>
        <Link className="btn" href="/inbox">
          Go to the inbox
        </Link>
      </p>
    </div>
  );
}
