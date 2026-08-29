# Lightroom Lite — v1 Build Specification

**Status:** ready to build · **Scope:** minimal v1 only · **Audience:** implementing agent (Claude Code)
**Last updated:** 2026-08-27

---

## 0. How to use this document

This is an implementation spec, not a discussion document. Build exactly what is in
§2 "In scope". Anything in §3 "Explicitly out of scope" must **not** be built, even if it
seems easy — v1 ships first.

Every phase in §14 has acceptance criteria. Do not move to the next phase until the
current one passes its criteria in a real browser with real RAW files.

---

## 1. What we are building

A single-page, no-login, entirely client-side photo editor for culling and adjusting a
batch of RAW photos straight off an SD card.

The core loop, and the only loop that matters in v1:

> Point it at a folder → it decodes previews → you step through photos one at a time with
> the arrow keys, flag keepers, push a dozen sliders → you export the keepers as JPEG /
> PNG / WebP / PDF → you hit **Finish** and everything is wiped from the browser.

Nothing is uploaded. There is no server. There is no account. The app is static files.

### Design north star
Adobe Lightroom's **Edit → Light / Color / Effects** panels are the reference for slider
naming, direction and feel. Match Lightroom's slider *names* and *sign convention*
(right = more / brighter) so the tool feels familiar. Do not match Lightroom's depth —
v1 is a dozen global sliders, no masking, no curves.

---

## 2. In scope for v1

### 2.1 Import
- Pick a folder via `showDirectoryPicker()` (Chromium) with a `<input type="file" webkitdirectory multiple>` fallback.
- Drag-and-drop a folder or a multi-file selection onto the window.
- Accepted extensions (case-insensitive):
  `.cr2 .cr3 .nef .nrw .arw .srf .sr2 .orf .raf .rw2 .pef .dng .3fr .iiq .raw`
  plus `.jpg .jpeg .png .webp .tif .tiff` (non-RAW files skip the decoder and load directly).
- Everything else in the folder is ignored silently; show a one-line summary toast:
  `Imported 148 photos · skipped 12 unsupported files`.

### 2.2 Cull
- Vertical filmstrip of thumbnails on the left, current photo highlighted.
- Flag states: **Pick / Unflagged / Reject** — `P` / `U` / `X`, matching Lightroom Classic.
- Rejected photos render dimmed at 40% opacity in the filmstrip.
- Filter chips: `All` · `Picked` · `Unflagged` · `Rejected`. Arrow-key navigation respects the active filter.

### 2.3 Edit — the v1 slider set

| Panel | Slider | Range | Default | Notes |
|---|---|---|---|---|
| Light | Exposure | −5.0 … +5.0 | 0 | in EV (stops), step 0.05 |
| Light | Contrast | −100 … +100 | 0 | S-curve around mid-grey |
| Light | Highlights | −100 … +100 | 0 | negative recovers |
| Light | Shadows | −100 … +100 | 0 | positive opens up |
| Light | Whites | −100 … +100 | 0 | white point |
| Light | Blacks | −100 … +100 | 0 | black point |
| Color | Temperature | −100 … +100 | 0 | right = warmer |
| Color | Tint | −100 … +100 | 0 | right = magenta |
| Color | Vibrance | −100 … +100 | 0 | weighted to muted colours |
| Color | Saturation | −100 … +100 | 0 | uniform |
| Effects | Clarity | −100 … +100 | 0 | large-radius local contrast |
| Effects | Sharpness | 0 … 100 | 0 | small-radius unsharp mask |
| Effects | Vignette | −100 … +100 | 0 | positive darkens corners |

Plus non-slider transforms: **Rotate 90° CW / CCW** and **Flip horizontal**.

### 2.4 Compare and undo
- Hold `B` (or click the eye icon) → shows the unedited photo. Release → back to edited.
- Per-photo undo/redo stack, 50 deep, `⌘Z` / `⌘⇧Z`.
- `Reset` button per panel section and a global `Reset all` (`0`).

### 2.5 Export
- Formats: **JPEG**, **PNG**, **WebP**, **PDF**.
- Options: quality (JPEG/WebP), resize by long edge (`Original / 4096 / 2560 / 2048 / 1600 / 1024`), filename pattern.
- Scope: **Current photo** or **All picked**.
- Export renders from a **full-resolution** decode, not from the on-screen proxy.
- PDF: one image per page, page sized to the image, via `pdf-lib`.

### 2.6 Storage and lifetime
- Everything local. See §7.
- A project expires **30 days after it was last opened** and is deleted on the next app start.
- A **Finish & wipe project** button ends the project immediately and deletes all its data.

---

## 3. Explicitly out of scope for v1

Do not build these. They are listed so the architecture leaves room, not so you implement them.

Crop and straighten · tone curve · HSL / colour mixer · colour grading · masking (linear,
radial, brush, AI subject/sky) · noise reduction · lens profile and chromatic-aberration
correction · presets and preset import · copy/paste or sync settings across photos ·
star ratings and colour labels · multiple simultaneous projects · virtual copies ·
histogram scrubbing · TIFF export · EXIF editing · print layout · undo across photos ·
mobile/touch layout (desktop only in v1).

---

## 4. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Build | **Vite 7 + React 19 + TypeScript 5** | Static SPA, no server, instant HMR |
| UI kit | **shadcn/ui** (Tailwind CSS v4) | Requested; own the component source |
| State | **Zustand** | Small, no boilerplate, works fine outside React (workers, GL loop) |
| RAW decode | **`libraw-wasm`** in a Web Worker | Only maintained browser LibRaw build with a clean async API |
| Metadata | **`exifr`** | 22 KB gzipped, no deps — for the JPEG/TIFF/PNG import path only; RAW metadata comes from LibRaw |
| Rendering | **WebGL2**, hand-written shaders | 60 fps slider dragging; no library needed for this pipeline |
| Metadata store | **IndexedDB** via **`idb`** | Structured records, indexes, transactions |
| Binary store | **OPFS** (`navigator.storage.getDirectory()`) | Real filesystem, sync writes in workers, no serialisation overhead |
| PDF | **`pdf-lib`** | Pure JS, embeds JPEG/PNG directly |
| Zip (batch fallback) | **`fflate`** | 8 KB, streaming |

### 4.1 Why not localStorage or cookies
The brief said "cookies or local storage". Both are the wrong tool and must not be used
for image data:

- **localStorage is capped at ~5 MiB per origin** across all browsers, and is synchronous
  and string-only. One 24 MP RAW file is 25–60 MB.
- **Cookies are capped at ~4 KB each** and are sent on every HTTP request.

