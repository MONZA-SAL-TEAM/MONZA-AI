-- =============================================================================
-- 005_leads.sql — who we are talking to, and how they found us.
--
-- THE QUESTION THIS ANSWERS: a stranger messages @voyahlebanon asking about the
-- MHERO. Are they already a Monza customer? Have they written before, on
-- another channel? What made them write — an ad, a story, the website? Which
-- car are they actually interested in? All of it WITHOUT asking them, because
-- asking a customer "have we met?" is the thing a good salesperson never does.
--
-- ── What is owned here, and what is not ─────────────────────────────────────
--
-- MONZA AI does not own customers. The CRM does. Nothing in this file copies a
-- customer's name, phone, address or history out of the CRM — `crm_customer_id`
-- is an OPAQUE pointer, deliberately not a foreign key, because the two
-- databases are separate projects and a stale copy that disagrees with the CRM
-- is worse than no copy at all.
--
-- What IS owned here is the inference: "these three conversations are one
-- person, and that person is probably CRM customer X". That is MONZA AI's own
-- reasoning about its own conversations, and it belongs nowhere else.
--
-- ── The rule that shapes every table below ──────────────────────────────────
--
-- A MATCH IS A GUESS UNTIL A PHONE NUMBER OR A PERSON SAYS OTHERWISE.
--
-- A phone number is a near-unique identifier: two people do not share one, and
-- WhatsApp hands it over. That match links itself.
--
-- A name is not an identifier. In Lebanon a great many people share a surname,
-- Instagram display names are freely chosen and freely changed, and a wrong
-- merge writes one customer's conversation history onto another customer's
-- profile — a mistake that is silent, compounding and painful to unpick. So a
-- name match NEVER links. It becomes a suggestion in lead_match_suggestions
-- and waits for a human click.
--
-- The schema enforces that distinction rather than trusting the code to: see
-- the check constraint on leads.crm_link_method.
-- =============================================================================

-- ── How two identities came to be considered the same person ────────────────
--
-- Stored rather than recomputed, because "why does the system think this is
-- Karim?" must be answerable months later, when the message that justified it
-- has scrolled away and the display name has changed twice.

-- Postgres has no `create type if not exists`, and a migration that aborts on
-- its FIRST statement when re-run is a migration nobody can safely re-apply —
-- which matters here because everything below it IS idempotent. Guarded, so
-- the whole file can be run twice and the second run is a no-op.
do $$
begin
  create type public.lead_match_method as enum (
    -- The phone number matched exactly, digits compared with separators
    -- stripped. The only method allowed to link itself.
    'phone_exact',
    -- A person looked at the evidence and clicked confirm. Also authoritative,
    -- for a different reason: somebody is accountable for it.
    'human_confirmed',
    -- The customer said so themselves in the thread, and a person confirmed it.
    'customer_stated',
    -- Names are similar. NEVER auto-links — recorded on suggestions only.
    'name_similar'
  );
exception when duplicate_object then null;
end $$;

-- ── Where a lead came from ──────────────────────────────────────────────────
--
-- Deliberately coarse. These are the answers Samer actually acts on; a finer
-- taxonomy would be guessing at precision Meta does not give us.

do $$
begin
  create type public.lead_source_kind as enum (
    -- Click-to-WhatsApp / Click-to-Messenger ad. Meta hands us the ad reference
    -- in the referral payload, so this is FACT, not inference — the strongest
    -- attribution available anywhere in this system.
    'ad_click',
    -- Replied to a story, or messaged from a post. Meta names the media.
    'social_post',
    -- Came through monzasal.com — the website_events trail carries the page and
    -- the vehicle they were looking at.
    'website',
    -- Wrote to the account directly with no referral payload at all. Honest
    -- name for "we do not know": they had the number or the handle already.
    'direct',
    -- Somebody on staff recorded where this one came from.
    'staff_recorded'
  );
