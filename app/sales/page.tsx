import type { Metadata } from "next";
import { requireStaffForPage } from "@/lib/auth-server";
import WaSalesClient from "./WaSalesClient";
import "./wasales.css";

/**
 * /sales — the sales material library and the first-message auto-responder.
 *
 * WhatsApp is a CHANNEL of this product now, not a product of its own, so this
 * screen is about the material and the rules rather than about WhatsApp: the
 * catalogue with each model's videos and brochure, the guard rails that decide
 * whether anything may be sent automatically, and a simulator that runs the
 * real decision brain (lib/wasales/matcher.ts) on any message you type.
 *
 * Nothing is ever sent from here. No outbound channel is connected, so every
 * decision on the page is an honest preview.
 *
 * Guarded: the media library holds Monza's real sales material, so a verified
 * staff identity is required — middleware only checks that a cookie exists.
 */

export const metadata: Metadata = {
  title: "Sales — Monza AI",
  description:
    "Brochures, photos and videos ready to send, plus the guard rails and simulator for the first-message auto-responder.",
};

export const dynamic = "force-dynamic";

export default async function SalesPage() {
  await requireStaffForPage("/sales");
  return <WaSalesClient />;
}
