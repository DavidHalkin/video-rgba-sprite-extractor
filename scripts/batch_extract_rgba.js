// Batch RGBA frame extractor + optional sprite builder.
// Video format: top half = color (RGB), bottom half = masks (R/G).
//
// Example:
//   node scripts/batch_extract_rgba.js --mode union --fps 24 --concurrency 3 --sprite true
//
// Extract options (global):
//   --mode r|g|union|intersect|weighted
//   --wr 0.5 --wg 0.5                 (weights for weighted mode)
//   --invert true|false               (invert alpha mask)
//   --alphaBlur 0|1|2                 (light edge smoothing on alpha)
//   --levels low:high                 (e.g. 16:235; default 0:255)
//   --scale 1                         (1 = no resize)
//   --fps 24                          (0 = keep source FPS; no fps filter)
//   --split half|<pixels>             ("half" or exact bottom height in px)
//   --concurrency N                   (how many videos to process in parallel)
//
// Sprite options:
//   --sprite true|false               (build sprite right after extraction)
//   --spriteOnly true|false           (build sprite(s) from existing frames only; no ffmpeg)
//   --onlyBase name1[,name2...]       (which base folder(s) from output/frames to pack; can be full paths)
//   --spriteMaxWidth 4096
//   --spritePadding 2
//   --spriteName auto                 (or a custom name for output atlas)
//   --spriteEvery 1                   (take every N-th frame)
// Output: output/sprites/<basename>.png + .json
//
// Folders:
//   input/                            (videos)
//   output/frames/<base>/000001.png ...
//   output/sprites/<base>.png + .json

import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import {execa} from "execa";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import sharp from "sharp";

// ---------- args ----------
const argv = process.argv.slice(2);
const get = (name, def = undefined) => {
  const idx = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (idx === -1) return def;
  const eq = argv[idx].indexOf("=");
  return eq !== -1 ? argv[idx].slice(eq + 1) : argv[idx + 1];
};

// Extract
const MODE = (get("mode", "union") + "").toLowerCase(); // r|g|union|intersect|weighted
const WR = Number(get("wr", "0.5"));
const WG = Number(get("wg", "0.5"));
const INVERT = (get("invert", "false") + "").toLowerCase() === "true";
const ALPHA_BLUR = Number(get("alphaBlur", "0")); // 0..2
const LEVELS = get("levels", "0:255");
const SCALE = Number(get("scale", "1"));
const FPS = Number(get("fps", "24")); // 0 = no fps filter
const SPLIT = get("split", "half");
const CONC = Number(get("concurrency", String(Math.max(1, Math.min(4, (os.cpus()?.length || 4) - 1)))));

// Sprite
const DO_SPRITE = (get("sprite", "false") + "").toLowerCase() === "true";
const SPRITE_ONLY = (get("spriteOnly", "false") + "").toLowerCase() === "true";
const ONLY_BASE = get("onlyBase", ""); // comma-separated basenames or absolute/relative dirs
const SPRITE_MAX_W = Number(get("spriteMaxWidth", "4096"));
const SPRITE_PADDING = Number(get("spritePadding", "2"));
const SPRITE_NAME = get("spriteName", "auto");
const SPRITE_EVERY = Math.max(1, Number(get("spriteEvery", "1")));

const INPUT_DIR = "input";
const OUTPUT_FRAMES = path.join("output", "frames");
const OUTPUT_SPRITES = path.join("output", "sprites");
const FFMPEG = ffmpegInstaller.path;

const VIDEO_EXT = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]);

