/**
 * Resolve the project's "@/..." import alias for `node --test`.
 *
 * The test suite deliberately has ZERO dependencies: Node 24 strips TypeScript
 * types natively, so a `.ts` module runs as-is. What Node does not know is
 * tsconfig's `paths` mapping, so every `@/lib/...` import in the modules under
 * test would fail to resolve. This hook supplies exactly that one mapping, and
 * appends the extension Node also will not guess.
 *
 * Loaded with `--import ./tests/_alias.mjs` (see package.json).
 *
 * Note for anyone adding tests: type stripping does not understand JSX, so
 * `.tsx` files cannot be imported here. That is a feature — it keeps business
 * logic in `lib/` where it belongs, instead of stranded inside a component.
 */

import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

/** "@/lib/foo" -> the first of foo.ts / foo.tsx / foo/index.ts that exists. */
function resolveAlias(specifier) {
  const base = path.join(ROOT, specifier.slice(2));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && candidate !== base) return candidate;
    if (existsSync(candidate) && path.extname(candidate) !== "") return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const resolved = resolveAlias(specifier);
      if (resolved) {
        return { url: pathToFileURL(resolved).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