Use them only for pointers. The actual plan is in §7: **OPFS for bytes, IndexedDB for
records, localStorage for two small keys.** All three are local-only and wiped by the same
"clear site data" action, so the privacy guarantee the brief asked for is unchanged.

### 4.2 Project setup

```bash
pnpm create vite@latest lightroom-lite -- --template react-ts
cd lightroom-lite
pnpm add tailwindcss @tailwindcss/vite
pnpm add -D @types/node
# src/index.css  ->  @import "tailwindcss";
# tsconfig.json + tsconfig.app.json -> baseUrl "." , paths { "@/*": ["./src/*"] }
# vite.config.ts -> tailwindcss() plugin + resolve.alias "@" -> ./src
# shadcn now ships both Radix and Base UI primitives; `init` will ask which to use.
# Either is fine — pick Base UI. If `init` is unavailable in your CLI version,
# use `pnpm dlx shadcn@latest create` and follow the prompts.
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add button slider label input select separator scroll-area \
  accordion dialog alert-dialog dropdown-menu tooltip badge progress skeleton \
  toggle toggle-group switch sonner resizable card

pnpm add libraw-wasm exifr zustand idb pdf-lib fflate
```

Vite config additions:

```ts
optimizeDeps: { exclude: ['libraw-wasm'] },   // dev-time only: keeps esbuild's
                                              // pre-bundler from mangling the wasm URL
worker: { format: 'es' },
```

The real build-time requirement is different and more important: `libraw-wasm` resolves its
binary at runtime with `new URL('libraw.wasm', import.meta.url)` + `instantiateStreaming`.
**Verify after `pnpm build` that `dist/` actually contains `worker.js` and `libraw.wasm`
and that both resolve at the deployed base path.** This is the single most likely
"works in dev, broken in prod" failure in this project.

`.glsl` files do not import as strings by default. Either use Vite's `?raw` suffix
(`import frag from './shaders/base.frag.glsl?raw'`) or add a glsl plugin. Pick `?raw` — one
less dependency.

COOP/COEP headers are only needed for `SharedArrayBuffer`; v1 does not use it.

---

## 5. File tree

```
src/
  main.tsx
  App.tsx
  index.css
  components/
    ui/                        # shadcn generated — do not hand-edit
    layout/
      TopBar.tsx               # project name, counts, storage meter, expiry badge, actions
      Workspace.tsx            # ResizablePanelGroup: filmstrip | viewer | inspector
    import/
      DropZone.tsx             # empty state + drag/drop target
      ImportProgress.tsx       # Progress + per-file status
    filmstrip/
      Filmstrip.tsx            # ScrollArea, virtualised
      FilmstripItem.tsx        # thumb, flag pill, filename
      FilterChips.tsx          # ToggleGroup: All/Picked/Unflagged/Rejected
    viewer/
      Viewer.tsx               # canvas host, fit-to-window, loading states
      ViewerToolbar.tsx        # flag buttons, rotate/flip, before/after, reset
      Histogram.tsx            # read-only RGB histogram from GL readback
    inspector/
      Inspector.tsx            # ScrollArea + Accordion
      SliderRow.tsx            # THE key control — see §11.3
      LightPanel.tsx
      ColorPanel.tsx
      EffectsPanel.tsx
    export/
      ExportDialog.tsx
      ExportProgress.tsx
    project/
      FinishProjectDialog.tsx  # AlertDialog: export reminder + wipe confirm
      ExpiryBanner.tsx
  engine/
    gl/
      renderer.ts              # WebGL2 context, 3 render targets, 4-pass draw
      programs.ts              # compile/link/cache, uniform location cache
      shaders/
        quad.vert.glsl
        base.frag.glsl         # pass 1 — WB, exposure, tone, contrast
        blur.frag.glsl         # passes 2 & 3 — separable gaussian
        finish.frag.glsl       # pass 4 — clarity, sharpen, vibrance, sat, vignette
    decode/
      rawDecoder.ts            # libraw-wasm wrapper (the lib spawns its own worker — §8.3)
      decoderPool.ts           # N long-lived LibRaw instances, task queue, cancellation
      decodeTypes.ts           # message contracts
    export/
      encode.ts                # OffscreenCanvas -> Blob for jpeg/png/webp
      pdf.ts                   # pdf-lib assembly
      save.ts                  # File System Access dir picker / anchor fallback
  store/
    projectStore.ts            # project meta, photo list, selection, filter
    editStore.ts               # per-photo adjustments + undo stack
    uiStore.ts                 # panel sizes, before/after, dialogs
  storage/
    db.ts                      # idb schema + migrations
    opfs.ts                    # read/write/delete binaries
    lifecycle.ts               # 30-day sweep, wipe, storage estimate, persist()
  lib/
    adjustments.ts             # Adjustments type, DEFAULTS, isDefault(), clamp
    files.ts                   # extension allow-list, filename patterns
    keyboard.ts                # global hotkey map
    format.ts                  # bytes, durations, "expires in N days"
  types.ts
```

---

## 6. Data model

```ts
// src/types.ts

export type FlagState = 'pick' | 'none' | 'reject';

export interface Adjustments {
  exposure: number;    // EV,  -5 .. 5
  contrast: number;    //     -100 .. 100
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  temp: number;
  tint: number;
  vibrance: number;
  saturation: number;
  clarity: number;
  sharpen: number;     //      0 .. 100
  vignette: number;
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
}

export const DEFAULT_ADJUSTMENTS: Adjustments = {
  exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  temp: 0, tint: 0, vibrance: 0, saturation: 0,
  clarity: 0, sharpen: 0, vignette: 0, rotate: 0, flipH: false,
};

export interface Photo {
  id: string;              // crypto.randomUUID()
  projectId: string;
  filename: string;
  ext: string;             // lowercase, no dot
  isRaw: boolean;
  bytes: number;           // original file size
  width: number;           // full-res pixel dims (after libraw flip)
  height: number;
  proxyWidth: number;
  proxyHeight: number;
  exif: {
    camera?: string;       // Make + Model
    lens?: string;
    iso?: number;
    fNumber?: number;
    exposureTime?: number;
    focalLength?: number;
    dateTaken?: number;    // epoch ms
  };
  flag: FlagState;
  adjustments: Adjustments;
  decodeState: 'pending' | 'decoding' | 'ready' | 'error';
  decodeError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Project {
  id: string;
  name: string;            // folder name, or "Import <date>"
  createdAt: number;
  lastOpenedAt: number;
  expiresAt: number;       // lastOpenedAt + 30 days — SLIDING, refreshed on open
  photoCount: number;
  bytesUsed: number;
}
```

---

## 7. Storage architecture

Three tiers. Each has one job.