exception when duplicate_object then null;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- LEADS — one row per person MONZA AI believes it is talking to.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Not a CRM record and not a pipeline. There is no deal value here, no stage,
-- no owner, no next-action field. Those exist in the CRM and duplicating them
-- is how this product would quietly become a second CRM.
--
-- A lead may span brands: the same human can ask about a Voyah on Monday and
-- an MHERO on Thursday, and knowing that is the entire point. Brand isolation
-- is NOT weakened by this — each CONVERSATION still belongs to exactly one
-- account and one brand, enforced in 003. What is joined here is the person,
-- above the channels, and only ever by phone or by a human decision.

create table if not exists public.leads (
  id            uuid primary key default gen_random_uuid(),

  -- Best name we have, for a staff member reading a list. Display only: it is
  -- whatever the person calls themselves on the channel they last used, which
  -- is not an identity and is never matched on automatically.
  display_name  text,

  -- Digits only, no plus, no separators — comparable and wa.me-ready.
  -- THE identity in this table. Null is the normal state for Instagram and
  -- Facebook, which never hand over a number.
  phone         text,

  -- ── The link to the CRM ──────────────────────────────────────────────────
  -- Opaque on purpose. Not a foreign key: different Supabase project. A dead
  -- pointer must degrade to "we do not know who this is", never to an error.
  crm_customer_id        text,
  crm_link_method        public.lead_match_method,
  -- 0..1. Recorded even for certainties, so a report can filter on it without
  -- special-casing.
  crm_link_confidence    numeric(3,2) check (crm_link_confidence between 0 and 1),
  -- Null when the link was automatic. Set to a staff uuid when a person clicked.
  crm_link_confirmed_by  uuid,
  crm_link_confirmed_at  timestamptz,

  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- ── THE GUARD THAT MAKES THE RULE STRUCTURAL ─────────────────────────────
  -- A name similarity can never be the reason a lead is attached to a CRM
  -- customer. If code ever tries, the database refuses. This is the single
  -- most important line in the file: everything else here is bookkeeping,
  -- and this is the thing that stops a silent wrong merge.
  constraint leads_no_link_on_name_alone
    check (crm_link_method is null or crm_link_method <> 'name_similar'),

  -- A link is either present and explained, or absent. "Linked to customer X
  -- for reasons unknown" is not a state worth being able to represent.
  constraint leads_link_is_explained
    check (
      (crm_customer_id is null and crm_link_method is null)
      or (crm_customer_id is not null and crm_link_method is not null)
    )
);

-- A phone number identifies one lead. Partial, so the many phone-less
-- Instagram leads do not collide with each other on null.
create unique index if not exists leads_phone_key
  on public.leads (phone) where phone is not null;

create index if not exists leads_crm_customer_idx
  on public.leads (crm_customer_id) where crm_customer_id is not null;
create index if not exists leads_recent_idx
  on public.leads (last_seen_at desc);
-- The work queue: leads nobody has identified yet.
create index if not exists leads_unidentified_idx
  on public.leads (last_seen_at desc) where crm_customer_id is null;

-- ═══════════════════════════════════════════════════════════════════════════
-- LEAD ↔ CONVERSATION — which threads belong to this person.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Separate from channel_conversations rather than a column on it, because the
-- LINK has its own facts: how it was made, how sure we are, who agreed. A
-- nullable lead_id column could hold none of that.
--
-- Instagram scopes a user's id per Page, so the SAME human writing to
-- @voyahlebanon and to @mherolebanon arrives as two unrelated ids. There is no
-- way to know they are one person from the ids alone — which is exactly why
-- this table exists and why phone and human judgement are the only routes in.

