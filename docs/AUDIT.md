# MONZA AI — repository audit (2026-09-03)

Baseline: `main` at `588742f`. `tsc --noEmit` clean. Live at https://monza-ai.vercel.app.

## What MONZA AI is

A unified **communication, follow-up and automation layer** above Monza's
existing business systems. It is not an ERP, not accounting, not a garage
system, not a CRM.

```
SOURCE SYSTEMS (Supabase / CRM / garage / accounting)   <- authoritative
        |  read-only, through adapters
        v
MONZA AI   <- owns conversations, messages, templates, automations, history
        |
        v
WhatsApp / Instagram / Facebook
```

MONZA AI **owns**: conversations, messages, channel identities, message
status, assignment, templates, automations, execution history, notification
history, the media library, AI interactions and the audit trail.

MONZA AI **never owns**: customer master records, vehicle inventory, garage
work orders, installment balances, payment records, accounting. Those are read
through adapters and remain authoritative in the source system.

## Classification

| Area | File(s) | Verdict | Note |
|---|---|---|---|
| Connector contract | `lib/connectors/types.ts` | **KEEP** | Identity pass-through + read-only enforced by types. No service-role escape hatch. Load-bearing; do not weaken. |
| Permission kernel | `lib/permissions/kernel.ts` | **KEEP** | Deny-beats-owner, fail-closed, unknown connector denied. |
| Tool loop | `lib/ai/loop.ts` | **KEEP** + BUG FIX | Audits every call incl. circuit-breaker denials. Timeout races but never cancels or clears its timer. |
| Anthropic wrapper | `lib/ai/client.ts` | **KEEP** | No SDK, failures are return values, unknown blocks echoed back. |
| Tool registry | `lib/tools/registry.ts` | **KEEP** | Closed registry; the model only sees layer-1-allowed tools. |
| Connectors (crm/installments/garage/inventory/finance) | `lib/connectors/*/index.ts` | **MOVE BEHIND DATA ADAPTER** | Correct security shape (user token only). They are AI read tools, not a second ERP — they stay, but business reads move to `lib/domain`. |
| Staff auth | `lib/auth.ts` | **SECURITY FIX** | `requireStaff` hands `DEMO_IDENTITY` to *anyone* when CRM env is absent. Safe while every surface was invented data; unsafe now real storage sits behind it. |
| Media route | `app/api/wasales-media/route.ts` | **SECURITY FIX** | World-writable and world-deletable in production (confirmed live). Also leaks `keyState`/`keyLength`/`storageSaid`. |
| AI database access | `lib/db.ts` | **BUG FIX** | No `.trim()`, no empty-string handling. Production reports `aiDbConfigured:false` though the service key works. Blocks go-live. |
| Status route | `app/api/status/route.ts` | **SECURITY FIX** | Unauthenticated configuration disclosure. |
| Connections route | `app/api/connections/route.ts` | **SECURITY FIX** | Unauthenticated connector + tool inventory disclosure. |
| Board routes | `app/api/{tracker,garage,customers,whatsapp-sales}/route.ts` | **REWORK** | Honest demo/notReady shape is right; they should serve the domain adapter instead of raw demo modules. |
| WhatsApp matcher | `lib/wasales/matcher.ts` | **KEEP** | Pure, deterministic, well-reasoned guard rails. Becomes an automation trigger in the new engine. |
| Media store | `lib/wasales/media-store.ts` | **KEEP** + REWORK | Real shared storage. Path/validation logic duplicated with the route — extract to one module. |
| Tracker contract | `lib/tracker/contract.ts` | **KEEP** | Pure message builders + money helpers. |
| `coveredCountOf` | `app/departments/installments-payments/TrackerClient.tsx:255` | **REWORK** | Cumulative-dollar math stranded in a 1323-line client component; untestable where it sits. |
| Demo data modules | `lib/{tracker/demo-month,garage/board-data,customers/directory-data,connectors/demo-data}.ts` | **MOVE BEHIND DATA ADAPTER** | One reconciled demo universe. Becomes the demo *implementation* of the source adapter, not the app's data. |
| Chat UI | `app/chat/*` | **KEEP** | The internal AI assistant stays. |
| Departments shell | `app/departments/[slug]/page.tsx`, `lib/chat/departments.ts` | **REWORK** | Department framing is replaced by the communication framing. |
| Money & Reports | department `money-reports` + `lib/connectors/finance` | **REMOVE (as a product area)** | A second reporting product. Financial questions stay answerable through the AI assistant's finance connector; the standalone page goes. |
| Garage & Vehicles board | `app/departments/garage-vehicles/*` | **REWORK** | Becomes Vehicle Updates: communication-relevant events only, not garage management. |
| Customers & Sales directory | `app/departments/customers-sales/*` | **REWORK** | Becomes customer *communication context*, not a CRM. |
| WhatsApp Sales | `app/whatsapp-sales/*` | **REWORK** | Becomes one channel of the Unified Inbox + the Sales media library. |
| Installments tracker | `app/departments/installments-payments/*` | **REWORK** | Becomes installment *follow-up*, not accounting. Never computes authoritative balances. |
| Automations | `app/automations/page.tsx` | **REWORK** | Honest placeholder today; becomes the real engine surface. |
| Dashboard / Connections / Settings | `app/{dashboard,connections,settings}` | **KEEP** | System group. |
| Migrations | `database/migrations/*.sql` | **KEEP** + extend | Correctly holds only AI-owned tables. Communication tables extend it. |
| Tests | `tests/` | **BUG FIX** | Empty directory, no runner, no script. |
| Branch `staff-assistant` | git | **REMOVE** | Stale snapshot of what `main` already is. |
| Customer-facing AI | — | **FUTURE / DO NOT IMPLEMENT YET** | Architecture left ready; explicitly out of scope. |
| Real Supabase business data | — | **FUTURE / DO NOT IMPLEMENT YET** | Adapters ship with demo implementations only. |

## Confirmed defects

1. **Anonymous write/delete on production media** (critical). `requireStaff`
   returns the demo identity to unauthenticated callers whenever CRM env is
   absent, which is the live production state. Verified against production: an
   anonymous `sign-upload` returned a valid token.
2. **`lib/db.ts` env handling** (high). Missing `.trim()`/empty-string
   handling; `/api/status` reports the AI database unconfigured although its
   service key works. Once CRM env is set, every chat answer becomes the
   "no audit trail" refusal.
3. **Diagnostic disclosure** (medium). `keyState`, `keyLength`, `storageSaid`
   returned to unauthenticated callers.
4. **Unauthenticated config/inventory disclosure** (medium) on `/api/status`
   and `/api/connections`.
5. **No tests** (medium) around money math, matcher guards and authorization.
6. **Uncancelled tool timeout** (low) in `lib/ai/loop.ts`.
7. **`carId` regex** `^[a-z0-9-]+$` (low) will reject real source-system ids.
