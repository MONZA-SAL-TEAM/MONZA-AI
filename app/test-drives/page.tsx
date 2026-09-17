import type { Metadata } from "next";
import { requireStaffForPage } from "@/lib/auth-server";
import TestDrivesClient from "./TestDrivesClient";

export const metadata: Metadata = {
  title: "Test drives — Monza AI",
};

/**
 * /test-drives — the calendar the sales bot books into (lib/wasales/sales-ops.ts,
 * migration 014). Customer names and numbers are shown, so a verified staff
 * identity is required.
 */
export const dynamic = "force-dynamic";

export default async function TestDrivesPage() {
  await requireStaffForPage("/test-drives");
  return <TestDrivesClient />;
}
