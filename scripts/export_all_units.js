#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "fs-extra";
import path from "path";
import sharp from "sharp";
import {pathToFileURL} from "url";

/* ============ CONFIG ============ */
const UNITS_FILE = path.resolve("units-battle.js"); // лежит в корне
const FRAMES_IN_ROOT = path.resolve("output/frames"); // исходные PNG (000001.png…)
const OUT_ROOT = path.resolve("outputExtracted"); // сюда всё сложим
const OUT_FRAMES_ROOT = path.join(OUT_ROOT, "frames"); // копии нужных кадров
const OUT_SPRITES_ROOT = path.join(OUT_ROOT, "sprites"); // спрайты и json
const SIDES_DEFAULT = [1, 2, 3, 4, 5, 6]; // все 6 направлений
const SPRITE_PADDING = 2; // px
const SPRITE_MAX_W = 4096; // px
/* ================================= */

(async () => {
  await fs.ensureDir(FRAMES_IN_ROOT).catch(() => {
    console.error(`✖ Not found: ${FRAMES_IN_ROOT}. Сначала разложи видео в кадры.`);
    process.exit(1);
  });
  await fs.ensureDir(OUT_FRAMES_ROOT);
  await fs.ensureDir(OUT_SPRITES_ROOT);

  // Подтягиваем units-battle.js как ES-модуль (он в корне)
  let unitsMod;
  try {
    unitsMod = await import(pathToFileURL(UNITS_FILE).href);
  } catch (e) {
    console.error(`✖ Не могу импортировать ${UNITS_FILE}:`, e.message);
    process.exit(1);
  }

  const unitNames = Object.keys(unitsMod).filter((k) => k !== "config_U");
  const defaultCenterCount = Number(unitsMod?.config_U?.frames) || 2;

  console.log("∙ Загружены константы юнитов:", unitNames.join(", "));
  console.log("∙ config_U.frames (по центру):", defaultCenterCount);

  // Сканируем все подпапки в output/frames
  const allNames = await fs.readdir(FRAMES_IN_ROOT);
  const allStats = await Promise.all(allNames.map((n) => fs.stat(path.join(FRAMES_IN_ROOT, n))));
  const frameDirs = allNames.filter((n, i) => allStats[i].isDirectory());

  if (!frameDirs.length) {
    console.warn(`⚠ В ${FRAMES_IN_ROOT} нет подпапок с кадрами. Нечего обрабатывать.`);
    process.exit(0);
  }

  console.log("\n∙ Найдены папки с кадрами:", frameDirs.join(", "));

  for (const dir of frameDirs) {
    const unitName = matchUnit(dir, unitNames);
    if (!unitName) {
      console.warn(`\n⚠ Пропуск: не смог сопоставить "${dir}" ни с одной константой (например U1 или U7_Battle).`);
      continue;
    }
    const unitCfg = unitsMod[unitName];
    if (!unitCfg || !Number.isInteger(unitCfg.side_cycle) || unitCfg.side_cycle < 1) {
      console.warn(`\n⚠ Пропуск: у "${unitName}" некорректный side_cycle.`);
      continue;
    }

    console.log(`\n▶ ${dir} → ${unitName} (side_cycle=${unitCfg.side_cycle})`);

    // Собираем глобальные номера кадров: frames-выражения ИЛИ (fallback) центр фазы
    const absFrames = collectAbsoluteFrames(unitCfg, SIDES_DEFAULT, defaultCenterCount);
    if (!absFrames.length) {
      console.warn(`  ⚠ В ${unitName} пустой набор кадров — нечего экспортировать.`);
      continue;
    }

    // Копирование
    const srcDir = path.join(FRAMES_IN_ROOT, dir);
    const dstDir = path.join(OUT_FRAMES_ROOT, dir);
    const sprDir = path.join(OUT_SPRITES_ROOT, dir);
    await fs.ensureDir(dstDir);
    await fs.ensureDir(sprDir);

    const copied = [];
    const missing = [];
    for (const n of absFrames) {
      const file = pad6(n) + ".png";
      const src = path.join(srcDir, file);
      const dst = path.join(dstDir, file);
      if (await fs.pathExists(src)) {
        await fs.copy(src, dst);
        copied.push(dst);
      } else {
        missing.push(src);
      }
    }

    if (missing.length) {
      console.warn(`  ⚠ Нет ${missing.length} кадров в ${srcDir}. Пример:`);
      for (const m of missing.slice(0, 8)) console.warn("    ", m);
    }
    if (!copied.length) {
      console.warn("  ⚠ Не скопировано ни одного кадра — спрайт собирать не из чего.");
      continue;
    }

    // Спрайт
    const spritePng = path.join(sprDir, `${dir}.png`);
    const spriteJson = path.join(sprDir, `${dir}.json`);
    await makeSprite(copied, spritePng, spriteJson);

    console.log(`  ✔ Кадры → ${dstDir}`);
    console.log(`  ✔ Спрайт → ${spritePng}`);
    console.log(`  ✔ Манифест → ${spriteJson}`);
  }

  console.log(`\n✅ Готово. Всё сложено в: ${OUT_ROOT}`);
})().catch((err) => {
  console.error("✖ Ошибка:", err.stack || err);
  process.exit(1);
});

/* ================= HELPERS ================= */

