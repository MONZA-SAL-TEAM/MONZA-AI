import type { Metadata } from "next";
import TrackerClient from "./TrackerClient";
import "../../departments.css";
import "../../tracker.css";

/**
 * /departments/installments-payments/tracker — the Payment tracker.
 *
 * A thin server shell: the data (and whether it is the example month or the
 * honest not-wired-yet state) comes from GET /api/tracker, so everything
 * interesting lives in TrackerClient. This static segment sits alongside the
 * dynamic /departments/[slug] route; static wins, so the department page at
 * /departments/installments-payments is untouched.
 */

export const metadata: Metadata = {
  title: "Payment tracker — Monza AI",
  description:
    "Monthly installments per client: due date, amount, progress, and the WhatsApp message to send.",
};

export default function TrackerPage() {
  return <TrackerClient />;
}