### 7.1 OPFS — the bytes

```
/projects/{projectId}/orig/{photoId}       original file bytes, verbatim
/projects/{projectId}/proxy/{photoId}.jpg  editing proxy, JPEG q0.92
/projects/{projectId}/thumb/{photoId}.jpg  filmstrip thumb, 320px long edge, q0.80
```

`createSyncAccessHandle()` is **dedicated-worker-only** and much faster than the async
writable stream — use it wherever the write already happens in a worker (the RAW proxy
path). Anything running on the main thread (the non-RAW import path, §8.4, and the thumb
downscale) must use `createWritable()` instead. Read on the main thread with
`getFileHandle()` → `getFile()` → `createImageBitmap()`.

`src/storage/opfs.ts` exposes:

```ts
export async function opfsWrite(path: string, data: ArrayBuffer | Blob): Promise<void>;
export async function opfsReadFile(path: string): Promise<File | null>;
export async function opfsDeleteDir(path: string): Promise<void>;
export async function opfsUsage(path: string): Promise<number>;
```

### 7.2 IndexedDB — the records

Database `lightroom-lite`, version 1, via `idb`:

| Store | Key | Indexes |
|---|---|---|
| `projects` | `id` | `expiresAt` |
| `photos` | `id` | `projectId`, `[projectId+createdAt]` |

Adjustment writes are debounced 400 ms per photo. Never write on every slider frame.

### 7.3 localStorage — two pointers only

```
ll:activeProjectId   -> string
ll:uiPrefs           -> JSON { filmstripPct, inspectorPct, filter }
```

Nothing else. No image data, no adjustment data.

### 7.4 Quota, persistence, eviction

On first import:

```ts
const persisted = await navigator.storage.persist();   // remember the result — see below
const { usage, quota } = await navigator.storage.estimate();
```

- Chromium grants an origin up to ~60% of **total** disk size (not free disk), in both
  best-effort and persistent modes. Firefox best-effort is the *smaller* of 10% of total
  disk and a 10 GiB per-site group limit. Plenty for a card of RAWs, but a full 128 GB
  card will not fit.
- **Refuse the import** with a clear dialog if `estimatedImportBytes > quota - usage - 500MB`.
  Offer to import a subset.
- Handle `QuotaExceededError` mid-import: stop, keep what succeeded, toast the user.
- Show a storage meter in `TopBar` (`Progress` + `usage / quota` label).

**Safari caveat, stated conditionally — not unconditionally.** With cross-site tracking
prevention on, WebKit deletes script-created storage for origins with no user interaction
in the last **7 days**. But eviction *skips origins granted persistence*, so this only
bites when `navigator.storage.persist()` returned `false`. Store that boolean and make the
copy conditional:

- `persisted === true` → `Stored on this device only. Deleted after 30 days of inactivity.`
- `persisted === false` → `Stored on this device only. Deleted after 30 days of inactivity —
  and your browser may clear it sooner if you don't come back within a week.`

Do not over-promise, and do not under-promise either.

### 7.5 The 30-day lifecycle

```ts
// src/storage/lifecycle.ts
export const TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Called once at app boot, before any UI renders.
export async function sweepExpired(): Promise<string[]> {
  const now = Date.now();
  const db = await getDb();
  const expired = await db.getAllFromIndex('projects', 'expiresAt',
    IDBKeyRange.upperBound(now));
  for (const p of expired) await wipeProject(p.id);
  return expired.map(p => p.id);
}

// Refresh the sliding window whenever a project is opened.
export async function touchProject(id: string): Promise<void> { /* lastOpenedAt = now; expiresAt = now + TTL_MS */ }

// Full deletion: OPFS dir + all photo records + project record + localStorage pointer.
export async function wipeProject(id: string): Promise<void> { /* ... */ }
```

`FinishProjectDialog` is an `AlertDialog` that:
1. Warns if any picked photo has not been exported this session.
2. Requires an explicit confirm.
3. Calls `wipeProject()`, then returns the app to the empty `DropZone` state.

---

## 8. RAW decode pipeline

### 8.1 Two-tier decode (the "hybrid" strategy)

| Tier | When | libraw settings | Output |
|---|---|---|---|
| **Proxy** | at import, for every photo | `halfSize: true`, `noAutoBright: true`, `bright: 1.0`, `outputBps: 8`, `outputColor: 1`, `useCameraWb: true` | ≤2560 px long edge JPEG q0.92 → OPFS |
| **Full** | only on export | `halfSize: false`, `userQual: 3` (AHD), `noAutoBright: true`, `bright: 1.0`, `outputBps: 8`, `outputColor: 1`, `useCameraWb: true` | in-memory RGB → GL → encoder |

`halfSize` takes LibRaw's 2×2-block path and **bypasses the demosaic algorithm entirely**,
so `userQual` is ignored for proxies — do not bother setting it there, and do not expect
`userQual: 1` to fix X-Trans proxies (§8.5). It is roughly 4–6× faster than a full AHD
decode: on a 24 MP RAW expect ~300–600 ms proxy vs ~1.5–3 s full on a modern laptop. For
reference, `userQual` is `0 = bilinear, 1 = VNG, 2 = PPG, 3 = AHD` — 0 is *not* nearest
neighbour.

**`noAutoBright` must be `true` on both tiers.** LibRaw's auto-brighten scales the image
from its own histogram; the half-size proxy and the full AHD decode produce *different*
histograms and therefore different brightness. Leaving it on silently breaks §9's
preview-equals-export guarantee and Phase 5's diff test.

The thumb (320 px) is downscaled from the proxy with `createImageBitmap(blob, { ...,
resizeQuality: 'high' })`. `resizeWidth` alone preserves aspect ratio, so pass
**`resizeWidth: 320` for landscape and `resizeHeight: 320` for portrait** — otherwise
portrait thumbs come out 320 px on the short edge. Do not decode the RAW twice.

### 8.2 Worker contract

```ts
// src/engine/decode/decodeTypes.ts
export type DecodeRequest = {
  id: string;              // photoId, used for cancellation
  buffer: ArrayBuffer;     // TRANSFERRED, not copied
  mode: 'proxy' | 'full';
  maxLongEdge?: number;    // proxy only
};

export type DecodeResponse =
  | { id: string; ok: true;  mode: 'proxy'; jpeg: ArrayBuffer; width: number; height: number;
      fullWidth: number; fullHeight: number; exif: Photo['exif'] }
  | { id: string; ok: true;  mode: 'full';  rgb: Uint8Array; width: number; height: number }
  | { id: string; ok: false; error: string };
```

Decode body:

