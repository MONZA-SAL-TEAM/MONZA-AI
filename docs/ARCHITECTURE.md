# MONZA AI — Architecture Contract

The staff-facing conversational layer above the Monza systems. A staff member
asks in plain language; the assistant answers by calling **connector tools**.
This page is the contract every future connector must honour.

```
staff member ──► MONZA AI ──► connector ──► the system, AS THE SIGNED-IN USER
```

## The Connector interface

Everything the model can reach is a `Connector` (`lib/connectors/types.ts`):

```ts
interface Connector {
  key: string;          // stable: "crm", "installments", "garage", ...
  label: string;        // staff words: "Customers & Sales"
  description: string;  // one sentence for the connections screen
  status(): Promise<{ connected: boolean; detail: string }>;
  tools: ToolDefinition[];
}

interface ToolDefinition {
  name: string;                          // "overdue_installments"
  description: string;                   // written FOR the model
  inputSchema: Record<string, unknown>;  // JSON Schema, enforced by tool-use
  execute(input, ctx: ExecutionContext): Promise<ToolResult>;
}
```

The registry is **closed** (`buildRegistry`): the model may only call tools
that exist in it. A hallucinated tool name (`qualifiedName` is
`connectorKey__toolName`) returns an error result — it never executes
anything.

## Identity pass-through (the rule that is never bent)

Every CRM-family query runs with the **signed-in user's own access token**:

```ts
createClient(crmUrl, crmAnonKey, {
  global: { headers: { Authorization: `Bearer ${ctx.user.crmAccessToken}` } },
});
```

Never a service key against the CRM. The CRM's row-level security therefore
applies to every AI answer automatically. The AI's **own** database
(conversations, audit log, permissions) is the only place its service key is
used — and that database is a separate Supabase project by design.

## Two permission layers, deny wins

```
user ──► LAYER 1: Monza AI tool permission ──► LAYER 2: the system's own RLS
         (may this person use this tool          (under the person's OWN token)
          through the AI at all?)
```

- **Layer 1** (`lib/permissions/kernel.ts`, `decideToolAccess`) runs before
  every tool call: owners get everything; everyone else needs a matching CRM
  capability or an explicit grant in `tool_permissions`; an explicit **deny
  beats everything**, and an unknown connector is denied. A denial is a
  *normal outcome*: `deniedResult()` goes back to the model as a tool result,
  and is audited exactly like a success.
- **Layer 2** lives in the connected system and applies because of identity
  pass-through. Neither layer trusts the other.

**The Marketing-employee example.** A Marketing employee asks "who is overdue
on installments?" Layer 1 stops them: the `installments` connector maps to
capabilities they don't hold, so the model receives a polite denial to relay.
Even if Layer 1 were misconfigured wide open, Layer 2 would return only the
rows the CRM lets *them* see — which for Marketing is none.

**Auditing.** Every tool call — allowed or denied — writes one `audit_logs`
row: who, which tool, what input, how many rows, how long, and why it was
denied if it was.

## Read-only v1

No tool mutates a connected system. No INSERT/UPDATE/DELETE, no RPC that
writes. `ToolDefinition` deliberately has no mutation channel; write-capable
actions will be a later, separately-permissioned surface, not a flag on this
one. The AI's own `conversations`/`messages` tables are the only writes in the
product.

Two more standing rules: the model id comes from `ai_settings`
(`monza_ai.model`) or the environment, never a literal in application code;
and the staff UI speaks plain words — no connector keys, model ids, or
database vocabulary on screen.

## Adding a connector in 5 steps

1. **Create** `lib/connectors/<key>/index.ts` exporting a `Connector` with a
   stable `key`, a staff-worded `label`/`description`, and an honest
   `status()` (reachability with current configuration — no secrets in the
   detail string).
2. **Write tools** as `ToolDefinition`s: model-facing descriptions, strict
   JSON Schemas, and an `execute` that routes **every** query through
   `ctx.user.crmAccessToken` (or the equivalent per-system user credential).
   Read-only. Summarise in SQL, return compact rows.
3. **Map permissions**: add the connector key to `CONNECTOR_CAPABILITY` in
   `lib/permissions/kernel.ts` so Layer 1 knows which capability unlocks it
   (unknown keys are denied — fail closed).
4. **Register** it in the app's registry (`buildRegistry([...])`) so the chat
   route and `/api/connections` see it. The registry stays closed; nothing
   outside it is callable.
5. **Prove the properties**: demo mode works with no env vars (invented,
   clearly-labelled data — never real customer PII); a denied call returns
   `deniedResult()` and still writes an `audit_logs` row; `tsc --noEmit` is
   clean.

## External systems roadmap

Shown to staff as a quiet "coming later" row on /connections:

- **WhatsApp (One Thread)** — the customer-messaging layer becomes a
  connector: "what did we last tell this customer?" answered from thread
  history, read-only, same two layers.
- **Accounting** — invoices and ledgers, once the accounting system exposes a
  per-user credential to pass through.
- **Google Workspace** — calendar and mail lookups with each person's own
  Google identity (OAuth pass-through, same rule, different token).
- **Shipping & customs** — arrival tracking for vehicles and parts.

Each arrives the same way: a `Connector`, a capability mapping, the closed
registry — and not one of them ever holds a credential broader than the
person asking.
