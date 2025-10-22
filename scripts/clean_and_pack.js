#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * video-rgba-sprite-extractor :: clean_and_pack.js (v1.8+)
 *
 * Делает:
 *  1) Нормализация PNG-кадров вокруг якоря (по первым непустым кадрам).
 *  2) Упаковка в атлас (potpack).
 *  3) (опционально) базовый манифест <unit>.json (геометрия атласа) — если WRITE_BASE_MANIFEST=true.
 *  4) <unit>.actions.json в требуемом формате:
 *       {
 *         "name": "U1",
 *         "width": <tileW>,
 *         "height": <tileH>,
 *         "idle": [ [ {x,y}, ... ], ... ]                    // 6 направлений
 *         "<phase>": {
 *           "start": [ [ {x,y}, ... ], ... ],                // 6 направлений
 *           "cycle": [ [ {x,y}, ... ], ... ],
 *           "end":   [ [ {x,y}, ... ], ... ]
 *         },
 *         ...
 *       }
 *
 * Зависимости: npm i sharp potpack fast-glob yargs
 */

import fs from "node:fs/promises";
import fss from "node:fs";
import path from "node:path";
import sharp from "sharp";
import fg from "fast-glob";
import {fileURLToPath, pathToFileURL} from "node:url";
import yargs from "yargs";
import {hideBin} from "yargs/helpers";
import potpack from "potpack";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- CLI ----------
const argv = yargs(hideBin(process.argv))
  .option("src", {type: "string", default: "outputExtracted/frames", describe: "Вход: кадры по папкам (юнитам)"})
  .option("dst", {type: "string", default: "clean", describe: "Выход: clean/frames и clean/sprites"})
  .option("alpha", {type: "number", default: 1, describe: "Порог альфы 0..255"})
  .option("canvasPad", {type: "number", default: 2, describe: "Отступ вокруг общего bbox (px)"})
  .option("packPad", {type: "number", default: 1, describe: "Паддинг между плитками (px)"})
  .option("anchorFrames", {type: "number", default: 3, describe: "Сколько стартовых непустых кадров усреднять"})
  .option("anchorMode", {
    type: "string",
    choices: ["center", "bottom"],
    default: "center",
    describe: "Где якорь в bbox: центр или нижняя середина (baseline)",
  })
  .option("debug", {type: "boolean", default: false, describe: "Сохранить debug-оверлеи для первых кадров"})
  .option("debugCount", {type: "number", default: 4, describe: "Сколько отладочных кадров"})
  .strict()
  .help()
  .parse();

// ---------- files ----------
const UNITS_FILE = path.resolve("units-battle.js"); // ESM в корне
const SIDES_COUNT = 6;

// Писать ли базовый гео-манифест <unit>.json (помимо <unit>.actions.json)
const WRITE_BASE_MANIFEST = false; // <- выключено: создаём только <unit>.actions.json

// ---------- utils ----------
async function ensureDir(dir) {
  await fs.mkdir(dir, {recursive: true});
}

async function readRGBAInfo(png) {
  const img = sharp(png);
  const meta = await img.metadata();
  const buf = await img.ensureAlpha().raw().toBuffer();
  return {buf, w: meta.width, h: meta.height};
}

function bboxFromRaw({buf, w, h}, t) {
  let minX = w,
    minY = h,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (buf[row + x * 4 + 3] > t) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  const empty = maxX < minX || maxY < minY;
  if (empty) return {empty: true, srcW: w, srcH: h};
  return {empty: false, left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1, srcW: w, srcH: h};
}

function anchorPointFromBBox(b, mode = "center") {
  const cx = b.left + Math.floor(b.width / 2);
  const cy = b.top + (mode === "bottom" ? b.height - 1 : Math.floor(b.height / 2));
  return {ax: cx, ay: cy};
}

function safeRect(b) {
  const left = Math.max(0, b.left),
    top = Math.max(0, b.top);
  const width = Math.max(0, Math.min(b.width, b.srcW - left));
  const height = Math.max(0, Math.min(b.height, b.srcH - top));
  return {left, top, width, height};
}

