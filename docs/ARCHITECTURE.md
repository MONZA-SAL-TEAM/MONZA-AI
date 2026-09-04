# MONZA AI — architecture

## What this is

A **unified communication, follow-up and automation layer** above Monza's
existing business systems.

It is not an ERP, not an accounting system, not a garage system and not a CRM.
Every one of those exists already, is authoritative, and stays that way.

```
SOURCE SYSTEMS  (CRM · garage · accounting · Supabase)     <- authoritative
        |
        |  read-only, through one adapter, at question time
        v
MONZA AI        conversations · messages · assignment · templates ·
                automations · execution history · media library · audit
        |
        v
WhatsApp · Instagram · Facebook
```

## The data boundary

This is the load-bearing rule. Everything else follows from it.

| MONZA AI **owns** | MONZA AI **reads** |
|---|---|
| conversations, messages | customer records |
| channel identities, message status | vehicles and their status |
| assignment, conversation state | installments and their status |
| message templates | payments and receipts |
| automations and their run history | sales/catalogue data |
| notification history, media library | |
| AI interactions and the audit trail | |

Consequences, stated plainly so they are hard to erode:

- **Nothing on the right-hand column is copied here.** There is no customers
  table, no balance, no work order. Communication records store an *opaque
  reference* to the source system's id and nothing else.
- **MONZA AI never decides a business fact.** "Overdue" is the source system's
  word. The screens count rows they were given; they do not recompute them.
  (The installment screen this replaced computed plan coverage from cumulative
  dollars — careful arithmetic that should not have existed here at all.)
- **Reads run as the asking staff member.** The adapter carries their own
  source-system token, so the source system's own row-level security decides
  what comes back. The AI physically cannot read what the user cannot.

### The adapter

`lib/domain/` is the only way business data enters.

- `types.ts` — the vocabulary: Customer, Vehicle, Installment, Payment,
  SalesItem, and the channel types.
- `source.ts` — the `SourceSystem` interface. **It has no mutation method.**
  Read-only is enforced by the shape of the interface, not by discipline.
- `demo-source.ts` — the demo implementation, *derived* from the reconciled demo
  canon in `lib/customers/directory-data.ts` rather than hand-written, so the
  chat answers, the boards and the inbox cannot drift apart.
- `index.ts` — `getSource()`. One implementation today, by design: real business
  data is not connected. When the Supabase source lands it goes here and no
  screen changes.

## Security

Four layers, none of which trusts another.

1. **The sign-in gate** (`lib/gate.ts`, applied by `middleware.ts`). Checks that
   a cookie *exists*. Deliberately shallow — verifying on every navigation means
   a round-trip to the CRM each time. Its protected list is *derived from
   `lib/nav.ts`*, so a screen cannot be added to the product and left off the
   gate.
2. **Route authentication** (`lib/auth.ts`). Every API route verifies the token
   against the CRM. `requireStaff` returns the fixed demo identity when no CRM is
   configured, so a credential-free reviewer can walk the whole product.
3. **Page authentication** (`lib/auth-server.ts`). Server components that render
   real data verify too. They did not, once, and a junk cookie was enough to read
   the audit log.
4. **`requireRealStaff`** — for anything touching real shared infrastructure
   (production storage today, outbound messages tomorrow). It refuses the demo
   identity outright, because in demo mode *anonymous* and *demo staff* are the
   same caller. That confusion is what made the media bucket world-writable.

Plus, for the assistant specifically:

- **Layer 1** (`lib/permissions/kernel.ts`) — may this user use this tool at
  all? Deny beats owner; an unknown connector is denied.
- **Layer 2** — the source system's own RLS, which applies because connectors
  query with the user's token.

**Disclosure rule:** public endpoints answer liveness only. Configuration state
goes to verified staff; secret *values*, lengths, prefixes and raw upstream
errors go to nobody. Diagnostics belong in the server log.

## Automations

`lib/automations/` — the engine is **pure**: no clock, no randomness, no I/O.
The same events and automations always produce the same plan, which is why the
Automations screen can show what *would* happen by running the real engine.

- `types.ts` — an automation is **data**: a trigger and actions, both from closed
  sets. There is no scripting surface, and a `send_message` action may only name
  a **template**. No model output reaches a customer through this path.
- `events.ts` — the only place business facts become triggers, and the only place
  event ids are minted. **Every id is derived from stable facts** (which
  installment, which job, which reminder window) and never from the time it was
  noticed.
- `engine.ts` — planning, idempotency keys, execution history, retry policy.
- `templates.ts`, `catalog.ts` — the messages, and the automations, as data.

Four properties the tests pin down:

- **Nobody is messaged twice.** Re-processing an event produces the same
  idempotency key, which is recognised as already done. Only a *successful* send
  counts as done, so failures stay retryable.
- **A late payment is chased once**, not every morning: the overdue event id
  carries no day count.
- **No retro-spam.** Payment confirmations only fire for payments received
  within a recency window — otherwise switching the automation on would thank
  every customer for a payment they made months ago.
- **Everything ends with a person.** After the extended-overdue threshold the
  customer is not messaged again; the team is told.

Every automation ships **switched off**.

## Testing

`npm test` — Node's built-in runner, zero dependencies. Node 24 strips
TypeScript types natively; `tests/_alias.mjs` supplies the one thing it does not
know, the `@/` path alias.

Type stripping does not understand JSX, so `.tsx` cannot be imported by a test.
That is a feature: it keeps business logic in `lib/` where it can be tested,
instead of stranded inside a component.

## Deliberately not built

- **Customer-facing AI.** Out of scope. The architecture is ready for it — a
  closed template set and a permission kernel are exactly what it would need —
  but nothing autonomous talks to customers.
- **A live Supabase source.** The adapter exists so this can be dropped in
  later; connecting it was explicitly not part of this work.
- **A Money & Reports screen.** Money questions are answered by the assistant,
  which reads the finance connector under the asker's own permissions. A second
  set of books is exactly what this layer must not become.
- **Outbound sending.** No channel is connected, so nothing sends. Screens offer
  a prefilled WhatsApp link a person taps instead — and say so.
