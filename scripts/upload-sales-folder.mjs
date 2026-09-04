/**
 * Upload the real sales folder into the shared media bucket.
 *
 *     npm run upload-sales -- "C:\\Users\\you\\Downloads\\Monza AI sales" --plan
 *     npm run upload-sales -- "C:\\Users\\you\\Downloads\\Monza AI sales"
 *
 * --plan previews and sends nothing. It is NOT called --dry-run because npm
 * claims that flag and silently declines to forward it, which once turned an
 * intended preview into a real 302 MB upload.
 *
 * WHAT THIS IS FOR. `npm run import-sales` reads the folder and writes the
 * catalogue — the models, the colours, the file names. That makes the SCREEN
 * correct, but the files themselves are still only on somebody's laptop, and a
 * file on a laptop cannot reach a customer. This puts them where the product
 * can actually send them from.
 *
 * WHY IT REUSES lib/wasales/media-paths.ts RATHER THAN BUILDING PATHS ITSELF.
 * Where a file lives IS the record of which colour it shows — there is no
 * database column saying so, deliberately, because a column can drift from the
 * object it describes and a path cannot. A second implementation of the path
 * rules here would be a second chance to get that wrong, so there isn't one:
 * this script imports buildMediaPath and runs the same code the browser does.
 *
 * THE KEY. Uploading needs the service-role key, which bypasses RLS entirely.
 * It is read from the environment or from a local, git-ignored .env.local —
 * never a command-line argument, which would put it in the shell history of
 * whoever ran this. It never leaves the machine except to Supabase itself.
 *
 * SAFE TO RE-RUN. Every existing object is listed first and anything already
 * uploaded is skipped, so an interrupted run resumes instead of duplicating.
 * Nothing is ever deleted: this script only adds.
 */

import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The project's own modules are TypeScript, and this script imports them
 * rather than restating their rules. Node runs .ts directly from 22.18 and 24
 * onward; before that it refuses the extension outright.
 *
 * Loading them DYNAMICALLY, inside a try, is the difference between a person
 * reading "update Node" and a person reading a nine-line ERR_UNKNOWN_FILE_
 * EXTENSION stack trace and concluding the tool is broken.
 */
async function loadProjectModules() {
  try {
    const [paths, manifest, env] = await Promise.all([
      import("@/lib/wasales/media-paths"),
      import("@/lib/wasales/sales-manifest"),
      import("@/lib/env-public"),
    ]);
    return { paths, manifest, env };
  } catch (err) {
    if (err?.code === "ERR_UNKNOWN_FILE_EXTENSION") {
      console.error(
        [
          `This needs Node 22.18 or newer — you are on ${process.version}.`,
          "",
          "Older versions cannot run the project's TypeScript files directly,",
          "which is also why `npm test` would fail here.",
          "",
          "Install the current LTS from https://nodejs.org and run this again.",
        ].join("\n")
      );
      process.exit(2);
    }
    throw err;
  }
}

/* ── Credentials ─────────────────────────────────────────────────────────── */

/** Read one name from the environment, falling back to a local .env.local. */
function readSecret(name) {
  const fromEnv = (process.env[name] ?? "").trim();
  if (fromEnv !== "") return fromEnv;

  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return "";
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at < 0) continue;
    if (line.slice(0, at).trim() !== name) continue;
    // Strip one layer of surrounding quotes, which .env files often carry.
    return line
      .slice(at + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2")
      .trim();
  }
  return "";
}

/* ── Finding the files on disk ───────────────────────────────────────────── */

/** The "Car Models" directory, wherever it is nested. */
async function findCarModels(root, depth = 0) {
  if (depth > 4) return null;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.toLowerCase() === "car models") return path.join(root, e.name);
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const found = await findCarModels(path.join(root, e.name), depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Every file under a directory, by file name.
 *
 * Matching by NAME rather than by rebuilding the folder layout is deliberate:
 * the manifest records names, and a colour folder that has since been renamed
 * on disk should still find its video rather than silently upload nothing.
 * Names are unique within a car in practice; where they are not, the first
 * match is reported so a person can look.
 */
async function indexFiles(dir, into = new Map(), depth = 0) {
  if (depth > 4) return into;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return into;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await indexFiles(full, into, depth + 1);
    } else if (!into.has(e.name)) {
      into.set(e.name, full);
    }
  }
  return into;
}