// ---------- ffmpeg filter builder ----------
function buildFilter() {
  const cropTop =
    SPLIT === "half" ? "[top]crop=w=iw:h=ih/2:x=0:y=0[color]" : `[top]crop=w=iw:h=ih-${Number(SPLIT)}:x=0:y=0[color]`;

  const cropBottom =
    SPLIT === "half"
      ? "[bottom]crop=w=iw:h=ih/2:x=0:y=ih/2[mbase]"
      : `[bottom]crop=w=iw:h=${Number(SPLIT)}:x=0:y=ih-${Number(SPLIT)}[mbase]`;

  // Extract R and G planes from the bottom half (mask container)
  const extract = ["[mbase]format=rgb24,split=2[mrsrc][mgsrc]", "[mrsrc]extractplanes=r[mr]", "[mgsrc]extractplanes=g[mg]"];

  // Combine R/G into final alpha according to the mode
  let maskIn = "";
  switch (MODE) {
    case "r":
      maskIn = "[mr]";
      break;
    case "g":
      maskIn = "[mg]";
      break;
    case "union":
      // max(R, G)
      extract.push("[mr][mg]blend=all_mode=lighten[mask0]");
      maskIn = "[mask0]";
      break;
    case "intersect":
      // min(R, G)
      extract.push("[mr][mg]blend=all_mode=darken[mask0]");
      maskIn = "[mask0]";
      break;
    case "weighted":
      // clamp(R*WR + G*WG, 0, 255)
      extract.push(`[mr][mg]blend=all_expr='clamp(A*${WR}+B*${WG},0,255)'[mask0]`);
      maskIn = "[mask0]";
      break;
    default:
      throw new Error("Unknown --mode. Use r|g|union|intersect|weighted");
  }

  // Levels stretch (low:high -> 0:255)
  const [levLowStr, levHighStr] = (LEVELS || "0:255").split(":");
  const levLow = Math.max(0, Math.min(255, Number(levLowStr)));
  const levHigh = Math.max(1, Math.min(255, Number(levHighStr)));
  let maskPost = maskIn;

  if (!(levLow === 0 && levHigh === 255)) {
    // Note: applying LUT to the current single-plane mask stream
    extract.push(`${maskIn}lut='clamp((val-${levLow})*255/${Math.max(1, levHigh - levLow)},0,255)'[maskL]`);
    maskPost = "[maskL]";
  }

  // Optional invert
  if (INVERT) {
    extract.push(`${maskPost}negate[maskI]`);
    maskPost = "[maskI]";
  }

  // Optional light blur on alpha edge
  if (ALPHA_BLUR > 0) {
    extract.push(`${maskPost}boxblur=luma_radius=${ALPHA_BLUR}:luma_power=1[maskB]`);
    maskPost = "[maskB]";
  }

  // Scale color & mask together
  const scaleColor = `[color]format=rgba[color4];[color4]scale=iw*${SCALE}:ih*${SCALE}[cs]`;
  const scaleMask = `${maskPost}scale=iw*${SCALE}:ih*${SCALE}[as]`;

  // Optional FPS filter
  const fpsPart = FPS > 0 ? `[rgba]fps=${FPS}[out]` : `[rgba]null[out]`; // 'null' keeps the stream unchanged

  return [
    "[0:v]split=2[top][bottom]",
    cropTop,
    cropBottom,
    ...extract,
    scaleColor,
    scaleMask,
    "[cs][as]alphamerge[rgba]",
    fpsPart,
  ].join(";");
}

async function extractOneVideo(inputPath, outDir) {
  await fs.ensureDir(outDir);
  const filter = buildFilter();
  const args = [
    "-y",
    "-i",
    inputPath,
    "-filter_complex",
    filter,
    "-map",
    "[out]",
    "-pix_fmt",
    "rgba",
    path.join(outDir, "%06d.png"),
  ];
  const base = path.basename(inputPath);
  console.log(`→ ${base} | mode=${MODE} scale=${SCALE} fps=${FPS} levels=${LEVELS} invert=${INVERT} blur=${ALPHA_BLUR}`);
  await execa(FFMPEG, args, {stdio: "inherit"});
}

// ---------- tiny pMap with concurrency ----------
async function pMap(items, worker, concurrency) {
  const results = [];
  let i = 0,
    active = 0;
  return await new Promise((resolve, reject) => {
    const next = () => {
      if (i >= items.length && active === 0) return resolve(results);
      while (active < concurrency && i < items.length) {
        const idx = i++;
        active++;
        Promise.resolve(worker(items[idx], idx))
          .then((res) => {
            results[idx] = res;
            active--;
            next();
          })
          .catch((err) => reject(err));
      }
    };
    next();
  });
}

