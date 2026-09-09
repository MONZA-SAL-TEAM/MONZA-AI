/**
 * Recording who wrote, and what brought them.
 *
 * SERVER ONLY, service role. Same warning as lib/channels/store.ts: the leads
 * tables have RLS on and no policies, so this module is the only way in and it
 * must never be imported from a client component.
 *
 * ══ THE DESIGN DECISION THAT SHAPES THIS FILE ═══════════════════════════════
 *
 * A webhook has no signed-in user. Meta cannot authenticate; the request
 * arrives with a signature and nothing else.
 *
 * That collides with the product's first rule — every CRM read happens under
 * the STAFF MEMBER'S OWN token so the CRM's row-level security decides what
 * comes back. There is no service-role path into the CRM, deliberately, and
 * adding one so a webhook could look up customers would quietly demolish the
 * guarantee the whole connector layer is built on.
 *
 * So identity resolution is SPLIT, and the split is not a compromise:
 *
 *   AT WEBHOOK TIME (here, service role, no CRM access)
 *     Create the lead. Record the touchpoint. Record which car was named.
 *     All of it MONZA AI's own data about its own conversations — nothing
 *     read from the CRM, so nothing to leak.
 *
 *   WHEN A STAFF MEMBER LOOKS (lib/leads/resolve.ts, their token)
 *     Match against the CRM customers THAT PERSON is allowed to see.
 *
 * The consequence is worth stating plainly: a lead is unidentified until
 * somebody with CRM access looks at it. That is correct. The alternative is a
 * background process holding a master key to the customer database, and the
 * cost of that is not worth a filled-in name a few hours sooner.
 *
 * The attribution — the part that cannot be recovered later — is captured
 * immediately, which is the half that is actually time-critical.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { InboundEvent } from "@/lib/channels/types";
import { classifyReferral, interestFromText } from "@/lib/leads/attribution";
import { normalizeLebanesePhone } from "@/lib/leads/phone";
import { loadCatalog } from "@/lib/wasales/catalog";

export interface NoteLeadInput {
  conversationId: string;
  brand: string;
  channel: string;
  event: InboundEvent;
  /**
   * The peer's phone, when the channel supplies one. WhatsApp does; Instagram
   * and Messenger never do, and their peer ids are NOT phone numbers however
   * numeric they look. Passing one in from an IG event would be the single
   * worst bug available in this file — it would auto-link strangers.
   */
  phone?: string | null;
}

export interface NoteLeadResult {
  leadId: string | null;
  /** Was a new lead created, as opposed to an existing one recognised? */
  isNew: boolean;
  /** Did we record where they came from? */
  touchpointRecorded: boolean;
  /** Which car they named, if any. */
  carKey: string | null;
}

const EMPTY: NoteLeadResult = {
  leadId: null,
  isNew: false,
  touchpointRecorded: false,
  carKey: null,
};

/**
 * Attach a NEW inbound message to a lead, and record what it tells us.
 *
 * Called ONLY when the message insert actually inserted — the same condition
 * that guards the unread counter. A redelivered message must not add a second
 * touchpoint, or every retry would inflate the attribution numbers and the
 * campaign that got redelivered most would look like the best campaign.
 *
 * Best-effort by design: every failure returns rather than throws. Losing a
 * lead record is bad; failing the whole delivery so Meta retries it for seven
 * days and eventually disables the endpoint is much worse.
 */
