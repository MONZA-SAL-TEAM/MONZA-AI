import { NextResponse } from "next/server";
import { requireRealStaff } from "@/lib/auth";
import { INSIGHTS_CAPS } from "@/lib/insights/access";
import { channelDb } from "@/lib/channels/store";
import { actorOf } from "@/lib/leads/ownership-server";
import { MODEL_CODES } from "@/lib/wasales/knowledge";
import { COLOUR_FAMILIES } from "@/lib/wasales/observe-lexicon";

/**
 * POST /api/insights/review — a person's decision on one fact: confirm it, correct it (a car, or a colour),
 * or mark it unknown. Written to insight_overrides (append-only: the newest decision wins, every decision
 * is kept with who and when). The fact must exist; the new value must be from the closed vocabulary.
 * Owner and managers only.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireRealStaff(request, INSIGHTS_CAPS);
  if (!access.ok) return NextResponse.json({ ok: false, message: "Not available for your role." }, { status: access.reason === "unauthenticated" ? 401 : 403 });
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const str = (k: string) => (typeof b?.[k] === "string" ? (b[k] as string) : null);
  const action = str("action");
  if (action !== "confirm" && action !== "correct" && action !== "mark_unknown") return NextResponse.json({ ok: false, message: "Unknown action." }, { status: 400 });
  const newModel = str("newModel");
  const newValue = str("newValue");
  if (newModel && !(MODEL_CODES as readonly string[]).includes(newModel)) return NextResponse.json({ ok: false, message: "Unknown car." }, { status: 400 });
  if (newValue && !Object.keys(COLOUR_FAMILIES).includes(newValue)) return NextResponse.json({ ok: false, message: "Unknown colour." }, { status: 400 });
  if (action === "correct" && !newModel && !newValue) return NextResponse.json({ ok: false, message: "Choose the right car or colour." }, { status: 400 });

  const sb = channelDb();
  if (!sb) return NextResponse.json({ ok: false, message: "The database is not reachable here." }, { status: 503 });
  // The fact must exist exactly as named: the browser cannot invent one.
  const id = str("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, message: "Unknown fact." }, { status: 400 });
  const { data: fact } = await sb.from("sales_observations").select("account_id, external_message_id, kind, value, model").eq("id", id).maybeSingle();
  if (!fact) return NextResponse.json({ ok: false, message: "That fact no longer exists — the page may be old." }, { status: 404 });
  const actor = await actorOf(access.user);
  const f = fact as { account_id: string; external_message_id: string; kind: string; value: string; model: string | null };
  const { error } = await sb.from("insight_overrides").insert({
    account_id: f.account_id,
    external_message_id: f.external_message_id,
    kind: f.kind,
    value: f.value,
    model: f.model,
    action,
    new_value: action === "correct" ? newValue : null,
    new_model: action === "correct" ? newModel : null,
    by_staff: actor.id,
    by_name: actor.name,
  });
  if (error) return NextResponse.json({ ok: false, message: "The decision could not be saved." }, { status: 503 });
  console.info(`[insights/review] ${action} on ${f.kind} by ${actor.id}`);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
