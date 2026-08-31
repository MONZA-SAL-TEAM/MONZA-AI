import type { Metadata } from "next";
import TrackerClient from "./TrackerClient";
import "../departments.css";
import "../tracker.css";

/**
 * /departments/installments-payments — the department page IS the payment
 * tracker. This static segment wins over the dynamic /departments/[slug]
 * route, so this file owns the URL.
 *
 * A thin server shell: the data (and whether it is the example month or the
 * honest not-wired-yet state) comes from GET /api/tracker, so everything
 * interesting lives in TrackerClient.
 */

export const metadata: Metadata = {
  title: "Installments & Payments — Monza AI",
  description:
    "Monthly installments per client: due date, amount, money progress, and the WhatsApp message to send.",
};

export default function InstallmentsPaymentsPage() {
  return <TrackerClient />;
}
