# Loupe

A single-page, no-login, entirely client-side photo editor for culling and adjusting a
batch of RAW photos straight off an SD card.

Point it at a folder → it decodes previews → step through with the arrow keys, flag
keepers, push a dozen sliders → export the keepers as JPEG / PNG / WebP / PDF → hit
**Finish** and everything is wiped from the browser.

Nothing is uploaded. There is no server. There is no account.

## Run it

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build && npm run preview
```

Chromium (Chrome / Edge / Arc) gives the best experience: it is the only engine with
`showDirectoryPicker()`, so folder import and "export straight into a folder" both work.
Firefox and Safari fall back to a file input for import and a zip download for export.

## Keyboard

| Key | Action |
|---|---|
| `←` `→` `↑` `↓` | previous / next photo (respects the active filter) |
| `P` / `X` | pick / reject, then step to the next photo |
| `⇧P` / `⇧X` | flag without advancing |
| `U` | unflag |
| `B` (hold) | show the original |
| `\` | toggle before / after |
| `[` `]` | rotate left / right |
| `0` | reset all adjustments |
| `⌘Z` / `⌘⇧Z` | undo / redo (per photo) |
| `E` | export |
| `F` | fit to window |
| `+` / `−` | zoom in / out |
| `⌫` / `⌦` | remove the selected photo (asks first) |
| `?` | shortcut sheet |

A photo carrying any edit — sliders, rotation or flip — shows a badge on its thumbnail and
`· Edited` beside its dimensions; hover the badge for a summary of what changed. The top
bar counts them alongside the flags.

Picking or rejecting steps to the next photo, so a pass through **Unflagged** empties it
as you go. The selection never stays on a photo the active filter has just hidden — it
moves to the next one still on the list, or the previous one at the end.

Right-click any photo — in the filmstrip or the viewer — for flags, rotate/flip, reset,
export and **Remove from project** / **Remove N rejected**. Removing deletes that photo's
original, proxy and thumbnail from browser storage; the files on your card are untouched,
so you can always import them again.

## Hosting it

The build is static files with no server, so any free static host works.

```bash
npm run build      # -> dist/
```

- **Netlify / Cloudflare Pages** — connect the repo; `netlify.toml` already sets the build
  command, publish directory and the `application/wasm` header the RAW decoder needs.
- **GitHub Pages** — `.github/workflows/deploy.yml` builds and publishes on every push to
  `main`. Enable Pages with source "GitHub Actions" in the repo settings. The workflow sets
  `BASE_PATH` to the repo name, because a project site is served from `/<repo>/` and the
  bundle needs that prefix compiled in.
- **Anywhere else** — upload `dist/` and make sure `.wasm` is served as `application/wasm`.

### Saving exports

**Save to** in the export dialog picks between writing straight into a folder and an
ordinary download. Chrome refuses write access to a long list of directories it treats as
holding system files — the home folder among them — so a refusal falls back to downloading
rather than failing the export. Downloading always works.

No environment variables, no secrets, no backend. Nothing to pay for at any traffic level,
because every byte of work happens in the visitor's browser.

## Zooming

Pinch on a trackpad, or hold ⌘ and scroll, to zoom about the pointer. Once zoomed, drag or
two-finger scroll to pan — the photo follows your finger — and double-click to toggle 100%. `F` fits, `+` / `−` step. Zoom
and pan reset when you move to another photo.

Past the point where the on-screen image outresolves the 2560 px proxy, the original is
decoded at full resolution and swapped in, so zooming in to check focus shows real detail
rather than magnified proxy pixels. The proxy stays on screen until the full decode lands,
and going back to fit releases it.

## Spot removal

`R`, or the stamp button, turns on retouching. Click a blemish and it heals: a nearby patch
with similar tone and as little structure as possible is found automatically, copied in,
and tone-matched to its surroundings so the patch never shows as a lighter or darker disc.

- **Spot size** slider in the panel, or scroll over the photo, sets the brush. New spots
  take the current size; existing ones keep theirs.
- Drag the dashed circle to override where it heals from, `⌫` to remove a spot, `Esc` to
  leave the mode.
- Spots are stored in *source* coordinates, so they stay on the dust through rotation,
  flip, zoom and export.
- **Copy to picked** applies this photo's spots to every picked photo — sensor dust lands
  in the same place on every frame, so a whole shoot is cleaned once.

## Deconvolution

Not a sharper unsharp mask. **Deconvolve** asks what image, once blurred by the lens, would
have produced the pixels actually recorded, and iterates toward it (Van Cittert, 3–10
passes depending on strength, in half-float render targets so the correction does not band).

It recovers real detail from mild defocus, lens softness and slight camera shake. It cannot
invent what the sensor never recorded, so a properly missed-focus frame stays missed, and
it amplifies noise and rings at hard edges — pair it with **Noise reduction**. The
half-float buffers are freed the moment the slider returns to zero.

## Noise reduction

A 13-tap bilateral filter on the **Noise reduction** slider, running before clarity and
sharpening so grain is not amplified. Chroma is smoothed harder than luminance, because
colour blotches are the ugly part of high-ISO RAW and luminance carries the detail. Its
radius scales with resolution like sharpening does, so the preview and the export match.

It is a global, single-slider denoiser — good for moderate noise, not a match for
Lightroom's detail-aware one. Lightroom's `LuminanceSmoothing` and `ColorNoiseReduction`
both map onto it on import, taking whichever is stronger.

## Export sizes

Alongside the long-edge caps, export offers **1.5x** and **2x larger**, resampled with
Lanczos-3 rather than the browser's own resize, which is soft on the way up. This is a
better interpolator, not a reconstruction — it makes a bigger, cleanly-scaled file and adds
no detail that was not recorded. Downscaling still uses the native high-quality path, which
is both good and much faster. Everything stays capped at 8192 px.

## Importing part of a folder

Choosing a folder with more than a dozen photos opens a review step before anything is
decoded: filenames, sizes, a running total, and how much browser storage is free.

- Everything starts selected — untick what you don't want.
- **Shift-click** selects a range.
- **Filter by filename** narrows the list, and the button becomes *Select matches*, so
  `DSC_047` then *Select matches* takes ten frames in two clicks.
- If the folder is too big for the browser's storage quota, the leading run that does fit
  is preselected instead of the import being refused outright.

Under a dozen photos, or when you picked the files yourself with **Choose files**, the
import runs straight away.

## Presets

The **Presets** panel sits at the top of the inspector.

- **Save** the current sliders with `+`. Presets store the thirteen sliders only —
  rotation and flip stay with each photo, so applying a preset never re-orients anything.
- **Hover** a preset to see it on the current photo; move away and it reverts. Click to
  apply — one `⌘Z` steps the whole preset back.
- **A photo carrying any edit — sliders, rotation or flip — shows a badge on its thumbnail and
`· Edited` beside its dimensions; hover the badge for a summary of what changed. The top
bar counts them alongside the flags.

Picking or rejecting steps to the next photo, so a pass through **Unflagged** empties it
as you go. The selection never stays on a photo the active filter has just hidden — it
moves to the next one still on the list, or the previous one at the end.

Right-click any photo → Apply preset** to reach the same list from the filmstrip.
- **Import** Lightroom presets you already own: `.xmp`, `.lrtemplate`, or a `.zip` of
  either. **Export** writes Camera Raw `.xmp` that Lightroom Classic and Lightroom CC read.

Presets are kept in `localStorage` under `ll:presets`, so they survive finishing a project
and the 30-day sweep. They are the one exception to the "two pointers only" rule in the
spec — a preset is a couple of hundred bytes, and a synchronous read puts the list on
screen the instant the app boots.

### What survives an import from Lightroom

Exposure, contrast, highlights, shadows, whites, blacks, clarity, vibrance, saturation and
sharpening map one to one. Two need translating, and one cannot be exact:

- **Vignette** — Lightroom's `PostCropVignetteAmount` is negative to darken corners; ours
  is positive. The sign is flipped on the way in and out.
- **Sharpening** — Lightroom's range is 0–150, ours stops at 100, so it is clamped.
- **White balance** — Lightroom stores absolute Kelvin for raw files. Ours is a relative
  offset, so an absolute value is mapped around a 5500 K neutral. This is an
  approximation, and it is the one place an imported preset will not match Lightroom
  exactly.

Anything with no slider here — tone curves, HSL, colour grading, dehaze, texture, grain,
noise reduction, masks — is listed on the preset with a warning triangle, so you can see
what was dropped rather than wondering why the look differs.

## Where things live

| Layer | Path | Notes |
|---|---|---|
| RAW decode | `src/engine/decode/` | pool of long-lived `libraw-wasm` instances; each spawns its own worker |
| Pixel work | `src/engine/decode/media.worker.ts` | RGB→RGBA, rescale, JPEG encode, OPFS writes — off the main thread |
| Render | `src/engine/gl/` | WebGL2, four passes across three render targets |
| Export | `src/engine/export/` | full-res decode → same shader chain → encoder / `pdf-lib` / `fflate` |
| Presets | `src/lib/presetFormat.ts` | Camera Raw `crs:` XMP and `.lrtemplate` read/write |
| Storage | `src/storage/` | OPFS for bytes, IndexedDB for records, localStorage for prefs and presets |
| State | `src/store/` | Zustand: project, edit history, UI |

## Storage and lifetime

- **OPFS** holds the bytes: `projects/{id}/orig|proxy|thumb/…`
- **IndexedDB** (`lightroom-lite`, kept under its original name so existing data survives) holds photo and project records; adjustment writes are
  debounced 400 ms per photo.
- **localStorage** holds `ll:activeProjectId`, `ll:uiPrefs` and `ll:presets`.

A project expires 30 days after it was last opened; the window slides every time you open
it. Expired projects are deleted at the next app start, before any UI renders.
**Finish & wipe** ends a project immediately and returns storage usage to baseline.
