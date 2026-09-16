/**
 * Small MP4 copies of the colour videos that NEED one, so each can actually be
 * SENT (Samer: "make small MP4 copies"; 2026-09-16: "if needed make the videos
 * … smaller without affecting the videos").
 *
 *   From the sales FOLDER on this computer:
 *     npm run sales-videos:plan           -- "C:\\Users\\you\\Desktop\\Monza AI sales"
 *     npm run sales-videos:encode         -- "C:\\Users\\you\\Desktop\\Monza AI sales"
 *     npm run sales-videos:upload         -- "C:\\Users\\you\\Desktop\\Monza AI sales"
 *
 *   From the shared LIBRARY (what staff actually uploaded — the one to use):
 *     npm run sales-videos:library-plan
 *     npm run sales-videos:library-upload
 *
 *   plan    what would be made, and why — writes nothing
 *   encode  makes the copies in .sales-video-send/ (git-ignored), local only
 *   upload  makes any copy still missing, then uploads each to
 *           wasales-media/<carId>/video-send/<colourId>/
 *
 * THE FLAGS LIVE INSIDE EACH SCRIPT STRING, for the reason upload-sales-
 * folder.mjs gives: npm swallows a --flag passed after --.
 *
 * WHICH VIDEOS NEED A COPY. WhatsApp takes MP4 with H.264 video and AAC sound,
 * up to 16 MB; Messenger and Instagram 25 MB. A video that is already an MP4 of
 * H.264/AAC under 15 MB is sent as it is — re-encoding it would only lose
 * quality. Everything else (too big, .mov, another codec) gets a copy: H.264
 * main profile, AAC, at most 720 lines, `+faststart`, at a bitrate from the
 * clip's own length so it is at most 15 MB — and never above the original's
 * own rate, so a copy is never bigger than its source. A copy still over is
 * made again lower, up to three times.
 *
 * The ORIGINALS are never touched or replaced: /sales keeps showing them, and
 * the engine sends the copy (lib/wasales/library-server.ts lists video-send/,
 * catalog.ts libraryMedia() prefers it).
 *
 * THE KEY. Listing the library and uploading need AI_SUPABASE_SERVICE_ROLE_KEY,
 * from the environment or a git-ignored .env.local in the folder this runs
 * from — never an argument. SAFE TO RE-RUN: a copy already made is reused, one
 * already uploaded is skipped (object names are stable). Nothing is deleted.
 */

import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
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
const FOLDER_ID = /^[A-Za-z0-9_-]{1,64}$/;

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

/* ── Sources ─────────────────────────────────────────────────────────────── */

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

/** Every colour video named in the imported catalogue, found on this computer. */
async function folderSources(root, manifest, problems) {
  const carModels = await findCarModels(path.resolve(root));
  if (!carModels) throw new Error(`Could not find a "Car Models" folder under ${root}`);
  const onDisk = await indexFiles(carModels);
  const out = [];
  for (const car of manifest.SALES_MANIFEST.cars) {
    for (const colour of car.colours) {
      for (const video of colour.videos) {
        const src = onDisk.get(video.fileName);
        if (!src) {
          problems.push(`${car.id}/${colour.id}: "${video.fileName}" is in the catalogue but not on disk`);
          continue;
        }
        out.push({ carId: car.id, colourId: colour.id, fileName: video.fileName, bytes: (await stat(src)).size, input: src });
      }
    }
  }
  return out;
}

async function listStorage(sb, bucket, prefix) {
  const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) throw new Error(`listing ${prefix} failed: ${error.message}`);
  return Array.isArray(data) ? data : [];
}

/** Every colour video in the shared library, read by its public address. */
async function librarySources(sb, base, bucket, paths, manifest) {
  const out = [];
  // The storage API refuses to list the bucket's top level, so the cars come
  // from the catalogue; their colour folders still come from the library.
  const cars = manifest.SALES_MANIFEST.cars.map((c) => c.id).filter((id) => FOLDER_ID.test(id));
  for (const carId of cars) {
    const colours = (await listStorage(sb, bucket, `${carId}/video`))
      .filter((r) => r?.id == null && typeof r?.name === "string" && FOLDER_ID.test(r.name))
      .map((r) => r.name);
    for (const colourId of colours) {
      for (const r of await listStorage(sb, bucket, `${carId}/video/${colourId}`)) {
        if (r?.id == null || typeof r?.name !== "string" || r.name.startsWith(".")) continue;
        const objectPath = `${carId}/video/${colourId}/${r.name}`;
        out.push({
          carId,
          colourId,
          fileName: paths.displayNameOf(r.name),
          bytes: typeof r.metadata?.size === "number" ? r.metadata.size : 0,
          input: `${base}/object/public/${bucket}/${objectPath.split("/").map(encodeURIComponent).join("/")}`,
        });
      }
    }
  }
  return out;
}

/* ── Encoding ────────────────────────────────────────────────────────────── */