/* ── Supabase storage ────────────────────────────────────────────────────── */

/* Both are set in main(), once the project's modules have loaded. Module-level
   because the request helpers below are module-level too. */
/** The storage API root. */
let BASE = "";
/** The bucket name, from lib/wasales/media-paths. */
let BUCKET = "";

/** Every object already in the bucket, as a Set of full paths. */
async function listEverything(key) {
  const found = new Set();

  async function walk(prefix, depth) {
    if (depth > 3) return;
    const res = await fetch(`${BASE}/object/list/${BUCKET}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
    });
    if (!res.ok) return;
    const rows = await res.json();
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      const name = typeof row?.name === "string" ? row.name : "";
      if (name === "" || name.startsWith(".")) continue;
      const full = prefix === "" ? name : `${prefix}/${name}`;
      // A folder comes back with a null id; a real object has one.
      if (row.id === null || row.id === undefined) await walk(full, depth + 1);
      else found.add(full);
    }
  }

  await walk("", 0);
  return found;
}

async function uploadOne(key, objectPath, body, contentType) {
  const res = await fetch(`${BASE}/object/${BUCKET}/${objectPath}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": contentType,
      "x-upsert": "false",
    },
    body,
  });
  if (res.ok) return { ok: true };
  let detail = `HTTP ${res.status}`;
  try {
    const j = await res.json();
    if (j && typeof j.message === "string") detail = j.message;
  } catch {
    /* the status is all we get */
  }
  return { ok: false, error: detail };
}

/* ── The run ─────────────────────────────────────────────────────────────── */

/** A stable id for a file, so re-running produces the SAME object name and the
 *  skip-if-present check actually skips. A random uuid would re-upload the
 *  whole 555 MB every time. */
