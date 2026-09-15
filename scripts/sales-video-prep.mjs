/**
 * Small MP4 copies of every colour video, so each one can actually be SENT
 * (Samer, 2026-09-15: "make small MP4 copies").
 *
 *     npm run sales-videos:plan   -- "C:\\Users\\you\\Desktop\\Monza AI sales"
 *     npm run sales-videos:encode -- "C:\\Users\\you\\Desktop\\Monza AI sales"
 *     npm run sales-videos:upload -- "C:\\Users\\you\\Desktop\\Monza AI sales"
 *
 *   plan    what would be made, from which file — runs nothing, writes nothing
 *   encode  makes the copies in .sales-video-send/ (git-ignored), local only
 *   upload  makes any copy still missing, then uploads each to
 *           wasales-media/<carId>/video-send/<colourId>/ — the shared library
 *
 * THREE SCRIPTS RATHER THAN A FLAG, for the reason upload-sales-folder.mjs
 * gives: npm swallows a --flag passed after --, so the flag lives inside each
 * script string.
 *
 * WHY. WhatsApp takes MP4 up to 16 MB; Messenger and Instagram 25 MB. Several
 * of Monza's colour videos are 28–121 MB, and some are .mov, which WhatsApp
 * refuses outright. Each copy is H.264 (main profile) with AAC sound, at most
 * 720 lines high, `+faststart` so a phone plays it while it downloads, at a
 * bitrate worked out from the clip's own length so the file is at most 15 MB —
 * under every channel's limit with room to spare. A copy that still comes out
 * over is made again at a lower rate, up to three times.
 *
 * The ORIGINALS are never touched or replaced: /sales keeps showing them, and
 * the inbox's suggestions send the copy (lib/wasales/library-server.ts lists
 * video-send/, and catalog.ts libraryMedia() prefers it).
 *
 * THE KEY. Uploading needs AI_SUPABASE_SERVICE_ROLE_KEY, read from the
 * environment or a git-ignored .env.local in the folder this runs from —
 * never an argument. SAFE TO RE-RUN: a copy already made is reused, one
 * already uploaded is skipped (object names are stable). Nothing is deleted.
 */

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** 15 MB: under WhatsApp's 16 MB video limit, with room for the container. */
const TARGET_BYTES = 15_000_000;
const OUT_DIR = path.join(process.cwd(), ".sales-video-send");
const MAX_TRIES = 3;

async function loadProjectModules() {
  const [paths, manifest, env] = await Promise.all([
    import("@/lib/wasales/media-paths"),
    import("@/lib/wasales/sales-manifest"),
    import("@/lib/env-public"),
  ]);
  return { paths, manifest, env };
}

/** One name from the environment, falling back to a local .env.local. */
function readSecret(name) {
  const fromEnv = (process.env[name] ?? "").trim();
  if (fromEnv !== "") return fromEnv;
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return "";
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at < 0 || line.slice(0, at).trim() !== name) continue;
    return line.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, "$2").trim();
  }
  return "";
}

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
    if (e.isDirectory() && e.name.toLowerCase() === "car models") return path.join(root, e.name);
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const found = await findCarModels(path.join(root, e.name), depth + 1);
    if (found) return found;
  }
  return null;
}

/** Every file under a directory, by file name (the manifest records names). */
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
    if (e.isDirectory()) await indexFiles(full, into, depth + 1);
    else if (!into.has(e.name)) into.set(e.name, full);
  }
  return into;
}

function mb(bytes) {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

async function durationOf(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=nw=1:nk=1",
    file,
  ]);
  const seconds = Number.parseFloat(String(stdout).trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`could not read the length of ${file}`);
  return seconds;
}

/**
 * One copy at a rate that should land under TARGET_BYTES, and never above the
 * original's own rate — a 3 MB clip must not come back as 11 MB; that is a
 * customer's mobile data. Retried lower if it still comes out over.
 */
async function encode(src, out, srcBytes) {
  const seconds = await durationOf(src);
  const sourceKbps = Math.floor((srcBytes * 8) / 1000 / seconds);
  let factor = 0.9;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const totalKbps = Math.min(Math.floor(((TARGET_BYTES * 8) / 1000 / seconds) * factor), sourceKbps);
    const audioKbps = totalKbps < 500 ? 64 : 96;
    const videoKbps = Math.max(250, Math.min(4000, totalKbps - audioKbps));
    await run(
      "ffmpeg",
      [
        "-y", "-v", "error",
        "-i", src,
        "-map", "0:v:0", "-map", "0:a:0?",
        "-c:v", "libx264", "-profile:v", "main", "-pix_fmt", "yuv420p", "-preset", "medium",
        "-b:v", `${videoKbps}k`, "-maxrate", `${Math.round(videoKbps * 1.2)}k`, "-bufsize", `${videoKbps * 2}k`,
        "-vf", "scale=-2:'min(720,ih)'",
        "-c:a", "aac", "-b:a", `${audioKbps}k`, "-ac", "2",
        "-movflags", "+faststart",
        out,
      ],
      { maxBuffer: 16 * 1024 * 1024 }
    );
    const size = (await stat(out)).size;
    if (size <= TARGET_BYTES) return { size, attempt, videoKbps };
    factor *= 0.8;
  }
  throw new Error(`still over ${mb(TARGET_BYTES)} after ${MAX_TRIES} tries`);
}