```ts
import LibRaw from 'libraw-wasm';

const raw = new LibRaw();                 // NB: this constructor spawns its own Worker
await raw.open(new Uint8Array(buffer), {
  useCameraWb: true,
  halfSize: mode === 'proxy',
  userQual: 3,                            // ignored when halfSize is true
  outputBps: 8,
  outputColor: 1,                         // sRGB
  noAutoBright: true,
  bright: 1.0,
});

const meta = await raw.metadata(true);    // `true` = full metadata; lens info is only there
const img  = await raw.imageData();
// img: { width, height, colors, bits, dataSize, data: Uint8Array | Uint16Array }
```

Three things the type signature does not make obvious:

- **Check `img.colors`.** Interleaved RGB is only guaranteed when `colors === 3`. Four-colour
  and Foveon sensors return 4. If `colors !== 3`, mark the photo `error` in v1.
- **Use `img.width` / `img.height`, not `meta.width` / `meta.height`.** The metadata values
  are pre-rotation `iwidth`/`iheight` and are wrong for portrait-orientation files.
- **`new ImageData(...)` will not take the buffer as-is.** It requires a
  `Uint8ClampedArray` of length `4 × w × h`. Expand RGB → RGBA with an explicit loop and
  budget for it: ~24 M iterations on a full-res 24 MP decode.

Then: draw to `OffscreenCanvas`, downscale to `maxLongEdge`,
`convertToBlob({ type: 'image/jpeg', quality: 0.92 })`, write to OPFS, post back the
dimensions.

**Always** wrap the decode in `try/finally` and call `raw.dispose()` on the failure path —
it terminates the underlying worker and rejects in-flight calls. The wasm heap grows fast
and is not reclaimed automatically.

### 8.3 Concurrency — read before designing the pool

`new LibRaw()` spawns its **own** dedicated Worker in its constructor (verified in
`libraw-wasm@1.6.0` `dist/index.js`). Two consequences that invalidate the obvious design:

1. **Do not wrap `LibRaw` in your own worker pool.** That creates nested workers (a pool
   worker parenting a libraw worker), which is fragile in Safari. Own a pool of `LibRaw`
   *instances* from the main thread instead — each already gives you a worker.
2. **Do not create one instance per file.** Every construction pays a fresh worker spawn
   plus a ~2 MB wasm compile-and-instantiate. Two hundred of those is on its own enough to
   blow the §13 budgets.

So:

```ts
const POOL_SIZE = Math.max(1, Math.min(4, (navigator.hardwareConcurrency ?? 4) - 1));
// POOL_SIZE long-lived LibRaw instances, each handling many files in sequence.
```

- **Phase 2 must verify that a single `LibRaw` instance survives repeated `open()` calls**
  on different files. If it does not, the fallback is dispose-and-recreate per file — and
  the import budget in §13 must then be relaxed accordingly. Measure before assuming.
- Recycle an instance (`dispose()` + new) every ~25 decodes to bound heap growth.
- FIFO queue, but **the currently-selected photo jumps the queue**.
- Cancellation: `dispose()` is the abort — there is no clean way to interrupt a decode
  mid-wasm. Dispose the instance and replace it in the pool.
- Import runs proxy decodes in the background while the user already culls the first photos.

### 8.4 Non-RAW files

Skip LibRaw entirely: `createImageBitmap(file)` for the proxy (downscale to 2560).

Metadata: **`exifr` only supports `.jpg .tif .png .heic .avif .iiq`** — it will return
nothing for `.webp`, and it does not handle `.cr3` or `.raf` either. Call `exifr.parse()`
only for those supported extensions and leave `exif` empty otherwise; never let a null
parse result throw. RAW metadata comes from LibRaw's `metadata(true)`, not exifr, so exifr
is genuinely only used for the JPEG/TIFF/PNG import path.

This path runs on the main thread, so it **cannot** use `createSyncAccessHandle()` (§7.1) —
use `createWritable()` for these OPFS writes, or move the path into a worker.

### 8.5 Known format caveats — verify during Phase 2

- **CR3** requires LibRaw ≥ 0.20. Confirm the bundled build handles a real CR3 file.
- **Fujifilm X-Trans (`.raf`)** proxies will look mushy, because `halfSize` skips demosaic
  entirely. `userQual` cannot fix this. If it is unacceptable, the only lever is to decode
  X-Trans proxies at full size with `userQual: 3` and downscale — much slower, so gate it
  behind a measured decision, not a guess.
- Compressed / lossless-compressed DNG from phones is fine; **linear DNG** is fine.
- If `open()` throws, mark the photo `decodeState: 'error'` and show it greyed in the
  filmstrip with a tooltip. Never let one bad file abort the import.

---

## 9. Colour pipeline decision (read this before writing shaders)

**v1 is 8-bit sRGB end to end.** LibRaw outputs sRGB-encoded 8-bit RGB; the shaders
linearise, adjust, and re-encode; the exporter runs the *identical* shader chain on the
full-res decode.

The consequence, stated plainly: **what you see is exactly what you export**, because
preview and export run the identical shader chain and differ only in resolution. Two
things must be actively defended to keep that true, and both have bitten this design
already: `noAutoBright: true` on both decode tiers (§8.1), and resolution-independent
filter radii for clarity and sharpness (§10.3, §10.4). The cost is that "Highlights −100" cannot
recover detail that LibRaw already clipped when it mapped sensor data to 8-bit sRGB — it
is a tone-mapping slider, not true RAW highlight recovery.

This is the correct trade for a minimal v1: one code path, guaranteed WYSIWYG, no
float-texture compatibility matrix. The upgrade path (v2, do not build now) is
`outputBps: 16` + `gamm: [1,1]` linear output into `RGBA16F` textures with
`EXT_color_buffer_half_float`, which buys real highlight latitude at the cost of ~2×
memory and a proxy format change.

---

## 10. Render pipeline (WebGL2)

Four passes across **three** render targets. This is not a ping-pong: T1 must stay alive
until pass 4, because pass 4 reads T1 *and* T3. All textures `RGBA8`, `LINEAR` filtering,
`CLAMP_TO_EDGE`.

```
proxy/full texture  (full res)
      │
      ├─► [pass 1] base.frag  → T1  (full res)   WB, exposure, tone, contrast → sRGB
      │                          │
      │        [pass 2] blur.frag horizontal → T2  (¼ res)
      │        [pass 3] blur.frag vertical   → T3  (¼ res)
      │                          │
      └──────────────────────────┴─► [pass 4] finish.frag → screen / readback FBO
                                        clarity(T1, T3), sharpen(T1 3×3),
                                        vibrance, saturation, vignette
```

