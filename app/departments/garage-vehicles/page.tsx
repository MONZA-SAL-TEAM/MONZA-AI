import type { Metadata } from "next";
import GarageClient from "./GarageClient";
import "../departments.css";
import "../garage.css";

/**
 * /departments/garage-vehicles — Garage & Service and Vehicles & Parts merged
 * into one working board. This static segment wins over the dynamic
 * /departments/[slug] route, so this file owns the URL; the two old slugs
 * redirect here permanently (next.config.mjs).
 *
 * A thin server shell: the data (and whether it is the example board or the
 * honest not-wired-yet state) comes from GET /api/garage, so everything
 * interesting lives in GarageClient.
 */

export const metadata: Metadata = {
  title: "Garage & Vehicles — Monza AI",
  description:
    "Open garage jobs, cars waiting for parts, cars in stock, and parts running low — one board you can search and update.",
};

export default function GarageVehiclesPage() {
  return <GarageClient />;
}
