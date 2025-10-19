#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * video-rgba-sprite-extractor :: clean_and_pack.js (v1.3)
 * - Анализ серий кадров (по папкам)
 * - По стартовым непустым кадрам считаем якорь (центр/низ bbox)
 * - Для всех кадров считаем максимальные вылеты относительно якоря
 * - Нормализуем размер кадра (единый canvas), кладём содержимое так, чтобы якорь оказался в центре
 * - Пакуем нормализованные кадры в спрайт через potpack с паддингом
 * - Пишем манифест (позиции в спрайте, нормализованный размер, смещения реального контента)
 *
 * Зависимости:
 *   npm i sharp potpack fast-glob yargs
 */

import fs from "node:fs/promises";
import fss from "node:fs";
import path from "node:path";
import sharp from "sharp";
import fg from "fast-glob";
import {fileURLToPath} from "node:url";
import yargs from "yargs";
import {hideBin} from "yargs/helpers";
import potpack from "potpack";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const argv = yargs(hideBin(process.argv))
  .option("src", {type: "string", default: "outputExtracted/frames", describe: "Вход: кадры по папкам (юнитам)"})
  .option("dst", {type: "string", default: "clean", describe: "Выход: clean/frames и clean/sprites"})
  .option("alpha", {type: "number", default: 1, describe: "Порог альфы 0..255 для «непустого» пикселя"})
  .option("canvasPad", {type: "number", default: 2, describe: "Внешний отступ (px) к нормализованному кадру"})
  .option("packPad", {type: "number", default: 1, describe: "Паддинг (px) между плитками в спрайте (potpack)"})
  .option("anchorFrames", {type: "number", default: 3, describe: "Сколько стартовых КОНТЕНТНЫХ кадров усреднять"})
  .option("anchorMode", {
    type: "string",
    choices: ["center", "bottom"],
    default: "center",
    describe: "Способ якоря: центр bbox или нижняя середина (baseline)",
  })
  .option("debug", {type: "boolean", default: false, describe: "Сохранить отладочные оверлеи для первых кадров"})
  .option("debugCount", {type: "number", default: 4, describe: "Сколько кадров сохранять с оверлеем"})
  .option("concurrency", {type: "number", default: 6, describe: "Параллелизм обработки изображений"})
  .strict()
  .help()
  .parse();

/* ---------------- utils ---------------- */