**T2 and T3 are quarter resolution on each axis.** This is deliberate: clarity needs a
~20-texel blur radius, and nine taps spaced 20 texels apart is point-sampling, not a
low-pass — it rings. Downsampling by 4 first (pass 2 samples the full-res T1 and writes to
a ¼-size FBO) turns the same 9-tap kernel into a genuine gaussian over an ~80-texel
neighbourhood, and pass 4's `LINEAR` upsample of T3 costs nothing. Blur step is
`radius = 3.0` texels *in T2/T3 space*.

Passes 2 and 3 are **skipped entirely** when `clarity === 0` (bind T1 as `uBlur`).

Geometry: one fullscreen triangle, no VBO attributes needed — derive UVs from
`gl_VertexID` in the vertex shader.

Rotation and flip are applied by transforming the UV in the vertex shader, and by swapping
the framebuffer dimensions for 90/270.

### 10.0 Texture orientation — get this right first

`texImage2D` puts the *first* (top) row of an `ImageBitmap`/`ImageData` at `t = 0`, while
NDC `y = -1` (framebuffer bottom) also maps to `vUv.y = 0`. Left alone, **every image
renders upside down.** Two places to handle it, both mandatory:

- Uploading the source texture: `gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)` before
  `texImage2D`. Set it back to `false` afterwards — it is global context state.
- Reading back for export (§12.1): `gl.readPixels` returns rows bottom-up. Flip the row
  order into the `ImageData` buffer, or the export is vertically mirrored.

Verify orientation with an obviously asymmetric test photo **before** validating the
rotation sign convention in §10.1 — otherwise you will "fix" rotation to compensate for
the flip and end up with two bugs that cancel in one case and not others.

### 10.1 `quad.vert.glsl`

```glsl
#version 300 es
out vec2 vUv;
uniform int  uRotate;   // 0,1,2,3  == 0,90,180,270 CW
uniform bool uFlipH;

void main() {
  // fullscreen triangle
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);

  vec2 uv = p;
  if (uFlipH) uv.x = 1.0 - uv.x;
  vec2 c = uv - 0.5;
  if      (uRotate == 1) c = vec2( c.y, -c.x);
  else if (uRotate == 2) c = vec2(-c.x, -c.y);
  else if (uRotate == 3) c = vec2(-c.y,  c.x);
  vUv = c + 0.5;
}
```

> Notes: `uRotate` must be `0` for passes 2–4 — orientation is baked in by pass 1.
> Draw with an empty bound VAO and `gl.drawArrays(gl.TRIANGLES, 0, 3)`; there are no
> vertex attributes. `vUv` legitimately ranges 0…2 outside the viewport — that is the
> fullscreen-triangle trick, and the rotation transform above is linear so it survives it.

### 10.2 `base.frag.glsl` — pass 1

```glsl
#version 300 es
precision highp float;

in  vec2 vUv;
out vec4 fragColor;

uniform sampler2D uImage;
uniform float uTemp;        // -100..100
uniform float uTint;        // -100..100
uniform float uExposure;    //   -5..5   (EV)
uniform float uContrast;    // -100..100
uniform float uHighlights;  // -100..100
uniform float uShadows;     // -100..100
uniform float uWhites;      // -100..100
uniform float uBlacks;      // -100..100

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92,
             pow((c + 0.055) / 1.055, vec3(2.4)),
             step(vec3(0.04045), c));
}

vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92,
             1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055,
             step(vec3(0.0031308), c));
}

void main() {
  vec3 lin = srgbToLinear(texture(uImage, vUv).rgb);

  // ---- white balance -------------------------------------------------------
  // Channel gains, then renormalised so overall luminance is preserved.
  float t = uTemp / 100.0;   // + warmer
  float g = uTint / 100.0;   // + magenta
  vec3 wb = vec3(1.0 + 0.30 * t + 0.10 * g,
                 1.0             - 0.20 * g,
                 1.0 - 0.30 * t + 0.10 * g);
  wb /= max(dot(wb, LUMA), 1e-4);
  lin *= wb;

  // ---- exposure ------------------------------------------------------------
  lin *= exp2(uExposure);

  // ---- tonal regions -------------------------------------------------------
  // Tonal position on a 6-stop log scale. The input is 8-bit sRGB, so before
  // exposure y is in [0,1]: y=1 (white) -> ly=1, mid-grey 0.18 -> ly~0.59,
  // y=1/64 -> ly=0. Anchoring at y=1 (not y=1 -> 0.5) is essential — otherwise
  // the Highlights and Whites masks are zero for every pixel in the image.
  float y  = max(dot(lin, LUMA), 1e-5);
  float ly = clamp(log2(y) / 6.0 + 1.0, 0.0, 1.0);

  float mHi  =       smoothstep(0.55, 1.00, ly);
  float mSh  = 1.0 - smoothstep(0.15, 0.65, ly);
  float mWh  =       smoothstep(0.80, 1.00, ly);
  float mBl  = 1.0 - smoothstep(0.00, 0.30, ly);

  float ev = (uHighlights / 100.0) * 1.5 * mHi
           + (uShadows    / 100.0) * 1.5 * mSh
           + (uWhites     / 100.0) * 1.0 * mWh
           + (uBlacks     / 100.0) * 1.0 * mBl;
  lin *= exp2(ev);

  // ---- to display space ----------------------------------------------------
  vec3 d = clamp(linearToSrgb(lin), 0.0, 1.0);

  // ---- contrast (S-curve about 0.5) ---------------------------------------
  // NOTE: `flat` is a reserved interpolation qualifier in GLSL ES 3.00 — hence
  // `flatten`. Do not "tidy" this name.
  float c = uContrast / 100.0;
  vec3 sCurve  = d * d * (3.0 - 2.0 * d);         // steepen
  vec3 flatten = 0.5 + (d - 0.5) * 0.5;           // flatten
  d = (c >= 0.0) ? mix(d, sCurve, c) : mix(d, flatten, -c);

  fragColor = vec4(d, 1.0);
}
```

### 10.3 `blur.frag.glsl` — passes 2 and 3

```glsl
#version 300 es
precision highp float;

in  vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTex;
uniform vec2 uDir;      // (texelW * 3.0, 0) or (0, texelH * 3.0), texel = 1/¼-res size

// 9-tap gaussian, sigma ~= 2.4 taps
const float W[5] = float[](0.2270270, 0.1945946, 0.1216216, 0.0540541, 0.0162162);

void main() {
  vec3 sum = texture(uTex, vUv).rgb * W[0];
  for (int i = 1; i < 5; ++i) {
    vec2 o = uDir * float(i);
    sum += texture(uTex, vUv + o).rgb * W[i];
    sum += texture(uTex, vUv - o).rgb * W[i];
  }
  fragColor = vec4(sum, 1.0);
}
```

