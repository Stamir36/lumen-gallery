# LUMEN — Product Specification (Phase 0)

Local-first photo & video gallery + player for Windows (Android later).
Offline-first: zero network, zero telemetry. All state in SQLite.

---

## 1. Product Overview

LUMEN is a fast, private, local media gallery. It scans user-chosen folders/drives
("libraries"), builds a justified collage grid grouped by date, and ships a fully
custom photo viewer and video player. No cloud, no accounts, no upload.

## 2. Libraries

- Multiple roots supported (folders/drives, e.g. an SD card).
- **First-run onboarding:**
  - List available volumes: label, free/total capacity bar rendered with mono digits.
  - Alternative: drag-drop a folder onto the onboarding surface.
  - Scan starts with live counters and a mono log line feed (one line per event).

## 3. Scanning

- Recursive walk of each root.
- Extension whitelist:
  - Images: `jpg jpeg png gif webp avif bmp`
  - Videos: `mp4 mkv webm mov m4v`
- Skip hidden and system files/directories.
- Dedupe by `path + mtime + size`.
- Incremental rescan (only changed entries re-processed).
- Filesystem watch with 2s debounce.
- **Ejected drive mid-session:** mark root offline, keep DB rows, show offline
  state in sidebar (capacity bar unavailable), no crashes, no data loss;
  re-scan gracefully on re-mount.

## 4. Library UI

- **Justified collage grid** (Google-Photos-style rows), target row height 220px,
  gap 8px.
- Grouped by capture/modification date with sticky mono uppercase headers + counts.
- View modes: **justified / masonry / square / list**.
- Virtualized rendering for **50k items** (react-virtuoso).
- Card hover:
  - inner image scale 1.03
  - bottom gradient
  - mono chips (duration for video, resolution for image)
  - heart button appears
- Videos on hover: muted live-scrub preview loop after 400ms + center play glyph
  at 40% opacity.

## 5. Collage Mode

- Select 2–6 items → mosaic split view.
- Each tile independently viewable/playable in place.

## 6. Layout & Navigation

- **Sidebar 240px**, collapsible to 64px icon rail:
  - Roots with capacity bars
  - Favorites, Albums, Videos, Images, Recents, Trash
  - Bottom: Settings, scan status
- **Top bar 48px, glass:**
  - breadcrumb/title + mono count
  - search (focus with `/`)
  - segmented view-mode control
  - sort menu
  - selection-mode toggle
- **Bottom-left status line, mono:** `12,482 items - 348 GB - scanned 2s ago`.

## 7. Selection

- Hover checkbox top-left of each card.
- Floating glass action bar at bottom: favorite, add to album, collage,
  open containing folder, trash.

## 8. Favorites, Albums, Trash

- **Favorites:** heart everywhere + Favorites smart view.
- **Albums:** user collections, DB-only (no file copies).
- **Trash:** DB flag only in v1 + restore.

## 9. Search & Sort

- Filename substring search.
- Filter chips: type / date range / favorite.
- Sort by date / name / size / duration, asc–desc.

## 10. Photo Viewer

- Fullscreen black, contain-fit.
- Floating bottom bar: fit / 1:1 / zoom slider, rotate, favorite,
  info panel with mono metadata, trash.
- Prev–next arrows; collapsible bottom filmstrip.
- Wheel zoom-to-cursor; drag pan; double-click toggles 1:1.

## 11. Video Viewer (fully custom player, NO native controls)

- **Ambient mode:** blurred enlarged live frame behind
  (blur 60px, saturate 1.4, opacity .35).
- Controls auto-hide after 2s idle.
- **Progress:** 2px line → 6px on hover, buffered ghost track, mono timecodes
  both sides, hover scrub-preview thumbnail.
- **Center cluster:** −10s, play/pause (48px white circle), +10s.
- **Volume popover** with slider.
- **Right cluster:** speed menu 0.25–2.0, loop, frame snapshot
  (saved to `Pictures/Lumen`), PiP, fullscreen.
- **Top-left:** back arrow + filename + mono chips (res, fps, codec).
- **Right collapsible "Up next"** filmstrip of sibling files.
- **Resume chip** if `watch_progress` exists.
- **Keyboard:** Space, J/K/L, ←/→ 5s, ↑/↓ volume, M mute, F favorite,
  `.`/`,` frame step, 0–9 jump percent, Esc close.

## 12. Open-With Integration

- Windows file associations (image + video extensions) + single-instance plugin.
- Launching onto a file opens the Viewer directly with its folder siblings as
  queue, **without** a full scan.

## 13. External Player Fallback

- Context action "Open in external player" (VLC/MPC path from Settings),
  shown automatically when WebView2 cannot play a codec.

## 14. Settings

- Manage libraries + per-root rescan.
- Thumbnail cache size + clear.
- External player path.
- Offline-first: zero network, zero telemetry. SQLite for all state.

## 15. Stack (mandatory)

- **Tauri v2 (Rust)** + **React 18** + **Vite** + **TypeScript strict**
- Tailwind v4 + shadcn/ui; zustand; @tanstack/react-query; framer-motion;
  lucide-react; react-virtuoso
- SQLite via `tauri-plugin-sql`
- Inter + JetBrains Mono bundled locally (no CDN)
- **Rust responsibilities ONLY:** fs walk, watch, volumes info, db, cache file io,
  open-external, single-instance, associations, bundling.
- **Frontend responsibilities:** thumbnails (hidden `<video>` + canvas → webp
  480w into `appCacheDir/thumbs`, 4-worker queue, dominant-color placeholder)
  and metadata (duration/dimensions via element metadata; `exifreader` for images).
- No ffmpeg sidecar in v1 (documented as v2 option).

## 16. Performance Targets

| Metric | Target |
|---|---|
| Cold start → grid (cached 10k library) | < 1.5s |
| Grid scrolling | 60fps |
| Scan 10k files | < 5s |
| Video seek | < 300ms |

## 17. QA Rules

- `tsc` strict clean + `cargo clippy` clean before every commit.
- After every UI phase: run dev server, screenshot, self-review against
  `docs/DESIGN.md` token-by-token, fix discrepancies BEFORE committing.
- One conventional commit per phase.
