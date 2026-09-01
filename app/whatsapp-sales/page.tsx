import type { Metadata } from "next";
import WaSalesClient from "./WaSalesClient";
import "./wasales.css";

/**
 * /whatsapp-sales — Monza WhatsApp Sales Control.
 *
 * The control panel for the first-message auto-sender: the car catalog with
 * each model's videos + brochure, the guard rails, and a live simulator that
 * runs the real decision brain (lib/wasales/matcher.ts) on any message you
 * type. No WhatsApp Business number is connected yet, so every decision on
 * the page is an honest preview — nothing is ever sent from here.
 *
 * A thin server shell: the catalog (and whether it is the example set or the
 * honest not-wired-yet state) comes from GET /api/whatsapp-sales, so
 * everything interesting lives in WaSalesClient.
 */

export const metadata: Metadata = {
  title: "WhatsApp Sales — Monza AI",
  description:
    "Car catalog with videos and brochures, auto-send guard rails, and a live simulator for the first-message WhatsApp responder.",
};

export default function WhatsAppSalesPage() {
  return <WaSalesClient />;
}
