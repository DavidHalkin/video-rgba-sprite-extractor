# Video → RGBA Frames → Sprite (Node.js)

Batch tool that:
1) extracts **RGBA PNG frames** from videos where each frame is packed as  
   **top half = color (RGB)** and **bottom half = masks** stored in **R/G channels**;  
2) optionally builds a **sprite atlas + JSON manifest** per video.

- Fast and robust: uses local `ffmpeg` from `@ffmpeg-installer/ffmpeg`
- Parallelizes **by videos** (`--concurrency N`)
- Flexible alpha building: `r`, `g`, `union`, `intersect`, `weighted`
- Quality controls: `levels`, `invert`, `alphaBlur`, `scale`, `fps`
- Deterministic grid-based sprite packing (great for uniform video frames)

---

## Requirements

- **Node.js** ≥ 18
- OS: Windows / macOS / Linux (works fine in WSL)
- No system FFmpeg required — the script uses `@ffmpeg-installer/ffmpeg`

> If you build very large atlases, make sure you have enough RAM and disk space (PNG frames are big).

---

## Install

```bash
# create project (or add to an existing one)
npm init -y

# deps
npm i execa fs-extra @ffmpeg-installer/ffmpeg sharp
```

Recommended `package.json` snippet:
```json
{
  "type": "module",
  "scripts": {
    "frames": "node scripts/batch_extract_rgba.js --mode union --fps 24 --concurrency 3",
    "frames:sprite": "node scripts/batch_extract_rgba.js --mode union --fps 24 --concurrency 3 --sprite true"
  }
}
```

Project layout:
```
project/
  input/                 # put your videos here (mp4/mov/mkv/webm/avi/m4v)
  output/
    frames/              # auto: RGBA PNG frames per video
    sprites/             # auto: sprite atlases + manifests
  scripts/
    batch_extract_rgba.js
```

---

## Usage

Basic extraction (max(R,G) as alpha, 24 FPS), 3 videos in parallel:
```bash
node scripts/batch_extract_rgba.js --mode union --fps 24 --concurrency 3
```

Extract + build sprites:
```bash
node scripts/batch_extract_rgba.js --mode union --fps 24 --concurrency 3 --sprite true
```

Keep source FPS (no FPS filter), weighted alpha (R 70%, G 30%), edge smoothing, levels stretch:
```bash
node scripts/batch_extract_rgba.js   --mode weighted --wr 0.7 --wg 0.3   --alphaBlur 1   --levels 16:235   --fps 0   --sprite true --spriteEvery 2 --spriteMaxWidth 4096 --spritePadding 2   --concurrency 4
```

If the mask area is **not** exactly half height (e.g., bottom 400 px):
```bash
node scripts/batch_extract_rgba.js --mode union --split 400 --sprite true
```

---

## CLI Options

### Extract options (global)

| Option | Type | Default | Description |
|---|---|---:|---|
| `--mode` | `r \| g \| union \| intersect \| weighted` | `union` | How to build alpha from R/G channels in the bottom half |
| `--wr` | number | `0.5` | Weight of **R** in `weighted` mode |
| `--wg` | number | `0.5` | Weight of **G** in `weighted` mode |
| `--invert` | `true/false` | `false` | Invert mask (use if white=background in source) |
| `--alphaBlur` | `0/1/2` | `0` | Small blur of alpha edge (anti-aliasing) |
| `--levels` | `low:high` | `0:255` | Stretch mask levels from `low..high` to `0..255` (e.g., `16:235`) |
| `--scale` | number | `1` | Uniform scale for color & alpha (e.g., `0.5` to downscale) |
| `--fps` | number | `24` | Output FPS; `0` = keep source FPS (no filter) |
| `--split` | `half` \| `<pixels>` | `half` | If the bottom mask area has exact pixel height, set it (e.g., `400`) |
| `--concurrency` | number | `min(4, CPU-1)` | How many videos to process **in parallel** |

### Sprite options (if `--sprite true`)

| Option | Type | Default | Description |
|---|---|---:|---|
| `--sprite` | `true/false` | `false` | Build a sprite atlas right after extracting frames |
| `--spriteMaxWidth` | number | `4096` | Max sheet width in pixels (grid packing) |
| `--spritePadding` | number | `2` | Spacing between frames in the atlas |
| `--spriteName` | string \| `auto` | `auto` | Output atlas name; `auto` = video basename |
| `--spriteEvery` | number | `1` | Take every N-th frame (2 = every second frame) |

---

## Output

Per video `<basename>`:

- Frames: `output/frames/<basename>/000001.png`, `000002.png`, …
- If `--sprite true`:
  - Atlas: `output/sprites/<basename>.png`
  - Manifest: `output/sprites/<basename>.json`

Manifest shape:
```json
{
  "frames": {
    "000001.png": { "x": 0, "y": 0, "w": 256, "h": 256, "index": 0 },
    "000002.png": { "x": 258, "y": 0, "w": 256, "h": 256, "index": 1 }
  },
  "meta": {
    "app": "batch_extract_rgba",
    "image": "basename.png",
    "size": { "w": 4096, "h": 1024 },
    "frameCount": 123,
    "frameSize": { "w": 256, "h": 256 },
    "padding": 2,
    "cols": 15,
    "rows": 9
  }
}
```

---

## How it works (short)

- **Top half** of each frame = color (RGB).
- **Bottom half** = mask container (R/G channels).  
  The script extracts R and/or G (`extractplanes`), combines them per `--mode`, applies `levels`/`invert`/`alphaBlur`, then `alphamerge`s the resulting mask onto the color → **RGBA**.
- Everything is done via an `ffmpeg` filter graph, then frames are written as PNG with `-pix_fmt rgba`.
- Optional sprite: images are placed into a deterministic grid using `sharp`, then an atlas PNG + JSON is generated.

---

## Performance Tips

- Use SSD; PNG writes are I/O heavy.
- Increase `--concurrency` carefully: start with **3–4** on 8-core CPUs, **6–8** on 16-core. If disk/CPU choke, dial it down.
- If sprites are huge, consider `--spriteEvery 2` (or more) to thin frames.

---

## Troubleshooting

**Frames look “shifted” or empty alpha**  
Your source might not be half split. Use `--split <pixels>` with the exact bottom area height.

**Video is rotated (top/bottom actually left/right)**  
Some videos store a `rotate=90/270` tag. Normalize first:
```bash
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,side_data_list:stream_tags=rotate -of default=nw=1 input/file.mp4
ffmpeg -y -i input/file.mp4 -vf "transpose=1" input/file_rotfix.mp4   # for rotate=90
ffmpeg -y -i input/file.mp4 -vf "transpose=2" input/file_rotfix.mp4   # for rotate=270
```
Then run the script on `*_rotfix.mp4`.

**Edges are jaggy**  
Try `--alphaBlur 1` and a reasonable `--levels` range (e.g., `16:235`).

**Alpha inverted (background shows through)**  
Add `--invert true`.

**Need only one mask channel**  
Use `--mode r` or `--mode g`.

**`sharp` install warnings**  
`sharp` downloads `libvips` automatically; ensure network access. If behind a proxy, set proper env vars.

---

## FAQ

**Q:** Can I keep original FPS?  
**A:** Yes, set `--fps 0`.

**Q:** Can I process hundreds of videos?  
**A:** Yes. Control parallelism via `--concurrency`. The script queues videos and spawns multiple `ffmpeg` processes.

**Q:** Can I pack non-uniform images into a bin-packed atlas?  
**A:** Current implementation uses a grid (frames from video are uniform). If you need bin packing, it can be added.

---

## License

MIT (or your preferred license).