Pass 2 samples full-res T1 into a ¼-size FBO (the `LINEAR` minification does the
downsample); pass 3 runs T2 → T3 at the same ¼ size. Because the blur happens at ¼ scale,
its effective radius already scales with the image, so **no resolution-dependent constant
is needed** — the same `uDir` works for the 2560 px proxy and the 6000 px export. That is
what keeps clarity WYSIWYG (§9).

### 10.4 `finish.frag.glsl` — pass 4

```glsl
#version 300 es
precision highp float;

in  vec2 vUv;
out vec4 fragColor;

uniform sampler2D uBase;     // T1
uniform sampler2D uBlur;     // T3  (== T1 when clarity == 0)
uniform vec2  uTexel;        // 1.0 / textureSize
uniform float uAspect;       // width / height
uniform float uClarity;      // -100..100
uniform float uSharpen;      //    0..100
uniform float uSharpRadius;  // texels; = max(1.0, longEdge / 2560.0)  -- see note below
uniform float uVibrance;     // -100..100
uniform float uSaturation;   // -100..100
uniform float uVignette;     // -100..100

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

void main() {
  vec3 base = texture(uBase, vUv).rgb;
  vec3 col  = base;

  // ---- clarity: large-radius local contrast, luminance only ---------------
  if (uClarity != 0.0) {
    float detail = dot(base, LUMA) - dot(texture(uBlur, vUv).rgb, LUMA);
    col += detail * (uClarity / 100.0) * 0.8;
  }

  // ---- sharpen: small-radius unsharp mask, luminance only -----------------
  if (uSharpen > 0.0) {
    vec2 o = uTexel * uSharpRadius;
    vec3 n = texture(uBase, vUv + vec2(o.x, 0.0)).rgb
           + texture(uBase, vUv - vec2(o.x, 0.0)).rgb
           + texture(uBase, vUv + vec2(0.0, o.y)).rgb
           + texture(uBase, vUv - vec2(0.0, o.y)).rgb;
    float hi = dot(base, LUMA) - dot(n * 0.25, LUMA);
    col += hi * (uSharpen / 100.0) * 1.5;
  }

  col = clamp(col, 0.0, 1.0);

  // ---- vibrance: weighted toward already-muted pixels ---------------------
  if (uVibrance != 0.0) {
    float mx  = max(max(col.r, col.g), col.b);
    float mn  = min(min(col.r, col.g), col.b);
    float sat = mx - mn;
    float amt = (uVibrance / 100.0) * (1.0 - sat);
    col = mix(vec3(dot(col, LUMA)), col, 1.0 + amt);
  }

  // ---- saturation: uniform ------------------------------------------------
  if (uSaturation != 0.0) {
    col = mix(vec3(dot(col, LUMA)), col, 1.0 + uSaturation / 100.0);
  }

  // ---- vignette -----------------------------------------------------------
  if (uVignette != 0.0) {
    vec2  d = (vUv - 0.5) * vec2(uAspect, 1.0);
    float r = length(d) / (0.5 * length(vec2(uAspect, 1.0)));
    col *= 1.0 - (uVignette / 100.0) * smoothstep(0.35, 1.05, r);
  }

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
```

**Why `uSharpRadius` exists:** a fixed 3×3 `uTexel` kernel sharpens at pixel scale, so a
6000 px export would sharpen ~2.3× finer than the 2560 px proxy and would *not* match the
preview — breaking §9. Scaling the tap offsets by `longEdge / 2560` keeps the unsharp mask
at the same relative scale in both. It is an approximation (a scaled 4-tap ring, not a true
resampled kernel); Phase 5's mean-abs-diff test is what validates it. If it fails, render
the export at proxy scale for the sharpen pass or add taps.

### 10.5 Render loop rules

- Render on `requestAnimationFrame`, **only when dirty**. Slider drag sets a dirty flag;
  the RAF callback renders once and clears it. Never render per input event.
- Keep one persistent GL context for the app. Handle loss correctly: call
  `event.preventDefault()` in the `webglcontextlost` listener (without it the context is
  never restored), then rebuild programs, textures and FBOs in `webglcontextrestored`.
- Textures for the current photo stay resident; evict the previous photo's texture on
  navigation (`gl.deleteTexture`). Note this means source + T1 + T2 + T3 are live at once —
  at 6000×4000 that is roughly 96 MB for source and T1 plus ~12 MB for the ¼-res pair.
- Preload the *next* photo's proxy texture during idle time so arrow-key stepping is instant.
- The viewer canvas is sized to the CSS box × `devicePixelRatio`, capped at 4096 px.
- Histogram: after pass 4, `gl.readPixels` into a 256×256 downsample once per settled
  render (debounced 120 ms), bin on the CPU. Do not read back every frame.

---

## 11. UI specification

### 11.1 Layout

`ResizablePanelGroup` (horizontal), full viewport height under a fixed 52 px `TopBar`.

| Panel | Default | Min | Contents |
|---|---|---|---|
| Filmstrip | ~200 px | ~140 px | `FilterChips` + virtualised `ScrollArea` of `FilmstripItem` |
| Viewer | flex | ~400 px | `ViewerToolbar` (top), canvas (centre, letterboxed), `Histogram` (bottom-right overlay) |
| Inspector | ~320 px | ~280 px | `ScrollArea` → `Accordion` (Light / Color / Effects, all open by default) |

shadcn's `Resizable` wraps `react-resizable-panels`, whose sizes are **percentages, not
pixels** (`defaultSize="16%"`, `orientation` rather than `direction`). Convert these pixel
targets against the measured container width on mount, and persist percentages — that is
why `ll:uiPrefs` stores `filmstripPct` / `inspectorPct`.

Dark theme by default (`class="dark"` on `<html>`), neutral zinc palette. A photo editor
UI must not colour-cast the image: the viewer background is a fixed neutral
`oklch(0.22 0 0)` and no accent colour touches the canvas surround.

Panel widths persist to `ll:uiPrefs`.

### 11.2 shadcn component map

| Where | Components |
|---|---|
| TopBar | `Button`, `Badge`, `Progress`, `Separator`, `DropdownMenu`, `Tooltip` |
| DropZone | `Card`, `Button` |
| Import | `Progress`, `Skeleton`, `Sonner` toasts |
| FilterChips | `ToggleGroup`, `ToggleGroupItem` |
| Filmstrip | `ScrollArea`, `Badge` |
| ViewerToolbar | `Button`, `ToggleGroup`, `Toggle`, `Tooltip`, `Separator` |
| Inspector | `ScrollArea`, `Accordion`, `Label`, `Slider`, `Input`, `Button` |
| ExportDialog | `Dialog`, `Select`, `Input`, `Label`, `Slider`, `Switch`, `Button`, `Progress` |
| FinishProject | `AlertDialog` |
| ExpiryBanner | `Card` or inline `Badge` + `Button` |

