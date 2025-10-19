# video-rgba-sprite-extractor

Batch tool to turn **packed video frames** into **RGBA PNG frames** and (optionally) a **sprite atlas + JSON manifest**.

**Packed frame layout (expected):**

- **Top half** of each frame = color (**RGB**)
- **Bottom half** of each frame = mask container (**R/G channels** holding alpha information)

The script extracts the top half as color, derives the alpha from the bottom half (R/G) using several strategies, merges them into **RGBA**, and saves frames to disk. Optionally, it packs those frames into a sprite sheet (grid) with a manifest that describes coordinates.

---

## What’s in this repo

- `scripts/batch_extract_rgba.js` — the main batch script (Node.js, ES Modules)
- `package.json` — includes `"type": "module"` and one npm script (`frames:all`)
- `.gitignore` — **note**: the provided file appears to contain Markdown formatting (code fences and headers). See the **“.gitignore (recommended)”** section below for a plain version you can use.
- `package-lock.json`

Folder layout expected at runtime:

```
project-root/
  input/                      # put your videos here (mp4/mov/mkv/webm/avi/m4v)
  output/
    frames/                   # RGBA PNG frames per video
    sprites/                  # sprite atlases + manifests (if --sprite true)
  scripts/
    batch_extract_rgba.js
  package.json
  .gitignore
```

---

## Requirements

- **Node.js 18+**
- OS: Windows / macOS / Linux (WSL supported)
- No system ffmpeg required — the script uses `@ffmpeg-installer/ffmpeg` (downloads a local binary)

> Large atlases and many PNG frames are I/O and memory heavy. Prefer SSD and monitor disk space.

---

## Install

From the repo root:

```bash
npm install
# If you created the project from scratch:
# npm i execa fs-extra @ffmpeg-installer/ffmpeg sharp
```

The `package.json` (from the uploaded repo) contains:

```json
{
  "name": "png",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "frames:all": "node scripts/batch_extract_rgba.js --mode union --fps 24 --concurrency 3"
  },
  "license": "ISC",
  "dependencies": {
    "@ffmpeg-installer/ffmpeg": "^1.1.0",
    "execa": "^9.6.0",
    "fs-extra": "^11.3.2",
    "sharp": "^0.34.4"
  }
}
```

> You can add more npm scripts (see **Usage**).

---

## Usage

### 1) Put your videos into `input/`

Extensions recognized: `.mp4`, `.mov`, `.mkv`, `.webm`, `.avi`, `.m4v`.

### 2) Run extraction (example from `package.json`)

```bash
npm run frames:all
# expands to:
# node scripts/batch_extract_rgba.js --mode union --fps 24 --concurrency 3
```

### 3) Extract + build sprites in one go

```bash
node scripts/batch_extract_rgba.js --mode union --fps 24 --concurrency 3 --sprite true
```

### 4) Keep source FPS (no fps filter), use weighted alpha (R 70%, G 30%), smooth edges, stretch levels

```bash
node scripts/batch_extract_rgba.js   --mode weighted --wr 0.7 --wg 0.3   --alphaBlur 1   --levels 16:235   --fps 0   --sprite true --spriteEvery 2 --spriteMaxWidth 4096 --spritePadding 2   --concurrency 4
```

### 5) If your mask area is not exactly half height (e.g., bottom 400 px)

```bash
node scripts/batch_extract_rgba.js --mode union --split 400 --sprite true
```

### 6) Build sprites only (from already extracted / edited frames)

If you have already extracted frames (and optionally deleted or edited some), you can build the sprite atlas + JSON manifest **without re-running ffmpeg**:

```bash
# Build sprites for all subfolders in output/frames/*
node scripts/batch_extract_rgba.js --spriteOnly true

# Build sprite for one or more specific base folders
node scripts/batch_extract_rgba.js --spriteOnly true --onlyBase my_video_01,my_video_02

# You can also pass a full path to a frames folder
node scripts/batch_extract_rgba.js --spriteOnly true --onlyBase output/frames/my_video_01
```

Outputs per `<basename>`:

- Atlas: `output/sprites/<basename>.png`
- Manifest: `output/sprites/<basename>.json`

This mode is useful if you want to manually curate frames (remove unnecessary ones, reorder, etc.) before packing them into a sprite sheet.

