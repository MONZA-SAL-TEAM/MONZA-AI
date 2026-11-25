/**
 * A person moves a test-drive request along (lifecycle.ts holds the rules). One conditional UPDATE
 * — only if the request is still in the status the person saw — and one audit row.
 */

import { channelDb } from "@/lib/channels/store";
import { changeProblem, isOpenStatus, isTestDriveStatus, type StatusChange, type TestDriveStatus } from "@/lib/testdrives/lifecycle";

const UUID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;

export type ChangeOutcome = { ok: true; status: TestDriveStatus } | { ok: false; status: 400 | 404 | 409 | 503; reason: string };

export async function changeTestDrive(
  requestId: string,
  change: StatusChange & { salespersonName?: string | null },
  by: { id: string; name: string },
  nowMs: number = Date.now()
): Promise<ChangeOutcome> {
  const sb = channelDb();
  if (!sb) return { ok: false, status: 503, reason: "The database is not reachable here." };
  if (!UUID.test(requestId)) return { ok: false, status: 404, reason: "This request could not be found." };
  const { data: row, error } = await sb.from("test_drive_requests").select("id, status").eq("id", requestId).maybeSingle();
  if (error) return { ok: false, status: 503, reason: "The request could not be read just now." };
  const from = (row as { status?: string } | null)?.status;
  if (!row || !isTestDriveStatus(from)) return { ok: false, status: 404, reason: "This request could not be found." };
  const problem = changeProblem(from, change, nowMs);
  if (problem) return { ok: false, status: 400, reason: problem };

  const at = new Date(nowMs).toISOString();
  const patch: Record<string, unknown> = { status: change.to, updated_at: at, closed_at: isOpenStatus(change.to) ? null : at };
  if (change.to === "booked") {
    patch.slot_at = change.slotAt;
    patch.vehicle = change.vehicle;
    patch.salesperson_id = change.salespersonId;
    patch.salesperson_name = change.salespersonName?.slice(0, 120) ?? null;
  }
  if (change.to === "completed") patch.next_action = change.nextAction;
  const { data: done, error: saveError } = await sb.from("test_drive_requests").update(patch).eq("id", requestId).eq("status", from).select("id");
  // 23505: reopening while the chat already has another request in progress.
  if (saveError) return { ok: false, status: (saveError as { code?: string }).code === "23505" ? 409 : 503, reason: (saveError as { code?: string }).code === "23505" ? "This chat already has a request in progress." : "It could not be saved just now." };
  if (!Array.isArray(done) || done.length === 0) return { ok: false, status: 409, reason: "Someone changed this request a moment ago." };
  await sb.from("test_drive_request_events").insert({ request_id: requestId, from_status: from, to_status: change.to, by_staff: by.id, by_name: by.name.slice(0, 120) });
  return { ok: true, status: change.to };
}
