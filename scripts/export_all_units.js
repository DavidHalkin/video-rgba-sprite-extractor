#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "fs-extra";
import path from "path";
import sharp from "sharp";
import {pathToFileURL} from "url";

/* ============ CONFIG ============ */
const UNITS_FILE = path.resolve("units-battle.js"); // лежит в корне
const FRAMES_IN_ROOT = path.resolve("output/frames"); // здесь уже лежат исходные PNG (000001.png…)
const OUT_ROOT = path.resolve("outputExtracted"); // сюда всё сложим
const OUT_FRAMES_ROOT = path.join(OUT_ROOT, "frames"); // копии нужных кадров
const OUT_SPRITES_ROOT = path.join(OUT_ROOT, "sprites"); // спрайты и json
const SIDES_DEFAULT = [1, 2, 3, 4, 5, 6]; // обрабатываем все 6 направлений
const SPRITE_PADDING = 2; // px
const SPRITE_MAX_W = 4096; // px
/* ================================= */

(async () => {
  // Проверим базовые директории
  await fs.ensureDir(FRAMES_IN_ROOT).catch(() => {
    console.error(`✖ Not found: ${FRAMES_IN_ROOT}. Сначала разложи видео в кадры.`);
    process.exit(1);
  });
  await fs.ensureDir(OUT_FRAMES_ROOT);
  await fs.ensureDir(OUT_SPRITES_ROOT);

  // Подтянем units-battle.js как ES-модуль (он в корне)
  let unitsMod;
  try {
    unitsMod = await import(pathToFileURL(UNITS_FILE).href);
  } catch (e) {
    console.error(`✖ Не могу импортировать ${UNITS_FILE}:`, e.message);
    process.exit(1);
  }
  const unitNames = Object.keys(unitsMod);
  console.log("∙ Загружены константы юнитов:", unitNames.join(", "));

  // Найдём все подпапки в output/frames (по одной папке на исходное видео)
  const allNames = await fs.readdir(FRAMES_IN_ROOT);
  const allStats = await Promise.all(allNames.map((n) => fs.stat(path.join(FRAMES_IN_ROOT, n))));
  const frameDirs = allNames.filter((n, i) => allStats[i].isDirectory());

  if (!frameDirs.length) {
    console.warn(`⚠ В ${FRAMES_IN_ROOT} нет подпапок с кадрами. Нечего обрабатывать.`);
    process.exit(0);
  }

  console.log("\n∙ Найдены папки с кадрами:", frameDirs.join(", "));

  // Пройдём по каждой папке (каждое "видео")
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

    // Соберём глобальные номера кадров, которые нужно взять (по frames в фазах)
    const absFrames = collectAbsoluteFrames(unitCfg, SIDES_DEFAULT);
    if (!absFrames.length) {
      console.warn(`  ⚠ В ${unitName} нет ключей "frames" в фазах — нечего экспортировать.`);
      continue;
    }

    // Копируем только нужные кадры
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

    // Собираем спрайт
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
  // base — до первого подчёркивания или всё имя, если подчёркивания нет
  const base = videoFolderName.split("_")[0];
  const battle = `${base}_Battle`;

  // Если папка имеет суффикс "_N" (например U7_1, U7_2) и есть U7_Battle — считаем это боевым набором
  const isNumbered = /^.+_\d+$/.test(videoFolderName);

  if (isNumbered && allUnits.includes(battle)) return battle; // U7_1 → U7_Battle
  if (allUnits.includes(base)) return base; // U7   → U7
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

function collectAbsoluteFrames(unitCfg, sidesArr) {
  // Список фаз, где задан frames → [{start, duration, framesSpec}, ...] (в порядке объявления)
  const phases = [];
  for (const [key, node] of Object.entries(unitCfg)) {
    if (key === "side_cycle" || !node) continue;

    // форма 1: { start, duration, frames? }
    if (isPair(node) && node.frames) {
      phases.push({start: node.start, duration: node.duration, frames: node.frames});
      continue;
    }

    // форма 2: { start:{start,duration,frames?}, cycle:{...}, end:{...}, frames? }
    // допускаем редкую вложенность вида { start: { start:{...} , frames: ... } }
    if (!isPair(node)) {
      for (const [subk, subv] of Object.entries(node)) {
        if (subk === "frames") continue;
        if (isPair(subv) && subv.frames) {
          phases.push({start: subv.start, duration: subv.duration, frames: subv.frames});
        } else if (subv && isPair(subv.start) && subv.frames) {
          phases.push({start: subv.start.start, duration: subv.start.duration, frames: subv.frames});
        }
      }
    }
  }

  if (!phases.length) return [];

  // Преобразуем локальные кадры в глобальные с учётом сторон и side_cycle
  const sideCycle = unitCfg.side_cycle;
  const result = [];
  for (const side of sidesArr) {
    const shift = (side - 1) * sideCycle;
    for (const ph of phases) {
      const picks = parseFramesSpec(ph.frames, ph.duration);
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

  await sharp({
    create: {width: outW, height: outH, channels: 4, background: {r: 0, g: 0, b: 0, alpha: 0}},
  })
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
