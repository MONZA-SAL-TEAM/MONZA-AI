import type { Metadata } from "next";
import CustomersClient from "./CustomersClient";
import "../departments.css";
import "../customers.css";

/**
 * /departments/customers-sales — the customer directory. This static segment
 * wins over the dynamic /departments/[slug] route, so this file owns the URL
 * (the third board in the family, after the tracker and the garage).
 *
 * A thin server shell: the data (and whether it is the example directory or
 * the honest not-wired-yet state) comes from GET /api/customers, so
 * everything interesting lives in CustomersClient.
 */

export const metadata: Metadata = {
  title: "Customers & Sales — Monza AI",
  description:
    "Look up any customer — car, VIN, plate, plan and garage status — see where new enquiries come from, and add customers.",
};

export default function CustomersSalesPage() {
  return <CustomersClient />;
}
