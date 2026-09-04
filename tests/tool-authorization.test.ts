/**
 * Layer 1 of the assistant's two-layer permission model, and the closed
 * registry that decides a tool name is real.
 *
 * Layer 2 (the source system's own row-level security, applied because every
 * connector queries with the user's OWN token) is not testable here by design —
 * it lives in the connected system. What IS testable is that layer 1 fails
 * closed, that deny beats everything including owner, and that a hallucinated
 * tool name resolves to nothing.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  decideToolAccess,
  deniedResult,
  type ToolRule,
} from "@/lib/permissions/kernel";
import {
  buildRegistry,
  parseQualifiedName,
  qualifiedName,
  type Connector,
  type ExecutionContext,
  type StaffIdentity,
} from "@/lib/connectors/types";
import { buildMonzaRegistry, toAnthropicTools } from "@/lib/tools/registry";

function ctxFor(over: Partial<StaffIdentity> = {}): ExecutionContext {
  const user: StaffIdentity = {
    userId: "u-1",
    email: "someone@monzasal.com",
    crmAccessToken: "token",
    appRole: "employee",
    capabilities: [],
    ...over,
  };
  return { user, conversationId: null, turnId: "t-1" };
}

describe("decideToolAccess — deny wins, absence denies", () => {
  test("an owner may use any known connector", () => {
    const d = decideToolAccess(
      ctxFor({ appRole: "owner" }),
      "installments",
      "overdue_installments",
      []
    );
    assert.equal(d.allowed, true);
    assert.equal(d.reason, "owner");
  });

  test("DENY BEATS OWNER", () => {
    // An owner who denied a tool to themselves made a decision; the kernel
    // honours it rather than second-guessing it.
    const rules: ToolRule[] = [
      { connector_key: "installments", tool_name: "*", effect: "deny" },
    ];
    const d = decideToolAccess(
      ctxFor({ appRole: "owner" }),
      "installments",
      "overdue_installments",
      rules
    );
    assert.equal(d.allowed, false);
    assert.equal(d.reason, "explicitly_denied");
  });

  test("deny beats an explicit allow on the same tool", () => {
    const rules: ToolRule[] = [
      { connector_key: "garage", tool_name: "open_jobs_summary", effect: "allow" },
      { connector_key: "garage", tool_name: "open_jobs_summary", effect: "deny" },
    ];
    const d = decideToolAccess(ctxFor(), "garage", "open_jobs_summary", rules);
    assert.equal(d.allowed, false);
  });

  test("a wildcard deny covers every tool on the connector", () => {
    const rules: ToolRule[] = [
      { connector_key: "finance", tool_name: "*", effect: "deny" },
    ];
    for (const tool of ["sales_this_month", "monthly_costs_summary"]) {
      assert.equal(
        decideToolAccess(ctxFor({ appRole: "owner" }), "finance", tool, rules)
          .allowed,
        false,
        tool
      );
    }
  });

  test("a rule for one connector never leaks to another", () => {
    const rules: ToolRule[] = [
      { connector_key: "finance", tool_name: "*", effect: "deny" },
    ];
    assert.equal(
      decideToolAccess(ctxFor({ appRole: "owner" }), "garage", "x", rules)
        .allowed,
      true
    );
  });

  test("a capability the user holds opens its connector", () => {
    const d = decideToolAccess(
      ctxFor({ capabilities: ["cashier"] }),
      "installments",
      "overdue_installments",
      []
    );
    assert.equal(d.allowed, true);
    assert.equal(d.reason, "capability");
  });

  test("THE SCENARIO: marketing asking for installments is stopped at layer 1", () => {
    const d = decideToolAccess(
      ctxFor({ capabilities: ["marketing"] }),
      "installments",
      "overdue_installments",
      []
    );
    assert.equal(d.allowed, false);
    assert.equal(d.reason, "no_capability_for_connector");
  });

  test("an explicit grant works without the capability", () => {
    const rules: ToolRule[] = [
      { connector_key: "garage", tool_name: "job_lookup", effect: "allow" },
    ];
    const d = decideToolAccess(ctxFor(), "garage", "job_lookup", rules);
    assert.equal(d.allowed, true);
    assert.equal(d.reason, "explicit_grant");
    // …and grants exactly that tool, not its neighbours.
    assert.equal(
      decideToolAccess(ctxFor(), "garage", "open_jobs_summary", rules).allowed,
      false
    );
  });

  test("FAIL CLOSED: an unknown connector is denied even for a capable user", () => {
    const d = decideToolAccess(
      ctxFor({ capabilities: ["sales", "cashier", "garage"] }),
      "payroll",
      "everything",
      []
    );
    assert.equal(d.allowed, false);
    assert.equal(d.reason, "unknown_connector");
  });

  test("a user with no capabilities at all is denied everywhere", () => {
    for (const key of ["crm", "installments", "finance", "garage", "inventory"]) {
      assert.equal(
        decideToolAccess(ctxFor(), key, "anything", []).allowed,
        false,
        key
      );
    }
  });

  test("a denial is a normal result, never an exception", () => {
    const r = deniedResult({ allowed: false, reason: "explicitly_denied" });
    assert.equal(r.ok, false);
    assert.equal(r.denied, true);
    assert.match(r.error ?? "", /do not have access/);
  });

  test("a denial message never names the tool or the reason code", () => {
    for (const reason of ["explicitly_denied", "no_capability_for_connector"]) {
      const r = deniedResult({ allowed: false, reason });
      assert.doesNotMatch(r.error ?? "", /_/, "no raw reason codes reach staff");
    }
  });
});

describe("the closed registry", () => {
  const registry = buildMonzaRegistry();

  test("every connector the kernel knows about is actually registered", () => {
    const keys = registry.connectors.map((c) => c.key).sort();
    assert.deepEqual(keys, [
      "crm",
      "finance",
      "garage",
      "installments",
      "inventory",
    ]);
  });

  test("a hallucinated tool name resolves to nothing", () => {
    assert.equal(registry.find("crm", "delete_all_customers"), null);
    assert.equal(registry.find("payroll", "salaries"), null);
  });

  test("a real tool resolves", () => {
    assert.notEqual(registry.find("crm", "search_customers"), null);
  });

  test("qualified names round-trip, including underscored tool names", () => {
    const q = qualifiedName("installments", "overdue_installments");
    assert.equal(q, "installments__overdue_installments");
    assert.deepEqual(parseQualifiedName(q), {
      connectorKey: "installments",
      toolName: "overdue_installments",
    });
  });

  test("a name with no separator, or a leading one, parses to null", () => {
    assert.equal(parseQualifiedName("nodelimiter"), null);
    assert.equal(parseQualifiedName("__leading"), null);
  });

  test("no tool in the registry offers a mutation", () => {
    // Read-only v1 is enforced by the type having no mutation channel; this
    // asserts the intent survives in the names people would reach for.
    const forbidden = /(create|update|delete|insert|write|send|set)_/;
    for (const c of registry.connectors) {
      for (const t of c.tools) {
        assert.doesNotMatch(t.name, forbidden, `${c.key}__${t.name}`);
      }
    }
  });
});

describe("toAnthropicTools — the model never sees a tool it may not use", () => {
  const registry = buildMonzaRegistry();

  test("an empty allow-set offers the model nothing", () => {
    assert.deepEqual(toAnthropicTools(registry, new Set()), []);
  });

  test("only allow-set members are offered", () => {
    const allowed = new Set(["crm__search_customers"]);
    const tools = toAnthropicTools(registry, allowed);
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, "crm__search_customers");
  });

  test("every offered tool carries a schema and a described connector", () => {
    const all = new Set<string>();
    for (const c of registry.connectors) {
      for (const t of c.tools) all.add(qualifiedName(c.key, t.name));
    }
    const tools = toAnthropicTools(registry, all);
    assert.equal(tools.length, all.size);
    for (const t of tools) {
      assert.equal(typeof t.input_schema, "object");
      assert.match(t.description, /^\[.+\] /, t.name);
    }
  });

  test("an allow-set naming a tool that does not exist adds nothing", () => {
    const tools = toAnthropicTools(registry, new Set(["crm__invented"]));
    assert.deepEqual(tools, []);
  });
});

describe("buildRegistry", () => {
  test("finds nothing in an empty registry", () => {
    const empty = buildRegistry([]);
    assert.equal(empty.find("crm", "search_customers"), null);
  });

  test("does not confuse two connectors' identically-named tools", () => {
    const make = (key: string): Connector => ({
      key,
      label: key,
      description: "",
      status: async () => ({ connected: false, detail: "" }),
      tools: [
        {
          name: "lookup",
          description: key,
          inputSchema: {},
          execute: async () => ({ ok: true, data: key }),
        },
      ],
    });
    const r = buildRegistry([make("a"), make("b")]);
    assert.equal(r.find("a", "lookup")?.description, "a");
    assert.equal(r.find("b", "lookup")?.description, "b");
  });
});