create table if not exists public.lead_conversations (
  lead_id         uuid not null references public.leads(id) on delete cascade,
  conversation_id uuid not null references public.channel_conversations(id) on delete cascade,
  method          public.lead_match_method not null,
  confidence      numeric(3,2) not null check (confidence between 0 and 1),
  confirmed_by    uuid,
  confirmed_at    timestamptz,
  created_at      timestamptz not null default now(),

  -- A conversation belongs to at most ONE person. Without this, two leads
  -- could both claim a thread and every count downstream would double.
  primary key (conversation_id),

  -- Same rule as on leads, restated where it is enforced: a similar name is
  -- never sufficient to attach a thread to a person.
  constraint lead_conversations_no_name_alone
    check (method <> 'name_similar')
);

create index if not exists lead_conversations_lead_idx
  on public.lead_conversations (lead_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- TOUCHPOINTS — every time this person arrived, and what brought them.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- APPEND-ONLY. A lead's first touch answers "where did they come from"; the
-- whole list answers "what have we spent to keep them warm". Rewriting history
-- when someone returns through a different ad would destroy both answers, so
-- nothing here is ever updated — first touch is simply the earliest row.

create table if not exists public.lead_touchpoints (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.leads(id) on delete cascade,

  -- Which marque they came to. Not derived from the text — from the account
  -- the message arrived at, per rule 1.
  brand        public.monza_brand not null,
  channel      public.channel_kind not null,
  source_kind  public.lead_source_kind not null,

  -- Meta's own reference for the ad or the post, when it gave us one. The
  -- reason 'ad_click' is fact rather than inference.
  source_ref   text,
  -- The ad or post headline Meta included, for a staff member reading it.
  headline     text,
  -- Which vehicle the referring page or post was about, in the source's own
  -- words: 'VOYAH Free', 'MHERO 1'. Not normalised here — normalising a
  -- marketing string into an inventory model is lead_interests' job, and
  -- doing it on write would lose the original.
  vehicle_context text,

  -- Everything else Meta or the website sent, kept whole. When attribution is
  -- questioned months later, the parsed columns are an argument and this is
  -- the evidence.
  raw          jsonb not null default '{}'::jsonb,

  -- From the payload, never the receiving clock — same rule as messages.
  occurred_at  timestamptz not null,
  created_at   timestamptz not null default now()
);

create index if not exists lead_touchpoints_lead_idx
  on public.lead_touchpoints (lead_id, occurred_at);
create index if not exists lead_touchpoints_attribution_idx
  on public.lead_touchpoints (source_kind, occurred_at desc);
create index if not exists lead_touchpoints_brand_idx
  on public.lead_touchpoints (brand, occurred_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- INTERESTS — which car they actually asked about.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `car_key` is the catalogue key the mention resolved to (lib/wasales/catalog),
-- which is the same vocabulary the sales auto-responder already speaks. That
-- shared vocabulary is the point: the robot that answers "do you have the
-- MHERO in black" and the dashboard that reports "36 people asked about MHERO
-- 1" must agree on what a model is called, or the two numbers will differ and
-- nobody will know which to believe.
--
-- `raw_mention` keeps what the customer actually typed. "el mhero", "M HERO",
-- "mhero1" all resolve to one key, and when a resolution turns out wrong the
-- original is still there to fix the matcher with.

create table if not exists public.lead_interests (
  lead_id           uuid not null references public.leads(id) on delete cascade,
  car_key           text not null,
  raw_mention       text,
  -- How many separate messages mentioned it. Someone who names a car five
  -- times is telling you something a single mention does not.
  mention_count     integer not null default 1 check (mention_count > 0),
  first_mentioned_at timestamptz not null default now(),
  last_mentioned_at  timestamptz not null default now(),

  primary key (lead_id, car_key)
);

create index if not exists lead_interests_car_idx
  on public.lead_interests (car_key, last_mentioned_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- SUGGESTIONS — "this might be Karim Haddad", waiting for a human.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Where every name match goes to wait. A suggestion is inert: it changes no
-- count, appears on no dashboard total, and reaches the customer in no way. It
-- exists so a staff member can act on a hunch the system had, and so that a
-- REJECTED hunch is remembered and not offered again next week.

create table if not exists public.lead_match_suggestions (
  id                    uuid primary key default gen_random_uuid(),
  lead_id               uuid not null references public.leads(id) on delete cascade,

  -- The CRM customer being proposed. Opaque, as everywhere.
  crm_customer_id       text not null,
  -- Denormalised for the review list, so showing ten suggestions does not mean
  -- ten CRM round trips. Display only, and never matched on.
  crm_customer_name     text,

  method                public.lead_match_method not null,
  score                 numeric(3,2) not null check (score between 0 and 1),
  -- What the score was based on, in words a person can weigh: which fields
  -- agreed, which differed. A confidence number alone is not reviewable.
  evidence              jsonb not null default '{}'::jsonb,

  status                text not null default 'pending'
                        check (status in ('pending','accepted','rejected')),
  decided_by            uuid,
  decided_at            timestamptz,
  created_at            timestamptz not null default now(),

  -- One live suggestion per (lead, customer) pair. Re-proposing a rejected
  -- match every time the person writes again would train staff to ignore the
  -- queue, which is how a review queue dies.
  unique (lead_id, crm_customer_id)
);

create index if not exists lead_match_suggestions_queue_idx
  on public.lead_match_suggestions (status, score desc, created_at)
  where status = 'pending';

-- ── RLS: on, and closed ─────────────────────────────────────────────────────
--
-- No policies, exactly as 003. The server writes with the service role; the
-- anon key in the browser bundle reaches none of it. This is the table set that
-- says who a person is and what they are worth to the business — if anything
-- here is more sensitive than the conversations themselves, it is this.

alter table public.leads                 enable row level security;
alter table public.lead_conversations    enable row level security;
alter table public.lead_touchpoints      enable row level security;
alter table public.lead_interests        enable row level security;
alter table public.lead_match_suggestions enable row level security;

-- ── Recording an interest without a round trip ──────────────────────────────
--
-- Upsert as a function because the caller is a webhook handler processing a
-- batch: read-then-write would race with a second delivery from the same
-- person and lose a count. `greatest` on the timestamp for the same reason
-- redelivery needs it on conversations — an out-of-order message must not
-- rewind when they last showed interest.

create or replace function public.lead_note_interest(
  p_lead uuid,
  p_car_key text,
  p_raw text,
  p_at timestamptz
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.lead_interests
    (lead_id, car_key, raw_mention, mention_count, first_mentioned_at, last_mentioned_at)
  values (p_lead, p_car_key, p_raw, 1, p_at, p_at)
  on conflict (lead_id, car_key) do update
    set mention_count      = public.lead_interests.mention_count + 1,
        last_mentioned_at  = greatest(public.lead_interests.last_mentioned_at, excluded.last_mentioned_at),
        first_mentioned_at = least(public.lead_interests.first_mentioned_at, excluded.first_mentioned_at),
        -- Keep the newest wording: it is the one a staff member will recognise
        -- from the thread they are about to open.
        raw_mention        = coalesce(excluded.raw_mention, public.lead_interests.raw_mention);
$$;

revoke all on function public.lead_note_interest(uuid, text, text, timestamptz)
  from public, anon, authenticated;

-- ── Keeping last_seen_at honest ─────────────────────────────────────────────
--
-- Same shape and same reason: called on every inbound message, must not move
-- backwards on a redelivery.

create or replace function public.lead_note_seen(
  p_lead uuid,
  p_at timestamptz
) returns void
language sql
security definer
set search_path = public
as $$
  update public.leads
     set last_seen_at  = greatest(last_seen_at, p_at),
         first_seen_at = least(first_seen_at, p_at),
         updated_at    = now()
   where id = p_lead;
$$;

revoke all on function public.lead_note_seen(uuid, timestamptz)
  from public, anon, authenticated;