**Outputs per video `<basename>`:**

- Frames: `output/frames/<basename>/000001.png`, `000002.png`, …
- If `--sprite true`:
  - Atlas: `output/sprites/<basename>.png`
  - Manifest: `output/sprites/<basename>.json`

---

## CLI Reference

### Extract options (global)

| Option          | Type                                       |         Default | Description                                                          |
| --------------- | ------------------------------------------ | --------------: | -------------------------------------------------------------------- |
| `--mode`        | `r \| g \| union \| intersect \| weighted` |         `union` | How to build alpha from R/G channels in the bottom half              |
| `--wr`          | number                                     |           `0.5` | Weight of **R** in `weighted` mode                                   |
| `--wg`          | number                                     |           `0.5` | Weight of **G** in `weighted` mode                                   |
| `--invert`      | `true/false`                               |         `false` | Invert mask (use if white=background in source)                      |
| `--alphaBlur`   | `0/1/2`                                    |             `0` | Light blur on alpha edge (anti-aliasing)                             |
| `--levels`      | `low:high`                                 |         `0:255` | Stretch mask levels from `low..high` to `0..255` (e.g., `16:235`)    |
| `--scale`       | number                                     |             `1` | Uniform scale for color & alpha (e.g., `0.5` to downscale)           |
| `--fps`         | number                                     |            `24` | Output FPS; `0` = keep source FPS (no filter)                        |
| `--split`       | `half` \| `<pixels>`                       |          `half` | If the bottom mask area has exact pixel height, set it (e.g., `400`) |
| `--concurrency` | number                                     | `min(4, CPU-1)` | How many videos to process **in parallel**                           |

### Sprite options (if `--sprite true`)

| Option             | Type                                  | Default | Description                                                                   |
| ------------------ | ------------------------------------- | ------: | ----------------------------------------------------------------------------- |
| `--sprite`         | `true/false`                          | `false` | Build a sprite atlas after extracting frames                                  |
| `--spriteMaxWidth` | number                                |  `4096` | Max sheet width (grid packing)                                                |
| `--spritePadding`  | number                                |     `2` | Spacing between frames in the atlas                                           |
| `--spriteName`     | string \| `auto`                      |  `auto` | Output atlas name; `auto` = video basename                                    |
| `--spriteEvery`    | number                                |     `1` | Take every N-th frame (2 = every second frame)                                |
| `--spriteOnly`     | `true/false`                          | `false` | Skip extraction, build sprite(s) only from existing frames in `output/frames` |
| `--onlyBase`       | string (comma-separated list or path) |       – | Restrict sprite build to specific base folder(s)                              |

---

## How it works (brief)

- **Top half** of each frame is cropped as the **color** image.
- **Bottom half** is cropped and split into **R** and **G** planes (`extractplanes`).  
  Depending on `--mode`, the script computes alpha from R/G:
  - `r` → use **R** only
  - `g` → use **G** only
  - `union` → `max(R, G)`
  - `intersect` → `min(R, G)`
  - `weighted` → `clamp(R*wr + G*wg, 0, 255)`
- Optional corrections to the alpha: `levels`, `invert`, `alphaBlur`.
- Color and alpha are scaled **consistently** (`--scale`) and merged via `alphamerge` → **RGBA**.
- Frames are written as PNG with `-pix_fmt rgba`.
- If `--sprite true`, images are grid-packed with `sharp` and a JSON manifest is generated.

---

## Sprite manifest shape

```json
{
  "frames": {
    "000001.png": {"x": 0, "y": 0, "w": 256, "h": 256, "index": 0},
    "000002.png": {"x": 258, "y": 0, "w": 256, "h": 256, "index": 1}
  },
  "meta": {
    "app": "batch_extract_rgba",
    "image": "basename.png",
    "size": {"w": 4096, "h": 1024},
    "frameCount": 123,
    "frameSize": {"w": 256, "h": 256},
    "padding": 2,
    "cols": 15,
    "rows": 9
  }
}
```

---

## Concurrency & performance

- `--concurrency` controls **how many videos** are processed in parallel (each spawns an ffmpeg process).  
  Inside each ffmpeg, decoding/filters already use multithreading.