// ---------- sprite builder ----------
async function buildSpriteForFolder(
  framesDir,
  baseName,
  {
    outDir = OUTPUT_SPRITES,
    maxWidth = SPRITE_MAX_W,
    padding = SPRITE_PADDING,
    every = SPRITE_EVERY,
    name = SPRITE_NAME === "auto" ? baseName : SPRITE_NAME || baseName,
  } = {}
) {
  await fs.ensureDir(outDir);

  // Collect frames
  let files = (await fs.readdir(framesDir)).filter((f) => f.toLowerCase().endsWith(".png")).sort();

  // Optional thinning (every N-th frame)
  if (every > 1) {
    files = files.filter((_, i) => i % every === 0);
  }
  if (files.length === 0) {
    console.warn(`(sprite) No frames found in ${framesDir}`);
    return;
  }

  // Read first frame to get dimensions
  const firstPath = path.join(framesDir, files[0]);
  const firstMeta = await sharp(firstPath).metadata();
  const fw = firstMeta.width,
    fh = firstMeta.height;

  // Simple grid packing by max width
  const cols = Math.max(1, Math.floor((maxWidth + padding) / (fw + padding)));
  const rows = Math.ceil(files.length / cols);

  const sheetW = cols * fw + padding * (cols - 1);
  const sheetH = rows * fh + padding * (rows - 1);

  // Prepare composite layers and manifest
  const composites = [];
  const manifest = {
    frames: {}, // filename: { x, y, w, h, index }
    meta: {
      app: "batch_extract_rgba",
      image: `${name}.png`,
      size: {w: sheetW, h: sheetH},
      frameCount: files.length,
      frameSize: {w: fw, h: fh},
      padding,
      cols,
      rows,
    },
  };

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * (fw + padding);
    const y = row * (fh + padding);

    composites.push({
      input: path.join(framesDir, file),
      left: x,
      top: y,
    });

    manifest.frames[file] = {x, y, w: fw, h: fh, index: i};
  }

  // Render atlas
  const outPng = path.join(outDir, `${name}.png`);
  const outJson = path.join(outDir, `${name}.json`);

  const sheet = sharp({
    create: {
      width: sheetW,
      height: sheetH,
      channels: 4,
      background: {r: 0, g: 0, b: 0, alpha: 0}, // transparent background
    },
  });

  await sheet.composite(composites).png().toFile(outPng);
  await fs.writeJson(outJson, manifest, {spaces: 2});

  console.log(`✓ Sprite: ${outPng}`);
  console.log(`✓ Manifest: ${outJson}`);
}

// ---------- sprite-only helper ----------
async function runSpriteOnly() {
  await fs.ensureDir(OUTPUT_FRAMES);
  await fs.ensureDir(OUTPUT_SPRITES);

  // Build list of bases (either provided or scan output/frames)
  let bases = [];
  if (ONLY_BASE) {
    bases = ONLY_BASE.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else {
    const dirs = await fs.readdir(OUTPUT_FRAMES, {withFileTypes: true});
    bases = dirs.filter((d) => d.isDirectory()).map((d) => d.name);
  }

  if (bases.length === 0) {
    console.log("No frame folders found to pack (output/frames is empty).");
    return;
  }

  for (const entry of bases) {
    let framesDir;
    let baseName;

    // Allow absolute/relative paths, or just basenames under output/frames
    if (entry.includes(path.sep) || path.isAbsolute(entry)) {
      framesDir = entry;
      baseName = path.basename(entry);
    } else {
      baseName = entry;
      framesDir = path.join(OUTPUT_FRAMES, baseName);
    }

    const exists = await fs.pathExists(framesDir);
    if (!exists) {
      console.warn(`(sprite-only) Skip: ${framesDir} does not exist`);
      continue;
    }

    console.log(`(sprite-only) Packing: ${framesDir}`);
    await buildSpriteForFolder(framesDir, baseName);
  }

  console.log("\nDone (sprite-only).");
}

// ---------- main ----------
(async () => {
  await fs.ensureDir(OUTPUT_FRAMES);
  await fs.ensureDir(OUTPUT_SPRITES);

  // Sprite-only mode: skip ffmpeg/extract, just pack existing frames
  if (SPRITE_ONLY) {
    await runSpriteOnly();
    process.exit(0);
  }

  // Regular path: extract frames from input videos, then (optionally) build sprites
  const entries = await fs.readdir(INPUT_DIR).catch(() => []);
  const videos = entries.filter((f) => VIDEO_EXT.has(path.extname(f).toLowerCase())).map((f) => path.join(INPUT_DIR, f));

  if (videos.length === 0) {
    console.log("input/ is empty or no videos found (mp4/mov/mkv/webm/avi).");
    process.exit(0);
  }

  const filterStr = buildFilter();
  console.log("filter_complex:\n" + filterStr + "\n");
  console.log(`Found videos: ${videos.length}. Concurrency: ${CONC}. Sprite: ${DO_SPRITE ? "ON" : "OFF"}\n`);

  let ok = 0,
    fail = 0;
  const t0 = Date.now();

  await pMap(
    videos,
    async (videoPath) => {
      const base = path.basename(videoPath, path.extname(videoPath));
      const framesDir = path.join(OUTPUT_FRAMES, base);
      try {
        await extractOneVideo(videoPath, framesDir);
        ok++;

        if (DO_SPRITE) {
          // Build sprite from the freshly extracted frames
          await buildSpriteForFolder(framesDir, base);
        }
      } catch (err) {
        fail++;
        console.error(`✖ Error for ${base}:`, err?.shortMessage || err?.message || err);
      }
    },
    CONC
  );

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone. Success: ${ok}, failed: ${fail}. Elapsed: ${dt}s`);
})();
