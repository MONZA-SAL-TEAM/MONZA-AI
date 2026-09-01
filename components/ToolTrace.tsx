/**
 * The signature of the product: under every assistant answer, one chip per
 * tool call, in plain words. Staff SEE which systems were consulted — that is
 * what makes the answer trustworthy.
 *
 * Rule 8 applies here hardest: connector keys, tool names, and database
 * vocabulary never reach the screen. Keys are mapped to staff-facing labels;
 * anything unrecognised falls back to a neutral phrase, never the raw key.
 */

/**
 * The engine (lib/ai/loop.ts) emits { qualifiedName, input, rowCount, denied,
 * durationMs } and persists exactly that to messages.tool_trace — the
 * connector key is the part of qualifiedName before "__". The extra spellings
 * below keep old stored traces renderable.
 */
export interface ToolTraceEntry {
  qualifiedName?: string;
  qualified_name?: string;
  connectorKey?: string;
  connector_key?: string;
  connector?: string;
  rowCount?: number | null;
  row_count?: number | null;
  allowed?: boolean;
  denied?: boolean;
  ok?: boolean;
  error?: string | null;
}

/** "crm__search_customers" → "crm"; falls back to the loose fields. */
function keyOf(entry: ToolTraceEntry): string {
  const qualified = entry.qualifiedName ?? entry.qualified_name;
  if (typeof qualified === "string") {
    const i = qualified.indexOf("__");
    if (i > 0) return qualified.slice(0, i);
  }
  return entry.connectorKey ?? entry.connector_key ?? entry.connector ?? "";
}

const CONNECTOR_LABELS: Record<string, string> = {
  crm: "Customers & Sales",
  installments: "Installments",
  garage: "Garage & Vehicles",
  inventory: "Garage & Vehicles",
  finance: "Finance",
};

/** What one row means, per system, in a salesperson's words. */
const CONNECTOR_NOUNS: Record<string, [string, string]> = {
  crm: ["customer", "customers"],
  installments: ["record", "records"],
  garage: ["job", "jobs"],
  inventory: ["item", "items"],
  finance: ["record", "records"],
};

function connectorLabel(entry: ToolTraceEntry): string {
  return CONNECTOR_LABELS[keyOf(entry)] ?? "a connected system";
}

function rowNoun(entry: ToolTraceEntry, count: number): string {
  const nouns = CONNECTOR_NOUNS[keyOf(entry)] ?? ["result", "results"];
  return count === 1 ? nouns[0] : nouns[1];
}

function isDenied(entry: ToolTraceEntry): boolean {
  if (entry.denied === true) return true;
  if (entry.allowed === false) return true;
  return false;
}

function chipFor(entry: ToolTraceEntry): { text: string; urgent: boolean } {
  const label = connectorLabel(entry);

  if (isDenied(entry)) {
    return { text: `Not allowed: ${label}`, urgent: true };
  }

  const failed = entry.ok === false || (entry.error != null && entry.error !== "");
  if (failed) {
    return { text: `Couldn't check ${label}`, urgent: false };
  }

  const count = entry.rowCount ?? entry.row_count;
  if (typeof count === "number") {
    return { text: `Checked ${label} · ${count} ${rowNoun(entry, count)}`, urgent: false };
  }
  return { text: `Checked ${label}`, urgent: false };
}

export default function ToolTrace({ trace }: { trace: unknown }) {
  if (!Array.isArray(trace) || trace.length === 0) return null;
  const entries = trace.filter(
    (e): e is ToolTraceEntry => typeof e === "object" && e !== null
  );
  if (entries.length === 0) return null;

  return (
    <div
      className="row"
      style={{ flexWrap: "wrap", gap: 6, marginTop: 6 }}
      aria-label="What was consulted for this answer"
    >
      {entries.map((entry, i) => {
        const chip = chipFor(entry);
        return (
          <span key={i} className={chip.urgent ? "tag urgent" : "tag"}>
            {chip.text}
          </span>
        );
      })}
    </div>
  );
}