function stableId(carId, colourId, fileName, bytes) {
  return createHash("sha256")
    .update(`${carId}/${colourId ?? "-"}/${fileName}/${bytes}`)
    .digest("hex")
    .slice(0, 16);
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  const { paths, manifest, env } = await loadProjectModules();
  const {
    ALLOWED_CONTENT_TYPES,
    STORAGE_MAX_BYTES,
    buildMediaPath,
    contentTypeFor,
  } = paths;
  const { SALES_MANIFEST } = manifest;
  BASE = `${env.AI_URL}/storage/v1`;
  BUCKET = paths.MEDIA_BUCKET;

  const args = process.argv.slice(2);
  /**
   * Report what would be uploaded and where, and send nothing.
   *
   * Needs no key, so the disk half can be checked on a machine that has the
   * files but not the credentials — which is the normal case here, and is how
   * you confirm every video landed under the right colour BEFORE moving half a
   * gigabyte.
   */
  //
  // THE FLAG IS --plan, NOT --dry-run.
  //
  // npm has a --dry-run of its own and EATS it: `npm run upload-sales --
  // "<folder>" --dry-run` never forwards the flag, so the script uploads while
  // the person watching believes they are previewing. That is not theoretical
  // — it happened, with 302 MB. --plan is a name npm does not claim.
  //
  // --dry-run is still honoured for anyone running node directly, where it
  // does arrive: refusing it there would be a second surprise.
  const dryRun = args.includes("--plan") || args.includes("--dry-run");
  const root = args.find((a) => !a.startsWith("--"));
  if (!root) {
    console.error(
      [
        'Usage: npm run upload-sales -- "<path to the Monza AI sales folder>"',
        "",
        "Add --plan to preview without uploading anything.",
        "(--plan, not --dry-run: npm keeps --dry-run for itself.)",
      ].join("\n")
    );
    process.exit(2);
  }

  const key = dryRun ? "" : readSecret("AI_SUPABASE_SERVICE_ROLE_KEY");
  if (!dryRun && key === "") {
    console.error(
      [
        "No AI_SUPABASE_SERVICE_ROLE_KEY.",
        "",
        "Put it in a .env.local file in this folder (it is git-ignored):",
        "",
        "    AI_SUPABASE_SERVICE_ROLE_KEY=<the service_role key>",
        "",
        "Copy it from Supabase > project monza-ai > Settings > API Keys.",
        "Do not pass it as an argument — that lands in your shell history.",
      ].join("\n")
    );
    process.exit(2);
  }

  if (SALES_MANIFEST.cars.length === 0) {
    console.error("The catalogue is empty — run `npm run import-sales` first.");
    process.exit(2);
  }

  const carModels = await findCarModels(path.resolve(root));
  if (!carModels) {
    console.error(`Could not find a "Car Models" folder under ${root}`);
    process.exit(2);
  }
  console.log(`Reading files from ${carModels}`);

  const onDisk = await indexFiles(carModels);
  console.log(`${onDisk.size} files on disk, ${SALES_MANIFEST.cars.length} cars in the catalogue.`);

  const already = dryRun ? new Set() : await listEverything(key);
  if (dryRun) {
    console.log("PLAN ONLY — nothing will be uploaded.\n");
  } else {
    // Say plainly that this run SENDS, so a flag npm swallowed is visible
    // here rather than after half a gigabyte has already moved.
    console.log(
      `UPLOADING FOR REAL — ${already.size} object(s) already there will be skipped.\n`
    );
  }

  let uploaded = 0;
  let skipped = 0;
  let bytesSent = 0;
  const problems = [];

  /** One file: resolve it on disk, check it, upload it. */
  async function send(carId, colourId, file, kind) {
    const onDiskPath = onDisk.get(file.fileName);
    if (!onDiskPath) {
      problems.push(`${carId}: "${file.fileName}" is in the catalogue but not on disk`);
      return;
    }

    const contentType = contentTypeFor(file.fileName);
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      problems.push(`${carId}: "${file.fileName}" is not a type the bucket accepts`);
      return;
    }

    const size = (await stat(onDiskPath)).size;
    if (size > STORAGE_MAX_BYTES) {
      problems.push(
        `${carId}: "${file.fileName}" is ${mb(size)}, over the bucket's ${mb(STORAGE_MAX_BYTES)} limit`
      );
      return;
    }

    const objectPath = buildMediaPath(
      carId,
      kind,
      colourId,
      stableId(carId, colourId, file.fileName, size),
      file.fileName
    );

    if (already.has(objectPath)) {
      skipped++;
      return;
    }

    if (dryRun) {
      console.log(`  ${objectPath}  (${mb(size)})`);
      uploaded++;
      bytesSent += size;
      return;
    }

    process.stdout.write(`  ${objectPath}  (${mb(size)})… `);
    const body = await readFile(onDiskPath);
    const result = await uploadOne(key, objectPath, body, contentType);
    if (result.ok) {
      uploaded++;
      bytesSent += size;
      console.log("done");
    } else {
      console.log("FAILED");
      problems.push(`${objectPath}: ${result.error}`);
    }
  }

  for (const car of SALES_MANIFEST.cars) {
    console.log(`${car.name}`);
    for (const colour of car.colours) {
      for (const video of colour.videos) {
        await send(car.id, colour.id, video, "video");
      }
    }
    if (car.brochure) await send(car.id, null, car.brochure, "brochure");
  }

  console.log(
    dryRun
      ? `\nWould upload ${uploaded} file(s), ${mb(bytesSent)}.`
      : `\nUploaded ${uploaded} file(s), ${mb(bytesSent)}. Skipped ${skipped} already there.`
  );
  if (problems.length > 0) {
    console.log(`\n${problems.length} thing(s) a person should look at:`);
    for (const p of problems) console.log(`  - ${p}`);
  }
  // Problems are reported, not fatal: a run that uploaded 40 of 42 files has
  // done real work, and exiting non-zero would hide it behind a failure.
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