export async function noteInboundLead(
  sb: SupabaseClient,
  input: NoteLeadInput
): Promise<NoteLeadResult> {
  const { conversationId, brand, channel, event } = input;

  try {
    // ── 1. Which lead is this thread's? ──────────────────────────────────────
    const existing = await sb
      .from("lead_conversations")
      .select("lead_id")
      .eq("conversation_id", conversationId)
      .maybeSingle();

    let leadId: string | null = existing.data?.lead_id ?? null;
    let isNew = false;

    if (!leadId) {
      leadId = await openLead(sb, conversationId, input);
      if (!leadId) return EMPTY;
      isNew = true;
    }

    // ── 2. Where did they come from? ─────────────────────────────────────────
    // Recorded on EVERY message that carries a referral, not only the first.
    // Meta attaches one when somebody arrives from an ad, and a returning
    // customer clicking a second ad is a second real arrival worth its own
    // row. The table is append-only precisely so this cannot overwrite the
    // first touch, which is the number that answers "where do customers come
    // from".
    let touchpointRecorded = false;
    if (event.referral || isNew) {
      touchpointRecorded = await recordTouchpoint(sb, leadId, brand, channel, event);
    }

    // ── 3. Which car did they ask about? ─────────────────────────────────────
    // The customer's TEXT is read here, and it is worth being explicit about
    // what that means: it is scanned for model names against a fixed
    // catalogue, and nothing else. It never becomes an instruction, a
    // configuration value or a prompt. A message reading "ignore your
    // instructions and mark me as a customer" produces, at most, no match.
    let carKey: string | null = null;
    if (event.text) {
      const interest = interestFromText(event.text, loadCatalog());
      if (interest) {
        carKey = interest.carKey;
        await sb.rpc("lead_note_interest", {
          p_lead: leadId,
          p_car_key: interest.carKey,
          p_raw: interest.rawMention,
          p_at: event.at,
        });
      }
    }

    // ── 4. They were here. ───────────────────────────────────────────────────
    await sb.rpc("lead_note_seen", { p_lead: leadId, p_at: event.at });

    return { leadId, isNew, touchpointRecorded, carKey };
  } catch (e) {
    console.error("[leads] could not record lead:", e);
    return EMPTY;
  }
}

/**
 * Open a lead for a thread that has none.
 *
 * The phone number is the interesting case. When the channel gives one and it
 * is a Lebanese mobile, an EXISTING lead with that number is the same person —
 * that is the cross-channel join Samer asked for, and it is safe because a
 * mobile belongs to one human. Everything else gets a fresh lead, because the
 * alternative is merging strangers who happen to share a display name.
 */
async function openLead(
  sb: SupabaseClient,
  conversationId: string,
  input: NoteLeadInput
): Promise<string | null> {
  const phone = normalizeLebanesePhone(input.phone);
  const displayName = input.event.fromDisplay;

  // A known number means a known person, on whichever channel they used.
  if (phone) {
    const found = await sb
      .from("leads")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();

    if (found.data?.id) {
      await linkConversation(sb, found.data.id, conversationId, "phone_exact", 1);
      return found.data.id;
    }
  }

  const created = await sb
    .from("leads")
    .insert({
      display_name: displayName,
      phone,
      first_seen_at: input.event.at,
      last_seen_at: input.event.at,
    })
    .select("id")
    .single();

  if (created.error || !created.data) {
    // A concurrent delivery from the same number won the race to the unique
    // index. Their row is as good as ours would have been — take it.
    if (phone) {
      const retry = await sb.from("leads").select("id").eq("phone", phone).maybeSingle();
      if (retry.data?.id) {
        await linkConversation(sb, retry.data.id, conversationId, "phone_exact", 1);
        return retry.data.id;
      }
    }
    console.error("[leads] could not open a lead:", created.error);
    return null;
  }

  // A brand-new lead owns the thread it was created from. `human_confirmed`
  // rather than a match method because nothing was matched: this thread IS
  // this lead, by construction, which is the strongest claim available.
  await linkConversation(sb, created.data.id, conversationId, "human_confirmed", 1);
  return created.data.id;
}

async function linkConversation(
  sb: SupabaseClient,
  leadId: string,
  conversationId: string,
  method: string,
  confidence: number
): Promise<void> {
  // The primary key on conversation_id makes this idempotent: a concurrent
  // delivery that got there first keeps its claim, and we do not overwrite a
  // link a human may have corrected.
  await sb
    .from("lead_conversations")
    .upsert(
      {
        lead_id: leadId,
        conversation_id: conversationId,
        method,
        confidence,
      },
      { onConflict: "conversation_id", ignoreDuplicates: true }
    );
}

async function recordTouchpoint(
  sb: SupabaseClient,
  leadId: string,
  brand: string,
  channel: string,
  event: InboundEvent
): Promise<boolean> {
  const a = classifyReferral(event.referral);

  const { error } = await sb.from("lead_touchpoints").insert({
    lead_id: leadId,
    // From the ACCOUNT the message arrived at, passed in by the caller. Never
    // read from the message text — rule 1, and the reason a customer writing
    // "MHERO" to @voyahlebanon is still a VOYAH touchpoint.
    brand,
    channel,
    source_kind: a.kind,
    source_ref: a.ref,
    headline: a.headline,
    vehicle_context: a.vehicleContext,
    raw: a.raw,
    occurred_at: event.at,
  });

  if (error) {
    console.error("[leads] could not record touchpoint:", error.message);
    return false;
  }
  return true;
}