function matchUnit(videoFolderName, allUnits) {
  // "U7_1" → U7_Battle (если есть), "U7" → U7
  const base = videoFolderName.split("_")[0];
  const battle = `${base}_Battle`;
  const isNumbered = /^.+_\d+$/.test(videoFolderName);
  if (isNumbered && allUnits.includes(battle)) return battle;
  if (allUnits.includes(base)) return base;
  return null;
}

function isPair(o) {
  return o && Number.isInteger(o.start) && Number.isInteger(o.duration);
}

function parseFramesSpec(spec, dur) {
  // spec: [1,3,7] | "all" | "10-50" | "10-50x5" | "1,3,10-20x2"
  if (!spec) return [];
  if (Array.isArray(spec)) {
    return spec
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= dur)
      .sort((a, b) => a - b);
  }
  const s = String(spec).trim().toLowerCase();
  if (s === "all") return Array.from({length: dur}, (_, i) => i + 1);
  const out = new Set();
  for (const tok of s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)) {
    const m = tok.match(/^(\d+)\s*-\s*(\d+)(?:x(\d+))?$/); // 10-40x5
    if (m) {
      let a = Number(m[1]),
        b = Number(m[2]);
      if (a > b) [a, b] = [b, a];
      const step = Math.max(1, Number(m[3] || 1));
      for (let i = a; i <= b; i += step) out.add(i);
    } else if (/^\d+$/.test(tok)) {
      out.add(Number(tok));
    }
  }
  return [...out].filter((n) => n >= 1 && n <= dur).sort((a, b) => a - b);
}

/** N центральных локальных кадров (1..dur)
 *  dur=10, N=2 → [5,6]; dur=11, N=3 → [5,6,7]
 */
function centerFrames(dur, count) {
  const n = Math.max(1, Math.min(dur, Number(count) || 1));
  if (n >= dur) return Array.from({length: dur}, (_, i) => i + 1);
  const mid = (dur + 1) / 2; // центр в 1-индексации (может быть .5)
  const half = (n - 1) / 2;
  let start = Math.round(mid - half); // стараемся симметрично
  let end = start + n - 1;
  if (start < 1) {
    end += 1 - start;
    start = 1;
  }
  if (end > dur) {
    start -= end - dur;
    end = dur;
  }
  const out = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

/** собрать глобальные номера кадров с учётом:
 *  - frames-спеков (если заданы)
 *  - ИНАЧЕ центра фазы (config_U.frames)
 */
function collectAbsoluteFrames(unitCfg, sidesArr, defaultCenterCount) {
  // набираем все фазы/подфазы в порядке объявления
  const phases = [];
  for (const [key, node] of Object.entries(unitCfg)) {
    if (key === "side_cycle" || !node) continue;

    // форма 1: { start, duration, frames? }
    if (isPair(node)) {
      phases.push({start: node.start, duration: node.duration, frames: node.frames});
      continue;
    }

    // форма 2: { start:{...}, cycle:{...}, end:{...} }
    for (const [subk, subv] of Object.entries(node)) {
      if (subk === "frames") continue;
      if (isPair(subv)) {
        phases.push({start: subv.start, duration: subv.duration, frames: subv.frames});
      } else if (subv && isPair(subv.start)) {
        phases.push({start: subv.start.start, duration: subv.start.duration, frames: subv.frames});
      }
    }
  }

  if (!phases.length) return [];

  const sideCycle = unitCfg.side_cycle;
  const result = [];

  for (const side of sidesArr) {
    const shift = (side - 1) * sideCycle;

    for (const ph of phases) {
      const picks =
        ph.frames && parseFramesSpec(ph.frames, ph.duration).length
          ? parseFramesSpec(ph.frames, ph.duration)
          : centerFrames(ph.duration, defaultCenterCount);

      for (const p of picks) {
        const globalIndex = shift + (ph.start - 1) + p; // 1-индексация
        result.push(globalIndex);
      }
    }
  }

  return [...new Set(result)].sort((a, b) => a - b);
}

function pad6(n) {
  return String(n).padStart(6, "0");
}

async function makeSprite(files, outPng, outJson) {
  const pad = SPRITE_PADDING;
  const maxW = SPRITE_MAX_W;

  const meta = await sharp(files[0]).metadata();
  const W = meta.width,
    H = meta.height;

  const tileW = W + pad;
  const cols = Math.max(1, Math.floor((maxW + pad) / tileW));
  const rows = Math.ceil(files.length / cols);
  const outW = Math.min(maxW, cols * tileW - pad);
  const outH = rows * (H + pad) - pad;

  const comps = [];
  const manifest = [];
  for (let i = 0; i < files.length; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const x = col * (W + pad);
    const y = row * (H + pad);
    comps.push({input: files[i], left: x, top: y});
    manifest.push({index: i, file: path.basename(files[i]), x, y, w: W, h: H});
  }

  await sharp({create: {width: outW, height: outH, channels: 4, background: {r: 0, g: 0, b: 0, alpha: 0}}})
    .composite(comps)
    .png()
    .toFile(outPng);

  await fs.writeJSON(
    outJson,
    {
      name: path.basename(outPng),
      width: outW,
      height: outH,
      tile: {w: W, h: H, pad},
      cols,
      rows,
      frames: manifest,
    },
    {spaces: 2}
  );
}
