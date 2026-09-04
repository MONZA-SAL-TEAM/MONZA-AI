import type { Metadata } from "next";
import { requireStaffForPage } from "@/lib/auth-server";
import { getSource, isDemoSource, readContext } from "@/lib/domain";
import { DEMO_TODAY } from "@/lib/domain/demo-source";
import VehiclesClient from "./VehiclesClient";

export const metadata: Metadata = {
  title: "Vehicle updates — Monza AI",
};

/**
 * /vehicles — vehicle updates, NOT garage management.
 *
 * The garage system remains authoritative for job cards, technicians, parts,
 * labour and everything else about the work. This screen answers exactly one
 * question: whose car has reached a state that means the customer should hear
 * from us — above all, "ready for pickup".
 *
 * The board this replaced was drifting toward a second garage system: a job
 * lifecycle with status transitions, a parts rail and a stock rail. All of that
 * belongs where the work happens.
 */
export const dynamic = "force-dynamic";

export default async function VehiclesPage() {
  const user = await requireStaffForPage("/vehicles");
  const source = getSource();
  const ctx = readContext(user);

  const [vehicles, customers] = await Promise.all([
    source.listVehicles(ctx),
    source.listCustomers(ctx),
  ]);

  return (
    <VehiclesClient
      today={DEMO_TODAY}
      demo={isDemoSource(source)}
      sourceLabel={source.label}
      vehicles={vehicles}
      customers={customers}
    />
  );
}
