import type { Metadata } from "next";
import { requireStaffForPage } from "@/lib/auth-server";
import NotificationsClient from "./NotificationsClient";

export const metadata: Metadata = {
  title: "Notifications — Monza AI",
};

/**
 * /notifications — the switch for THIS device, as a page of its own (Samer, 2026-11-05: "a page
 * notification … so I can turn off and turn on notification … no need more to be in the setting").
 * It used to be a button at the foot of the side rail, inside the phone's hidden menu.
 *
 * Every signed-in person may open it: it is their own device, not a page Team & access controls
 * (`pageKeyOf("/notifications")` is null, like `/api/push`). The state itself lives in the browser's
 * push subscription — nothing here is read from the database.
 */
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  await requireStaffForPage("/notifications");
  return <NotificationsClient />;
}