- Suggested starting points:
  - 8-core CPU → `--concurrency 3–4`
  - 16-core CPU → `--concurrency 6–8`
- Use SSD; PNG encoding produces heavy disk I/O.
- Consider `--spriteEvery` to reduce atlas size and memory footprint.

---

## Troubleshooting

**Frames look “shifted” or alpha is wrong**  
Your source may not be half-split. Use `--split <pixels>` with the exact bottom area height.

**Video is rotated (top/bottom actually left/right)**  
Some videos store `rotate=90/270`. Normalize first:

```bash
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,side_data_list:stream_tags=rotate -of default=nw=1 input/file.mp4
ffmpeg -y -i input/file.mp4 -vf "transpose=1" input/file_rotfix.mp4   # rotate=90
ffmpeg -y -i input/file.mp4 -vf "transpose=2" input/file_rotfix.mp4   # rotate=270
```

Then run the script on `*_rotfix.mp4`.

**Edges are jaggy**  
Try `--alphaBlur 1` and a reasonable `--levels` (e.g., `16:235`).

**Alpha inverted (background visible)**  
Add `--invert true`.

**Need only one mask channel**  
Use `--mode r` or `--mode g`.

**`sharp` install warnings**  
`sharp` downloads `libvips`; make sure internet is available or configure proxy env vars.

---

## License

Internal project. Use freely as you like.

---

## 🇬🇧 English Addendum — Units Extraction and Sprite Export

This section describes the updated workflow for extracting animation frames and building sprites automatically
based on the configuration from `units-battle.js`.

### 🧩 Overview

The export system reads `units-battle.js`, which defines the animation phases (`idle`, `attack`, `move`, etc.)
and the frame-selection logic for each unit (`U1`, `U2`, etc.).  
If a phase does not specify its own `frames`, a global default from `config_U` is used.

### ⚙️ Global Config

At the top of `units-battle.js` you can define a global fallback rule:

```js
const config_U = {
  frames: 2, // number of central frames to take if no "frames" are specified
};
```

This ensures that even if a phase does not define its own `frames` property, a few frames
will still be picked automatically from the center of that animation segment.

### 📁 Output Structure

```
outputExtracted/
  frames/<VideoBase>/*.png      ← extracted selected frames
  sprites/<VideoBase>/<VideoBase>.png
  sprites/<VideoBase>/<VideoBase>.json
```

### 🧠 Phase Frame Syntax

In `units-battle.js`, you can describe which frames to pick:

```
frames: [1, 5, 10]        → manual list
frames: "1,10,20"         → comma-separated values
frames: "10-30"           → continuous range
frames: "10-50x5"         → every 5th frame
frames: "1,10,20-30x2,50" → mixed format
frames: "all"             → all frames in this phase
```

If no `frames` key exists — the script takes the central N frames (`config_U.frames`).

Example:

```js
attack: {
  start:  { start: 2, duration: 38, frames: "1,10,20,38" },
  cycle:  { start: 42, duration: 51, frames: "1-51x5" },
  end:    { start: 94, duration: 29, frames: [1, 15, 29] },
},
```

### 🔄 Side Cycles

Each video encodes 6 directions one after another.  
The key `side_cycle` defines how many frames belong to each direction.  
The system automatically calculates the correct global indices for every direction:

```
global = (side - 1) * side_cycle + (start - 1) + local
```

### 🚀 Running the Export

1. Extract RGBA frames once using:

   ```bash
   npm run frames:all
   # or manually:
   node scripts/batch_extract_rgba.js --mode union --fps 24 --concurrency 3
   ```

2. Configure your `units-battle.js`.

3. Run the exporter to build frames and sprites for all units automatically:
   ```bash
   node scripts/export_all_units.js
   ```

### 💬 FAQ

**Q: Do I need to re-run frame extraction every time?**  
A: No. Once RGBA frames exist in `output/frames`, only `export_all_units.js` is needed.

**Q: What happens if no phase defines `frames`?**  
A: The exporter will automatically take `config_U.frames` center frames from each phase.

**Q: Why does my U7 have only one frame?**  
A: Make sure folder names match correctly — `U7_1` → `U7_Battle`, `U7` → `U7`.

**Q: Where are results saved?**  
A: Under `outputExtracted/frames/` and `outputExtracted/sprites/`.

---