/** Stable, so a re-run produces the SAME object name and the skip works. */
function stableId(carId, colourId, fileName, bytes) {
  return createHash("sha256").update(`send/${carId}/${colourId}/${fileName}/${bytes}`).digest("hex").slice(0, 16);
}

async function listPrefix(base, bucket, key, prefix) {
  const res = await fetch(`${base}/object/list/${bucket}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
  });
  if (!res.ok) return new Set();
  const rows = await res.json();
  return new Set(Array.isArray(rows) ? rows.map((r) => (typeof r?.name === "string" ? `${prefix}/${r.name}` : "")) : []);
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes("--upload") ? "upload" : args.includes("--encode") ? "encode" : "plan";
  const root = args.find((a) => !a.startsWith("--"));
  if (!root) {
    console.error(
      [
        'Plan:    npm run sales-videos:plan   -- "<path to the Monza AI sales folder>"',
        'Encode:  npm run sales-videos:encode -- "<path to the Monza AI sales folder>"',
        'Upload:  npm run sales-videos:upload -- "<path to the Monza AI sales folder>"',
      ].join("\n")
    );
    process.exit(2);
  }

  const { paths, manifest, env } = await loadProjectModules();
  const key = mode === "upload" ? readSecret("AI_SUPABASE_SERVICE_ROLE_KEY") : "";
  if (mode === "upload" && key === "") {
    console.error("No AI_SUPABASE_SERVICE_ROLE_KEY in the environment or .env.local — nothing was uploaded.");
    process.exit(2);
  }

  const carModels = await findCarModels(path.resolve(root));
  if (!carModels) {
    console.error(`Could not find a "Car Models" folder under ${root}`);
    process.exit(2);
  }
  const onDisk = await indexFiles(carModels);
  const base = `${env.AI_URL}/storage/v1`;
  const bucket = paths.MEDIA_BUCKET;

  console.log(
    mode === "plan"
      ? "PLAN ONLY — nothing is encoded or uploaded.\n"
      : mode === "encode"
        ? `ENCODING into ${OUT_DIR} — nothing is uploaded.\n`
        : "ENCODING AND UPLOADING to the shared library.\n"
  );

  const problems = [];
  let made = 0;
  let reused = 0;
  let uploaded = 0;
  let skipped = 0;

  for (const car of manifest.SALES_MANIFEST.cars) {
    for (const colour of car.colours) {
      const existing =
        mode === "upload" ? await listPrefix(base, bucket, key, `${car.id}/video-send/${colour.id}`) : new Set();
      for (const video of colour.videos) {
        const src = onDisk.get(video.fileName);
        if (!src) {
          problems.push(`${car.id}/${colour.id}: "${video.fileName}" is in the catalogue but not on disk`);
          continue;
        }
        const srcSize = (await stat(src)).size;
        const baseName = video.fileName.replace(/\.[^.]+$/, "");
        const outName = paths.safeObjectName(`${baseName}.mp4`);
        const out = path.join(OUT_DIR, car.id, colour.id, outName);

        if (mode === "plan") {
          console.log(`  ${car.id} / ${colour.id}: ${video.fileName} (${mb(srcSize)}) → ${outName}`);
          continue;
        }

        await mkdir(path.dirname(out), { recursive: true });
        let size;
        if (existsSync(out) && (size = (await stat(out)).size) <= TARGET_BYTES) {
          reused++;
        } else {
          process.stdout.write(`  ${car.id} / ${colour.id}: ${video.fileName} (${mb(srcSize)})… `);
          try {
            const r = await encode(src, out, srcSize);
            size = r.size;
            made++;
            console.log(`${mb(r.size)}${r.attempt > 1 ? ` (try ${r.attempt})` : ""}`);
          } catch (err) {
            console.log("FAILED");
            problems.push(`${car.id}/${colour.id}: ${err instanceof Error ? err.message : String(err)}`);
            continue;
          }
        }

        if (mode !== "upload") continue;
        const objectPath = `${car.id}/video-send/${colour.id}/${stableId(car.id, colour.id, video.fileName, srcSize)}__${outName}`;
        if (existing.has(objectPath)) {
          skipped++;
          continue;
        }
        const res = await fetch(`${base}/object/${bucket}/${objectPath}`, {
          method: "POST",
          headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "video/mp4", "x-upsert": "false" },
          body: await readFile(out),
        });
        if (res.ok) {
          uploaded++;
          console.log(`    uploaded ${objectPath} (${mb(size)})`);
        } else {
          problems.push(`${objectPath}: HTTP ${res.status}`);
        }
      }
    }
  }

  console.log(
    `\nMade ${made}, reused ${reused}` + (mode === "upload" ? `, uploaded ${uploaded}, already there ${skipped}` : "") + "."
  );
  if (problems.length > 0) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exit(1);
  }
}

await main();