async function ensureDir(dir) {
  await fs.mkdir(dir, {recursive: true});
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function readRGBAInfo(pngPath) {
  const img = sharp(pngPath);
  const meta = await img.metadata();
  const buf = await img.ensureAlpha().raw().toBuffer();
  return {buf, w: meta.width, h: meta.height};
}

// tight bbox по альфе > threshold; возвращает {empty,left,top,width,height,srcW,srcH}
function bboxFromRaw({buf, w, h}, alphaThreshold) {
  let minX = w,
    minY = h,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (buf[row + x * 4 + 3] > alphaThreshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  const empty = maxX < minX || maxY < minY;
  if (empty) return {empty: true, srcW: w, srcH: h};
  return {
    empty: false,
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    srcW: w,
    srcH: h,
  };
}

function anchorPointFromBBox(bbox, mode = "center") {
  const cx = bbox.left + Math.floor(bbox.width / 2);
  const cy = bbox.top + (mode === "bottom" ? bbox.height - 1 : Math.floor(bbox.height / 2));
  return {ax: cx, ay: cy};
}

// безопасное извлечение (рамка ограничена границами исходного)
function safeRect(bbox) {
  const left = Math.max(0, bbox.left);
  const top = Math.max(0, bbox.top);
  const width = Math.max(0, Math.min(bbox.width, bbox.srcW - left));
  const height = Math.max(0, Math.min(bbox.height, bbox.srcH - top));
  return {left, top, width, height};
}

// кладём вырезку так, чтобы её якорь попал в центр нового холста
async function placeWithAnchor(srcPath, bbox, ax, ay, outW, outH, outPath) {
  const Cx = Math.floor(outW / 2);
  const Cy = Math.floor(outH / 2);

  if (bbox.empty || outW <= 0 || outH <= 0) {
    const buf = await sharp({
      create: {width: Math.max(1, outW), height: Math.max(1, outH), channels: 4, background: {r: 0, g: 0, b: 0, alpha: 0}},
    })
      .png()
      .toBuffer();
    await fs.writeFile(outPath, buf);
    return {innerW: 0, innerH: 0, innerX: Cx, innerY: Cy};
  }

  const s = safeRect(bbox);
  let crop = await sharp(srcPath).extract(s).png().toBuffer();

  // где якорь внутри нашей вырезки?
  const axLocal = ax - s.left;
  const ayLocal = ay - s.top;

  const left = Cx - axLocal;
  const top = Cy - ayLocal;

  const base = sharp({create: {width: outW, height: outH, channels: 4, background: {r: 0, g: 0, b: 0, alpha: 0}}});
  await base
    .composite([{input: crop, left, top}])
    .png()
    .toFile(outPath);

  return {innerW: s.width, innerH: s.height, innerX: left, innerY: top};
}

// простой SVG-оверлей (рамка и крест) для отладки
function debugOverlaySVG(w, h, frameW, frameH) {
  const cx = Math.floor(frameW / 2);
  const cy = Math.floor(frameH / 2);
  return Buffer.from(
    `<svg width="${frameW}" height="${frameH}" viewBox="0 0 ${frameW} ${frameH}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${frameW}" height="${frameH}" fill="none" stroke="lime" stroke-width="1"/>
  <line x1="${cx - 8}" y1="${cy}" x2="${cx + 8}" y2="${cy}" stroke="red" stroke-width="1"/>
  <line x1="${cx}" y1="${cy - 8}" x2="${cx}" y2="${cy + 8}" stroke="red" stroke-width="1"/>
</svg>`
  );
}

/* ---------------- per-unit pipeline ---------------- */

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

  // PASS A: собираем якорь из первых N КОНТЕНТНЫХ кадров; если их нет → первый непустой; если нет вообще → центр первого кадра
  const firstN = names.slice(0, Math.max(1, argv.anchorFrames));
  const anchorSamples = [];
  for (const n of firstN) {
    const info = await readRGBAInfo(path.join(unitAbs, n));
    const bb = bboxFromRaw(info, argv.alpha);
    if (!bb.empty) anchorSamples.push(anchorPointFromBBox(bb, argv.anchorMode));
  }
  if (!anchorSamples.length) {
    for (const n of names) {
      const info = await readRGBAInfo(path.join(unitAbs, n));
      const bb = bboxFromRaw(info, argv.alpha);
      if (!bb.empty) {
        anchorSamples.push(anchorPointFromBBox(bb, argv.anchorMode));
        break;
      }
    }
  }
  let ax, ay;
  if (anchorSamples.length) {
    ax = Math.round(anchorSamples.reduce((s, p) => s + p.ax, 0) / anchorSamples.length);
    ay = Math.round(anchorSamples.reduce((s, p) => s + p.ay, 0) / anchorSamples.length);
  } else {
    const info0 = await readRGBAInfo(path.join(unitAbs, names[0]));
    ax = Math.floor(info0.w / 2);
    ay = Math.floor(info0.h / 2);
  }

  // PASS B: пробегаем все кадры — считаем вылеты относительно якоря
  let leftMax = 0,
    rightMax = 0,
    upMax = 0,
    downMax = 0;
  const locals = new Array(names.length);
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const info = await readRGBAInfo(path.join(unitAbs, name));
    const bb = bboxFromRaw(info, argv.alpha);
    locals[i] = {name, bbox: bb};

    if (bb.empty) continue;
    const L = ax - bb.left;
    const R = bb.left + bb.width - 1 - ax;
    const U = ay - bb.top;
    const D = bb.top + bb.height - 1 - ay;

    leftMax = Math.max(leftMax, L);
    rightMax = Math.max(rightMax, R);
    upMax = Math.max(upMax, U);
    downMax = Math.max(downMax, D);
  }

  const pad = Math.max(0, argv.canvasPad | 0);
  const commonW = Math.max(1, leftMax + rightMax + 1 + pad * 2);
  const commonH = Math.max(1, upMax + downMax + 1 + pad * 2);

  // PASS C: нормализуем и рендерим кадры
  const recs = [];
  for (let i = 0; i < names.length; i++) {
    const {name, bbox} = locals[i];
    const src = path.join(unitAbs, name);
    const out = path.join(dstFramesDir, name);
    const placed = await placeWithAnchor(src, bbox, ax, ay, commonW, commonH, out);
    recs.push({name, outPath: out, w: commonW, h: commonH, ...placed});

    // DEBUG overlay на первых K кадрах (чтобы увидеть центр нормализованного кадра)
    if (argv.debug && i < argv.debugCount) {
      const overlay = debugOverlaySVG(placed.innerW, placed.innerH, commonW, commonH);
      const dbgOut = path.join(dstDebugDir, name);
      await sharp(out)
        .composite([{input: overlay, left: 0, top: 0}])
        .png()
        .toFile(dbgOut);
    }
  }

  // PACK: potpack
  const packPad = Math.max(0, argv.packPad | 0);
  const items = recs.map((r, i) => ({i, w: r.w + packPad, h: r.h + packPad}));
  items.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));
  const {w: sheetW, h: sheetH, fill} = potpack(items);
  items.forEach((it) => {
    const r = recs[it.i];
    r.x = it.x ?? 0;
    r.y = it.y ?? 0;
  });

  // Рендер спрайта
  const base = sharp({
    create: {width: sheetW || 1, height: sheetH || 1, channels: 4, background: {r: 0, g: 0, b: 0, alpha: 0}},
  }).png();
  const comps = await Promise.all(recs.map(async (r) => ({input: await fs.readFile(r.outPath), left: r.x, top: r.y})));
  const spritePng = path.join(dstSpritesDir, `${unitRel}.png`);
  await base.composite(comps).toFile(spritePng);

  // Манифест
  const manifest = {
    name: path.basename(spritePng),
    width: sheetW,
    height: sheetH,
    padding: packPad,
    normalizedFrame: {w: commonW, h: commonH},
    anchor: {x: Math.floor(commonW / 2), y: Math.floor(commonH / 2), sourceAx: ax, sourceAy: ay, mode: argv.anchorMode},
    fill,
    frames: Object.fromEntries(
      recs
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((r, idx) => [
          r.name,
          {
            frame: {x: r.x, y: r.y, w: r.w, h: r.h}, // где нормализованный кадр в спрайте
            sourceSize: {w: commonW, h: commonH}, // размер нормализованного кадра
            spriteSourceSize: {x: r.innerX, y: r.innerY, w: r.innerW, h: r.innerH}, // реальный контент внутри кадра
            index: idx,
          },
        ])
    ),
    meta: {
      app: "video-rgba-sprite-extractor/clean_and_pack",
      version: "1.3.0",
      folder: unitRel,
      generated: new Date().toISOString(),
      alphaThreshold: argv.alpha,
      canvasPad: argv.canvasPad,
      anchorFrames: argv.anchorFrames,
      anchorMode: argv.anchorMode,
    },
  };
  await fs.writeFile(path.join(dstSpritesDir, `${unitRel}.json`), JSON.stringify(manifest, null, 2), "utf8");

  console.log(
    `[ok] ${unitRel}: ${
      recs.length
    } frames; frame=${commonW}x${commonH}; anchor=(${ax},${ay})→center; sprite ${sheetW}x${sheetH} fill=${(fill * 100).toFixed(
      1
    )}%`
  );
}

/* ---------------- run all ---------------- */

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
    `Normalize & pack (v1.3)
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