function mb(bytes) {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

async function probe(input) {
  const { stdout } = await run(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration,format_name:stream=codec_type,codec_name", "-of", "json", input],
    { maxBuffer: 4 * 1024 * 1024 }
  );
  const j = JSON.parse(String(stdout));
  const seconds = Number.parseFloat(j?.format?.duration);
  const streams = Array.isArray(j?.streams) ? j.streams : [];
  return {
    seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    formats: String(j?.format?.format_name ?? "").split(","),
    video: streams.find((s) => s.codec_type === "video")?.codec_name ?? null,
    audio: streams.find((s) => s.codec_type === "audio")?.codec_name ?? null,
  };
}

/** Why this video needs a copy — null when it can be sent as it is. */
function whyCopy(source, info) {
  if (source.bytes > TARGET_BYTES) return `${mb(source.bytes)} is over ${mb(TARGET_BYTES)}`;
  if (!/\.mp4$/i.test(source.fileName) || !info.formats.includes("mp4")) return "not an MP4";
  if (info.video !== "h264") return `video is ${info.video ?? "missing"}, not H.264`;
  if (info.audio && info.audio !== "aac") return `sound is ${info.audio}, not AAC`;
  return null;
}

async function encode(input, out, srcBytes, seconds) {
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
        "-i", input,
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
    if (size <= TARGET_BYTES) return { size, attempt };
    factor *= 0.8;
  }
  throw new Error(`still over ${mb(TARGET_BYTES)} after ${MAX_TRIES} tries`);
}

/** Stable, so a re-run produces the SAME object name and the skip works. */
function stableId(carId, colourId, fileName, bytes) {
  return createHash("sha256").update(`send/${carId}/${colourId}/${fileName}/${bytes}`).digest("hex").slice(0, 16);
}

/* ── The run ─────────────────────────────────────────────────────────────── */

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes("--upload") ? "upload" : args.includes("--encode") ? "encode" : "plan";
  const fromLibrary = args.includes("--library");
  const root = args.find((a) => !a.startsWith("--"));
  if (!fromLibrary && !root) {
    console.error(
      [
        'Folder:   npm run sales-videos:plan|encode|upload -- "<path to the Monza AI sales folder>"',
        "Library:  npm run sales-videos:library-plan | sales-videos:library-upload",
      ].join("\n")
    );
    process.exit(2);
  }

  const { paths, manifest, env } = await loadProjectModules();
  const key = mode === "upload" || fromLibrary ? readSecret("AI_SUPABASE_SERVICE_ROLE_KEY") : "";
  if ((mode === "upload" || fromLibrary) && key === "") {
    console.error("No AI_SUPABASE_SERVICE_ROLE_KEY in the environment or .env.local — nothing was done.");
    process.exit(2);
  }
  const base = `${env.AI_URL}/storage/v1`;
  const bucket = paths.MEDIA_BUCKET;
  const problems = [];
  const sb = key ? createClient(env.AI_URL, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

  const sources = fromLibrary
    ? await librarySources(sb, base, bucket, paths, manifest)
    : await folderSources(root, manifest, problems);

  console.log(
    `${sources.length} colour video(s) from the ${fromLibrary ? "shared library" : "sales folder"}. ` +
      (mode === "plan"
        ? "PLAN ONLY — nothing is made or uploaded.\n"
        : mode === "encode"
          ? `Copies go into ${OUT_DIR}; nothing is uploaded.\n`
          : "Copies are made and UPLOADED to the shared library.\n")
  );

  let fine = 0;
  let made = 0;
  let reused = 0;
  let uploaded = 0;
  let skipped = 0;
  const existing = new Map();

  for (const source of sources) {
    const label = `${source.carId} / ${source.colourId}: ${source.fileName} (${mb(source.bytes)})`;
    let info;
    try {
      info = await probe(source.input);
    } catch (err) {
      problems.push(`${label}: could not be read (${err instanceof Error ? err.message.split("\n")[0] : err})`);
      continue;
    }
    const why = whyCopy(source, info);
    if (!why) {
      fine++;
      console.log(`  ${label} — fine as it is`);
      continue;
    }
    if (!info.seconds) {
      problems.push(`${label}: its length could not be read`);
      continue;
    }

    const outName = paths.safeObjectName(`${source.fileName.replace(/\.[^.]+$/, "")}.mp4`);
    if (mode === "plan") {
      console.log(`  ${label} — needs a copy (${why}) → ${outName}`);
      continue;
    }

    const out = path.join(OUT_DIR, source.carId, source.colourId, outName);
    await mkdir(path.dirname(out), { recursive: true });
    let size;
    if (existsSync(out) && (size = (await stat(out)).size) <= TARGET_BYTES) {
      reused++;
    } else {
      process.stdout.write(`  ${label} — ${why} → `);
      try {
        const r = await encode(source.input, out, source.bytes, info.seconds);
        size = r.size;
        made++;
        console.log(`${mb(r.size)}${r.attempt > 1 ? ` (try ${r.attempt})` : ""}`);
      } catch (err) {
        console.log("FAILED");
        problems.push(`${label}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
        continue;
      }
    }

    if (mode !== "upload") continue;
    const prefix = `${source.carId}/video-send/${source.colourId}`;
    if (!existing.has(prefix)) {
      const rows = await listStorage(sb, bucket, prefix).catch(() => []);
      existing.set(prefix, new Set(rows.map((r) => `${prefix}/${r?.name}`)));
    }
    const objectPath = `${prefix}/${stableId(source.carId, source.colourId, source.fileName, source.bytes)}__${outName}`;
    if (existing.get(prefix).has(objectPath)) {
      skipped++;
      continue;
    }
    const { error: upErr } = await sb.storage
      .from(bucket)
      .upload(objectPath, await readFile(out), { contentType: "video/mp4", upsert: false });
    if (!upErr) {
      uploaded++;
      console.log(`    uploaded ${objectPath} (${mb(size)})`);
    } else {
      problems.push(`${objectPath}: ${upErr.message}`);
    }
  }

  console.log(
    `\nFine as they are ${fine}, copies made ${made}, reused ${reused}` +
      (mode === "upload" ? `, uploaded ${uploaded}, already there ${skipped}` : "") +
      "."
  );
  if (problems.length > 0) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exit(1);
  }
}

await main();