async function placeWithAnchor(src, bbox, ax, ay, W, H, out) {
  const Cx = Math.floor(W / 2),
    Cy = Math.floor(H / 2);
  if (bbox.empty || W <= 0 || H <= 0) {
    const buf = await sharp({
      create: {width: Math.max(1, W), height: Math.max(1, H), channels: 4, background: {r: 0, g: 0, b: 0, alpha: 0}},
    })
      .png()
      .toBuffer();
    await fs.writeFile(out, buf);
    return {innerW: 0, innerH: 0, innerX: Cx, innerY: Cy};
  }
  const s = safeRect(bbox);
  const crop = await sharp(src).extract(s).png().toBuffer();
  const axLocal = ax - s.left,
    ayLocal = ay - s.top;
  const left = Cx - axLocal,
    top = Cy - ayLocal;
  const base = sharp({create: {width: W, height: H, channels: 4, background: {r: 0, g: 0, b: 0, alpha: 0}}});
  await base
    .composite([{input: crop, left, top}])
    .png()
    .toFile(out);
  return {innerW: s.width, innerH: s.height, innerX: left, innerY: top};
}

function debugOverlaySVG(W, H) {
  const cx = Math.floor(W / 2),
    cy = Math.floor(H / 2);
  return Buffer.from(
    `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="lime" stroke-width="1"/>
  <line x1="${cx - 8}" y1="${cy}" x2="${cx + 8}" y2="${cy}" stroke="red" stroke-width="1"/>
  <line x1="${cx}" y1="${cy - 8}" x2="${cx}" y2="${cy + 8}" stroke="red" stroke-width="1"/>
</svg>`
  );
}

// ---------- units-battle helpers ----------
function isPair(o) {
  return o && Number.isInteger(o.start) && Number.isInteger(o.duration);
}

/** расплющить фазы юнита в [{label,part,start,duration}] для инициализации */
function flattenPhasesForInit(unitCfg) {
  const out = {};
  for (const [key, node] of Object.entries(unitCfg)) {
    if (key === "side_cycle" || node == null) continue;
    if (key === "idle") {
      out.idle = true;
      continue;
    }
    if (isPair(node)) {
      if (!out[key]) out[key] = new Set();
      out[key].add("start");
      continue;
    }
    for (const [subk, subv] of Object.entries(node)) {
      if (subk === "frames") continue;
      if (isPair(subv)) {
        if (!out[key]) out[key] = new Set();
        out[key].add(subk);
      } else if (subv && isPair(subv.start)) {
        if (!out[key]) out[key] = new Set();
        out[key].add(subk);
      }
    }
  }
  return out;
}