### 11.3 `SliderRow` — the single most important component

Every adjustment uses it. Get this right and the app feels professional.

```tsx
interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  precision?: number;          // decimal places, default 0
  onChange: (v: number) => void;      // fires continuously while dragging
  onCommit: (v: number) => void;      // fires on pointer-up — this is the undo boundary
}
```

Behaviour, all of it required:

1. Layout: label left, editable numeric value right, `Slider` below, spanning full width.
2. The numeric value is an `Input` (`type="text"`, `inputMode="decimal"`, right-aligned,
   tabular-nums). Enter commits, Escape reverts, blur commits.
3. **Double-click the label or the slider track resets to `defaultValue`.**
4. Value text is muted grey when at default, foreground colour when modified.
5. A small dot appears next to the label when modified, so the user can scan the panel for
   what they touched.
6. Arrow keys: ±1 step. Shift+arrow: ±10 steps. (shadcn `Slider` gives this free.)
7. `onChange` drives the GL render (cheap). `onCommit` pushes to the undo stack and
   triggers the debounced IndexedDB write. **Never push a history entry per frame.**
8. Section headers get a `Reset` text button, disabled when the whole section is at defaults.

### 11.4 Keyboard map

Global, registered in `lib/keyboard.ts`. Suppressed while focus is inside an `Input`,
`Textarea`, `[contenteditable]`, **or an element with `role="slider"`** — the slider
primitive binds Arrow and Shift+Arrow itself, so without that last exclusion a focused
slider will move *and* jump to the next photo on every arrow press.

