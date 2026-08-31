# Acceptance gate — before Monza AI touches real data

The architecture is frozen. What remains is proving it with real users.
Nothing below is optional; each item has a pass condition an outsider could
verify. Run them in order the day the configuration lands.

## Configuration required first

| Value | Where it comes from | Who provides it |
|---|---|---|
| `NEXT_PUBLIC_CRM_SUPABASE_URL` + `NEXT_PUBLIC_CRM_SUPABASE_ANON_KEY` | The Monza CRM Supabase project (public client config) | Can be pulled from the CRM project settings |
| `NEXT_PUBLIC_AI_SUPABASE_URL` + `AI_SUPABASE_SERVICE_ROLE_KEY` | A NEW Supabase project for the AI's own memory, with `database/migrations/000_core.sql` and `001_message_extras.sql` applied | Samer creates the project; the service key is a secret — pasted into Vercel by Samer, never through chat |
| `ANTHROPIC_API_KEY` | console.anthropic.com | Samer — secret, pasted into Vercel by Samer |

All five go into the Vercel project `monza-ai` → Settings → Environment
Variables (Production), then redeploy.

## Gate 1 — JWT pass-through

Sign in as a real staff member. Ask one question that touches the CRM.
**Pass:** the CRM's Supabase logs show the query authenticated as that
user's own `auth.uid()` — not `anon`, not `service_role`. The connector
code path (`makeUserClient`) sends the user's own token; this test proves
it end to end.

## Gate 2 — Two-user RLS test (the one that matters)

Pick two real users with deliberately different CRM access. Both ask the
exact same questions (overdue installments, a specific customer, garage
jobs). **Pass:** the answers differ exactly as the CRM's own RLS would
differ; the restricted user's answer contains nothing they could not see
in the CRM directly. **Fail hard** if both users ever see the same
restricted record.

## Gate 3 — Denial path

In `tool_permissions`, insert an explicit `deny` for one user on one tool
(e.g. installments). That user asks a question needing it. **Pass:**
(a) the answer says access is not included — no data;
(b) `audit_logs` has a row with `allowed = false` and the deny reason;
(c) the CRM's logs show NO corresponding query — the deny happens before
any source-system request.

## Gate 4 — Provenance retained

After a mixed question, check `audit_logs` and the stored message.
**Pass:** every tool call has connector, tool, input, allowed/denied,
row count, duration; the message's `tool_trace` matches what the user saw
on screen. No customer data lives in the audit rows beyond parameters.

## Gate 5 — Failure isolation

Temporarily break one connector (wrong CRM URL in a preview deploy, or
network-block it). Ask a question needing it. **Pass:** the answer says
that area could not be checked right now; nothing is invented; other
connectors still answer; the failed call is audited with its error.
(The 12s per-call timeout in `lib/ai/loop.ts` enforces the bound.)

## Gate 6 — Source of truth stays in the CRM

Read-only holds: the connector contract has no mutation channel, and the
grep `insert|update|upsert|delete|rpc` over `lib/connectors/` stays empty.
Deep links ("Open in Monza CRM") are a convenience layer added later —
Monza AI answers, the CRM remains the record.

## The invariant that never bends

    user identity → AI permission (layer 1) → connector → source-system
    authorization (layer 2)

No future connector gets a broad service credential as a shortcut. A
connector that cannot pass through the user's identity must model its
narrower reality honestly (and say so on the Connections page), not
borrow a service key. The contract in `lib/connectors/types.ts` is the
enforcement point — changing it is an architecture decision, not a patch.