/** расплющить фазы в последовательность для поиска кадра по local */
function flattenPhasesForLookup(unitCfg) {
  const out = [];
  for (const [key, node] of Object.entries(unitCfg)) {
    if (key === "side_cycle" || node == null) continue;
    if (isPair(node)) {
      out.push({label: key, part: "start", start: node.start, duration: node.duration});
      continue;
    }
    for (const [subk, subv] of Object.entries(node)) {
      if (subk === "frames") continue;
      if (isPair(subv)) {
        out.push({label: key, part: subk, start: subv.start, duration: subv.duration});
      } else if (subv && isPair(subv.start)) {
        out.push({label: key, part: subk, start: subv.start.start, duration: subv.start.duration});
      }
    }
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

function phaseForLocal(phases, local) {
  for (const ph of phases) {
    if (local >= ph.start && local <= ph.start + ph.duration - 1) {
      return {name: ph.label, part: ph.part, phaseLocal: local - ph.start + 1};
    }
  }
  return null;
}

/** "U7_1" → "U7_Battle" | "U7" */
function matchUnitKey(folderName, keys) {
  const base = folderName.split("_")[0];
  const battle = `${base}_Battle`;
  const numbered = /^.+_\d+$/.test(folderName);
  if (numbered && keys.includes(battle)) return battle;
  if (keys.includes(base)) return base;
  return null;
}

// ---------- per-unit ----------
async function processUnit(unitAbs, unitRel, opts) {
  const names = (await fg("*.png", {cwd: unitAbs, onlyFiles: true})).sort();
  if (!names.length) {
    console.warn(`[skip] ${unitRel}: нет PNG`);
    return;
  }

  const dstFramesDir = path.join(opts.dst, "frames", unitRel);
  const dstSpritesDir = path.join(opts.dst, "sprites");
  const dstDebugDir = path.join(opts.dst, "debug", unitRel);
  await ensureDir(dstFramesDir);
  await ensureDir(dstSpritesDir);
  if (argv.debug) await ensureDir(dstDebugDir);

  // импортируем units-battle.js
  let unitsModule = null;
  if (fss.existsSync(UNITS_FILE)) {
    try {
      unitsModule = await import(pathToFileURL(UNITS_FILE).href);
    } catch (e) {
      console.warn(`[warn] Не удалось импортировать ${UNITS_FILE}: ${e.message}`);
    }
  }
  if (!unitsModule) {
    console.error(`[error] Нет ${UNITS_FILE} — не смогу построить actions.json для ${unitRel}`);
    return;
  }

  const unitKeys = Object.keys(unitsModule).filter((k) => k !== "config_U");
  const matchedKey = matchUnitKey(unitRel, unitKeys);
  if (!matchedKey) {
    console.error(`[error] ${unitRel}: нет соответствующего ключа в units-battle.js — пропуск`);
    return;
  }
  const unitCfg = unitsModule[matchedKey];
  const sideCycle = Number(unitCfg.side_cycle) || 0;

  // A) anchor
  const firstN = names.slice(0, Math.max(1, argv.anchorFrames));
  const samples = [];
  for (const n of firstN) {
    const info = await readRGBAInfo(path.join(unitAbs, n));
    const bb = bboxFromRaw(info, argv.alpha);
    if (!bb.empty) samples.push(anchorPointFromBBox(bb, argv.anchorMode));
  }
  if (!samples.length) {
    for (const n of names) {
      const info = await readRGBAInfo(path.join(unitAbs, n));
      const bb = bboxFromRaw(info, argv.alpha);
      if (!bb.empty) {
        samples.push(anchorPointFromBBox(bb, argv.anchorMode));
        break;
      }
    }
  }
  let ax, ay;
  if (samples.length) {
    ax = Math.round(samples.reduce((s, p) => s + p.ax, 0) / samples.length);
    ay = Math.round(samples.reduce((s, p) => s + p.ay, 0) / samples.length);
  } else {
    const info0 = await readRGBAInfo(path.join(unitAbs, names[0]));
    ax = Math.floor(info0.w / 2);
    ay = Math.floor(info0.h / 2);
  }

  // B) extents
  let Lm = 0,
    Rm = 0,
    Um = 0,
    Dm = 0;
  const locals = new Array(names.length);
  for (let i = 0; i < names.length; i++) {
    const file = names[i];
    const info = await readRGBAInfo(path.join(unitAbs, file));
    const bb = bboxFromRaw(info, argv.alpha);
    locals[i] = {name: file, bbox: bb};
    if (bb.empty) continue;
    const L = ax - bb.left,
      R = bb.left + bb.width - 1 - ax,
      U = ay - bb.top,
      D = bb.top + bb.height - 1 - ay;
    Lm = Math.max(Lm, L);
    Rm = Math.max(Rm, R);
    Um = Math.max(Um, U);
    Dm = Math.max(Dm, D);
  }

  const pad = Math.max(0, argv.canvasPad | 0);
  const tileW = Math.max(1, Lm + Rm + 1 + pad * 2);
  const tileH = Math.max(1, Um + Dm + 1 + pad * 2);

  // C) normalize
  const recs = [];
  for (let i = 0; i < names.length; i++) {
    const {name, bbox} = locals[i];
    const src = path.join(unitAbs, name);
    const out = path.join(dstFramesDir, name);
    const placed = await placeWithAnchor(src, bbox, ax, ay, tileW, tileH, out);
    recs.push({name, outPath: out, w: tileW, h: tileH, ...placed});
    if (argv.debug && i < argv.debugCount) {
      const overlay = debugOverlaySVG(tileW, tileH);
      await sharp(out)
        .composite([{input: overlay, left: 0, top: 0}])
        .png()
        .toFile(path.join(dstDebugDir, name));
    }
  }

  // D) pack
  const ppad = Math.max(0, argv.packPad | 0);
  const items = recs.map((r, i) => ({i, w: r.w + ppad, h: r.h + ppad}));
  items.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));
  const {w: sheetW, h: sheetH} = potpack(items);
  items.forEach((it) => {
    const r = recs[it.i];
    r.x = it.x ?? 0;
    r.y = it.y ?? 0;
  });

  const base = sharp({
    create: {width: sheetW || 1, height: sheetH || 1, channels: 4, background: {r: 0, g: 0, b: 0, alpha: 0}},
  }).png();
  const comps = await Promise.all(recs.map(async (r) => ({input: await fs.readFile(r.outPath), left: r.x, top: r.y})));
  const spritePng = path.join(dstSpritesDir, `${unitRel}.png`);
  await base.composite(comps).toFile(spritePng);

  // E) базовый гео-манифест — ТОЛЬКО если включено
  if (WRITE_BASE_MANIFEST) {
    const baseFrames = Object.fromEntries(
      recs
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((r, idx) => [r.name, {frame: {x: r.x, y: r.y, w: r.w, h: r.h}, index: idx}])
    );
    const baseManifest = {
      name: path.basename(spritePng),
      width: sheetW,
      height: sheetH,
      padding: ppad,
      tile: {w: tileW, h: tileH},
      frames: baseFrames,
      meta: {
        app: "video-rgba-sprite-extractor/clean_and_pack",
        version: "1.8.0",
        folder: unitRel,
        generated: new Date().toISOString(),
      },
    };
    await fs.writeFile(path.join(dstSpritesDir, `${unitRel}.json`), JSON.stringify(baseManifest, null, 2), "utf8");
  }

  // F) actions.json в требуемом формате
  const phasesInit = flattenPhasesForInit(unitsModule[matchedKey]);
  const phasesLookup = flattenPhasesForLookup(unitsModule[matchedKey]);

  const actions = {
    name: matchedKey, // "U1", "U13", "U7_Battle"
    width: tileW,
    height: tileH,
  };

  if (phasesInit.idle) {
    actions.idle = Array.from({length: SIDES_COUNT}, () => []);
  }
  for (const [label, parts] of Object.entries(phasesInit)) {
    if (label === "idle") continue;
    actions[label] = {};
    for (const p of parts) {
      actions[label][p] = Array.from({length: SIDES_COUNT}, () => []);
    }
  }

  const sorted = recs.sort((a, b) => a.name.localeCompare(b.name));
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const file = r.name;
    const n = parseInt(file.replace(/\D+/g, ""), 10) || i + 1;

    let side = 1,
      local = n;
    if (sideCycle > 0) {
      const zero = n - 1;
      side = Math.floor(zero / sideCycle) + 1; // 1..6
      local = (zero % sideCycle) + 1; // 1..side_cycle
    }
    if (side < 1 || side > SIDES_COUNT) continue;

    const tag = phasesLookup.length ? phaseForLocal(phasesLookup, local) : null;
    if (!tag) continue;

    if (tag.name === "idle") {
      actions.idle[side - 1].push({x: r.x, y: r.y});
      continue;
    }

    const part = tag.part || "start";
    if (!actions[tag.name]) actions[tag.name] = {};
    if (!actions[tag.name][part]) actions[tag.name][part] = Array.from({length: SIDES_COUNT}, () => []);
    actions[tag.name][part][side - 1].push({x: r.x, y: r.y});
  }

  await fs.writeFile(path.join(dstSpritesDir, `${unitRel}.actions.json`), JSON.stringify(actions, null, 2), "utf8");

  console.log(`[ok] ${unitRel}: ${recs.length} frames; tile=${tileW}x${tileH}; sprite ${sheetW}x${sheetH}`);
}

// ---------- run ----------
async function main() {
  const srcRoot = path.resolve(argv.src);
  const dstRoot = path.resolve(argv.dst);
  if (!fss.existsSync(srcRoot)) {
    console.error(`[error] Нет входной папки: ${srcRoot}`);
    process.exit(2);
  }
  await ensureDir(path.join(dstRoot, "frames"));
  await ensureDir(path.join(dstRoot, "sprites"));
  if (argv.debug) await ensureDir(path.join(dstRoot, "debug"));

  const units = (await fg("*", {cwd: srcRoot, onlyDirectories: true})).sort();
  if (!units.length) {
    console.warn(`[warn] В ${srcRoot} нет подпапок`);
    return;
  }

  console.log(
    `Normalize & pack (v1.8+)
  src: ${srcRoot}
  dst: ${dstRoot}
  alpha > ${argv.alpha}
  canvasPad = ${argv.canvasPad}
  packPad   = ${argv.packPad}
  anchorFrames = ${argv.anchorFrames}, anchorMode = ${argv.anchorMode}
  debug = ${argv.debug ? "on" : "off"}
  folders: ${units.length}`
  );

  for (const u of units) {
    await processUnit(path.join(srcRoot, u), u, {dst: dstRoot});
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