| Key | Action |
|---|---|
| `←` `→` | previous / next photo (respects active filter) |
| `↑` `↓` | previous / next photo |
| `P` | flag Pick |
| `X` | flag Reject |
| `U` | Unflag |
| `⇧P` / `⇧X` | flag and advance |
| `B` (hold) | show original (before) |
| `\` | toggle before/after (sticky) |
| `0` | reset all adjustments on this photo |
| `[` `]` | rotate CCW / CW |
| `⌘Z` / `⌘⇧Z` | undo / redo (per photo) |
| `E` | open Export dialog |
| `F` | fit to window |
| `?` | keyboard shortcut sheet (`Dialog`) |

### 11.5 States that must be designed, not improvised

- **Empty** — no project: full-window `DropZone` with the accepted-format list and the
  "nothing leaves your computer, deleted after 30 days" promise.
- **Importing** — filmstrip fills progressively; items show `Skeleton` until their proxy lands.
- **Decode error** — item greyed, `Tooltip` with the LibRaw error, excluded from export.
- **Storage full** — `Dialog` with usage figures and an "import fewer photos" path.
- **Expiring soon** — if `expiresAt - now < 3 days`, show `ExpiryBanner` with a
  "Keep for another 30 days" button (calls `touchProject`).
- **Exporting** — modal `Progress` with per-file status; cancellable.

---

## 12. Export

### 12.1 Flow

1. User opens `ExportDialog` (`E` or the top-bar button).
2. Choose scope (`Current photo` / `All picked — N`), format, quality, long-edge cap, filename pattern.
3. On confirm:
   - For each photo: full RAW decode → upload as GL texture (with `UNPACK_FLIP_Y_WEBGL`,
     §10.0) → run the same 4-pass chain at full resolution into an offscreen FBO →
     `readPixels` → **flip the row order** → `ImageData` → `OffscreenCanvas.convertToBlob()`.
   - Progress bar advances per photo. Cancel terminates the pool and stops.
4. Save (§12.3), then mark the photos as exported this session (used by `FinishProjectDialog`).

### 12.2 Formats

| Format | MIME | Encoder | Notes |
|---|---|---|---|
| JPEG | `image/jpeg` | `convertToBlob({ quality })` | default q 0.92 |
| PNG | `image/png` | `convertToBlob()` | no quality option |
| WebP | `image/webp` | `convertToBlob({ quality })` | default q 0.90 |
| PDF | `application/pdf` | `pdf-lib` | encode each image to JPEG q0.92 first, then `embedJpg`; one page per image, page size = image size in points at 72 dpi |

`convertToBlob` on an FBO readback larger than ~8000 px can exhaust memory, so the export
long edge is capped at **8192 px**. This interacts with the `Original` option in §2.5: for
a file whose long edge exceeds 8192 px, `Original` means 8192. Say so in the dialog —
`Original (capped at 8192 px)` — rather than silently downsizing.

### 12.3 Saving

- If `window.showDirectoryPicker` exists (Chromium): ask once for a destination folder, then
  write every file into it with `createWritable()`. This is the good path.
- Otherwise: single file → anchor download. Batch → zip with `fflate` and download one archive.
- Filename pattern tokens: `{name}` `{n}` `{date}` `{camera}`. Default `{name}_edited`.
- Collision handling: append `-1`, `-2`, …

---

## 13. Performance budgets

Treat these as failing tests, not aspirations. Reference machine: M-series MacBook or
equivalent, 24 MP RAW files.

| Operation | Budget |
|---|---|
| Slider drag → pixels on screen | < 16 ms (one frame) |
| Arrow-key photo switch (proxy cached) | < 100 ms |
| Arrow-key photo switch (proxy on disk) | < 250 ms |
| Proxy decode, per photo, per worker | < 800 ms |
| Full decode + render + encode, per photo | < 4 s |
| Import of 200 files, 4 workers | < 120 s to fully proxied |
| Main-thread long tasks during import | none > 50 ms |
| Peak JS heap | < 1.5 GB |

The import figure is I/O-bound, not CPU-bound, and the arithmetic has to close: 200 photos
÷ 4 workers × 800 ms ≈ 40 s of decode, but 200 × ~28 MB ≈ 5.6 GB read over USB 3 at
~90 MB/s is ~60 s on its own. Read and decode must overlap — stream files into the queue as
they are read, never read the whole folder first. If the SD card is slower than the
decoders, that is fine and expected; report throughput in the import UI so the bottleneck
is visible.

Non-negotiable rules that keep these true: decode only in workers; transfer `ArrayBuffer`s,
never structured-clone them; virtualise the filmstrip; one photo's full-res texture in
GPU memory at a time; debounce IndexedDB writes.

---

## 14. Build phases

### Phase 1 — Shell
Vite + React + TS + Tailwind v4 + shadcn installed. `TopBar` + `ResizablePanelGroup`
layout with placeholder panels. Dark theme. Zustand stores stubbed with types from §6.

**Done when:** `pnpm build` is clean, layout resizes and persists panel widths across reload.

### Phase 2 — Import and decode
`DropZone`, directory picker, extension filter, worker pool, `libraw-wasm` proxy decode,
OPFS writes, IndexedDB records, `exifr` metadata, filmstrip with real thumbnails and
progressive loading.

**Done when:** the §8.3 instance-reuse question is answered with a measurement, not an
assumption; `dist/` ships and resolves `libraw.wasm` after a production build; a real
SD-card folder of ≥100 mixed RAWs imports end to end; thumbnails
appear progressively; a reload restores the project from storage with no re-decode; at
least one CR2, one NEF, one ARW, one DNG and one CR3 decode correctly; a deliberately
corrupted file is marked `error` without breaking the import.

### Phase 3 — Viewer and cull
WebGL2 renderer with pass 1 and pass 4 only (no blur passes yet), all Light and Color
sliders live. Flags, filters, keyboard navigation, before/after, rotate/flip, histogram.

**Done when:** an asymmetric test photo renders the right way up and rotates in the right
direction (§10.0); **every** Light slider visibly moves the image on an unedited photo —
especially Highlights and Whites, whose masks are the easiest thing in this spec to get
silently wrong; dragging Exposure on a 2560 px proxy holds 60 fps; flags persist across
reload; arrow-key stepping through 100 photos never stutters more than 250 ms.

### Phase 4 — Effects and edit history
Blur passes, Clarity, Sharpness, Vignette. `SliderRow` complete per §11.3 including
double-click reset and the modified dot. Undo/redo with correct commit boundaries.
Debounced persistence.

**Done when:** clarity and sharpening produce visible, halo-free results; undo/redo
survives 50 operations and photo switches; adjustments reload byte-identical.

### Phase 5 — Export
Full-res decode path, offscreen render, all four formats, batch export of picks,
directory picker with zip fallback, filename patterns, progress and cancel.

**Done when:** an exported JPEG is pixel-comparable to the on-screen preview at the same
resolution (mean abs diff < 2/255); a 40-photo batch export completes without an OOM;
PDF opens correctly in Preview and Acrobat.

### Phase 6 — Lifecycle and polish
30-day sweep on boot, sliding expiry, `ExpiryBanner`, `FinishProjectDialog` with the
unexported-picks warning, storage meter, quota pre-check, `QuotaExceededError` handling,
`navigator.storage.persist()`, shortcut sheet, all empty/error states from §11.5.

**Done when:** back-dating a project's `expiresAt` and reloading deletes it and frees the
OPFS space (verify with `navigator.storage.estimate()`); **Finish & wipe** leaves
`estimate().usage` within 1 MB of where it was before the import.

---

## 15. Risks and fallbacks

| Risk | Likelihood | Fallback |
|---|---|---|
| `libraw-wasm` is a small, single-maintainer package | medium | Only four methods are used (`open`, `metadata`, `imageData`, `dispose`). Wrap it behind `engine/decode/raw.worker.ts` so `ssssota/libraw.wasm` or a dcraw-wasm build can be swapped in without touching anything else. It is the *freshest* dependency here (1.6.0, July 2026). |
| **`exifr` (7.1.3) and `pdf-lib` (1.17.1) were both last published in 2021** | certain | Both are feature-complete and dependency-free, and the surface used is tiny. Accept, but pin exact versions and keep the PDF path behind `engine/export/pdf.ts` so it can be replaced. |
| A single `LibRaw` instance may not survive repeated `open()` calls | medium | Measure in Phase 2. If it cannot, fall back to one instance per file and relax the §13 import budget — do not silently miss it. |
| CR3 or X-Trans decode is wrong or absent | medium | Detect at import, mark those files unsupported with an honest message rather than showing a broken image. |
| Wasm heap growth over a long import | medium | Recycle each pooled instance (`dispose()` + new) every ~25 decodes. |
| The app cannot decode offline: the wasm binary is fetched on first use | certain | Out of scope for v1. A service worker precaching `libraw.wasm` is the v2 fix. Do not claim offline support in the UI. |
| Safari evicts storage after 7 days of no interaction | medium, only when `persist()` was denied | Conditional UI copy per §7.4. |
| 8-bit pipeline limits highlight recovery | certain | Accepted and documented in §9. v2 path is 16-bit linear. |
| `showDirectoryPicker` is Chromium-only | certain | `webkitdirectory` input for import, zip download for export. |
| GPU context loss on a long export | low | Listen for `webglcontextlost`, rebuild programs and textures, resume the export queue. |

---

## 16. Verification checklist before calling v1 done

- [ ] 200-photo SD card import completes inside the §13 budget
- [ ] Every slider in §2.3 works, resets on double-click, and persists
- [ ] Preview and export match at the same resolution
- [ ] Reload mid-project restores photos, flags and edits exactly
- [ ] Finish & wipe returns storage usage to baseline
- [ ] Expired project is deleted on next boot
- [ ] Corrupt and unsupported files degrade gracefully
- [ ] No request ever carries image data or leaves the origin (DevTools Network, whole session)
- [ ] Full keyboard-only cull-and-edit pass is possible
- [ ] Lighthouse: no console errors, no unhandled rejections

---

## 17. References

- [Lightroom — adjust Light](https://helpx.adobe.com/lightroom/web/edit-photos/apply-effects/adjust-light.html) · [adjust Color](https://helpx.adobe.com/lightroom/web/edit-photos/apply-effects/adjust-color.html) · [adjust Details](https://helpx.adobe.com/lightroom/web/edit-photos/apply-effects/adjust-details.html)
- [Lightroom Classic — flags, labels, ratings](https://helpx.adobe.com/lightroom-classic/help/flag-label-rate-photos.html)
- [LibRaw-Wasm (`libraw-wasm`)](https://github.com/ybouane/LibRaw-Wasm) · [LibRaw docs](https://www.libraw.org/docs) · [alternative: ssssota/libraw.wasm](https://github.com/ssssota/libraw.wasm)
- [exifr](https://github.com/MikeKovarik/exifr)
- [MDN — Origin private file system](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
- [MDN — Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) · [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/)
- [shadcn/ui components](https://ui.shadcn.com/docs/components) · [Vite installation](https://ui.shadcn.com/docs/installation/vite)
- [WebGPU/WebGL image adjustment reference](https://webgpufundamentals.org/webgpu/lessons/webgpu-image-adjustments.html) · [evanw/webgl-filter](https://github.com/evanw/webgl-filter)
