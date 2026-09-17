# LUMEN — Roadmap (Phases 1–6)

## Phase 3.8 — stabilization batch S1 (2026-09-17)
Findings + evidence: `docs/AUDIT-2026-09-17.md`.
- [ ] S1.1 seed warm thumbs from DB (instant render, enqueue only `thumb_path = null` + new version)
- [ ] S1.2 app-wide thumb queue: ONE semaphore (settings workers, default 4), dedupe by `(id, mtime, size)`, 24-item sub-batches with incremental delivery
- [ ] S1.3 subscribe the frontend to the writer's `thumbs-ready` event (patch the row cache, drop stuck placeholders)
- [ ] S1.4 versioned thumb cache `(id, mtime, size)`, migration v5 `thumb_size`, stale file deleted + regenerated (incl. previous `thumb_error` rows)
- [ ] S1.5 persistent browser fallback: decoded bitmap written to `appCacheDir/thumbs` through the writer; negative marker keyed by file version
- [ ] S1.6 tile state contract: shimmer → thumb → neutral tile + mono ext chip; never a broken glyph
- [ ] S1.7 bulk favorite/trash: placeholder list starts at `?1`, chunks ≤512, `rows_affected > 0` asserted with an i18n toast on mismatch
- [ ] S1.8 scan upsert compares `excluded.mtime`/`excluded.size` + in-memory regression test on the real SQL
- [ ] S1.9 explorer `tree | grid` sub-toggle (persisted), folders never in both panes, v2.2 gutters in folder mode
- [ ] S1.10 `backend-ready` gate before the first library query (kills the first-open flicker)
- [ ] S1.11 restore fs watchers for stored roots at boot
- [ ] S1.12 route the remaining direct writes (video thumb, settings, cache clear) through the writer / `db_exec`

## Backlog (audit 2026-09-17) — deferred, not dropped
- [ ] Folder exclusions (`excluded_folders`, scan skip, Settings list + restore, show-excluded toggle) — Phase 3.5 FIX 6, still open
- [ ] Masonry capped at 2 000 (MASONRY_MAX); lift only with ≥55 fps measured on 9.4k
- [ ] Grid reflow animation on window resize (rows repack instantly — `layout` on 9k tiles is unaffordable)
- [ ] Library stats on @tanstack/react-query (App.tsx hand-rolls useEffect + useState)
- [ ] Restrictive CSP with a dev/prod split (needs `devUrl` relaxation) → packaging phase
- [ ] Filmstrip reuses the same `thumbSrc` path + versioned cache as the grid (Phase 4 viewers)
- [ ] `Enter` opens the viewer (Phase 4); explorer keyboard navigation in masonry
- [ ] Numbers still awaiting a GUI run: warm tile paint, cold first tile < 1 s, rescan changes on an unchanged folder, 60 fps scroll, bulk favorite `rows_affected`

## Phase 3.7 — perf + declutter (2026-09-17)
- [x] FIX 1 single-writer SQLite: ALL media writes through one tokio task (mpsc); thumb updates batched — flush at 200ms or 64 items, ONE transaction; favorite/trash/settings via whitelisted `db_exec` command with oneshot completion; busy_timeout=10000; WAL + NORMAL kept. Dev console logs `[perf] db_exec Nms` per UI write (favorite <50ms contract).
- [x] FIX 2 honest tiles: WebView-decoder fallback (fs-read + createImageBitmap) tried once per file when Rust decode fails; folder covers skip thumb_error rows, chain = thumb → color → newest decodable child → tonal surface + folder glyph; broken-glyph eliminated everywhere.
- [x] FIX 3 IA declutter: chips row deleted (sidebar covers it); Галерея/Проводник segmented moved into the library bar left; gallery = pure flat date-grouped feed (folder shelf removed, explorer covers it); per-mode state (route/query/sort/foldersView + scroll offsets) preserved across toggles.
- [ ] FIX 4 numbers (user run): `[perf] boot`, `[perf] db_exec`, zero sqlx slow-statement warnings over a 60s scroll; fps profile still pending.

## Phase 3.5 — user acceptance fixes (2026-09-17)
- [x] FIX 1 thumbnails: tiles rendered the raw DB path (`C:\...\thumbs\1.jpg`) as the <img> src — never went through convertFileSrc, so NO photo ever showed its thumb and the dominant-color placeholder stayed forever. Rust also decoded by extension (`image::open`), which threw "Invalid PNG signature" on mislabeled files. Now: convertFileSrc via `thumbSrc`, content-based decode (`ImageReader::with_guessed_format`), permanent failures persisted in `thumb_error` (migration v4) → mono "no preview" tile, one WARN per file, no retry loops. Video capture sets crossOrigin="anonymous" (the tauri asset protocol answers with `Access-Control-Allow-Origin: <window origin>`, verified in tauri 2.11.5 src/protocol/asset.rs) so the canvas stays untainted.
- [x] FIX 2 dates: epoch seconds vs ms mismatch fixed once at the api.ts IPC boundary (raw 1789588545 → 1970-01-21; ×1000 → 2026-09-16).
- [x] FIX 3 selection bar: `glass` carries no radius, so the pill was a sharp slab — now h56/radius-999 + mono count chip.
- [x] FIX 4 topbar: view-mode switcher moved into the window title bar (compact, icon-only, library routes only); library bar collapsed from two rows to one.
- [x] FIX 5 folders: explicit "Папки" sidebar entry + home button in the breadcrumbs (alt+← kept); justified mode renamed "Лента" (ru) to free the word "Коллаж" for the new selection collage viewer.
- [x] FIX 4b collage multi-viewer: fullscreen overlay with per-count presets (2 side-by-side/stack, 3 big+2, 4 2x2, 5-6 mixed rows), glass layout-cycle chip, Esc, per-tile video play/pause + mute; tile click is the Phase 4 viewer hook.
- [ ] FIX 6 folder exclusions (NOT STARTED): `excluded_folders(root_id, path)` table, scan skips excluded subtrees, list_media/list_folders hide excluded rows, Settings > Libraries lists + restores exclusions, auto-rescan after change, "show excluded" toggle (default off).
### Round 2 — user feedback after the first real run (2026-09-17)
- [x] Video previews were serialized (`preload="metadata"`, one decoder at a time) and frames are taken from `requestVideoFrameCallback` with up to 3 offsets until the sampled frame is not near-black — the hitch on open and the 2-3 black tiles out of 20 had the same cause: a decoder storm plus capturing before the seeked frame was painted.
- [x] Explorer mode: title-bar switch between Галерея and Проводник; explorer shows a lazily expanded folder tree of the active root + the open folder's contents only (dir-scoped query, name order, no date headers). Thumbnails for one folder no longer compete with the whole library.
- [x] Hover preview speed is a setting (Settings › Playback: 1.5× / 3× / 6× / 9×, default 3×) persisted in `settings.video_scrub_rate`.
- [x] Dev-only boot timings printed in the console (`[perf] boot: db … roots …`) so the next "it feels slow" report comes with numbers.
- [x] Clearing the thumbnail cache now also NULLs the thumbnail columns (Rust) and resets the in-memory thumb state (frontend), so a stale black video frame is regenerated instead of staying cached forever; a tile whose <img> 404s forgets itself and retries at most twice instead of showing a permanent "no preview".
- [ ] Still unmeasured: 60fps scroll at 9.4k, cold start < 1.5s, scan 10k < 5s — needs the user's run.

- [ ] FIX 7 perf pass (NOT MEASURED): honest fps numbers (rAF frame deltas over a 3s scroll at 9.4k), visible-first thumb queue priority, SQL-side filter verification; lift the masonry cap only with >=55fps measured.

## Deferred hardening (from fix batch, 2026-09-17)
- [ ] Consolidate library stats on @tanstack/react-query (App.tsx currently hand-rolls useEffect + useState for libraryStats)
- [ ] Restrictive CSP in tauri.conf.json — needs dev/prod split (`devUrl` requires relaxed CSP), do in packaging phase
- [x] Offline media UI: gray tiles + mono OFFLINE chip per contract in scan.rs (offline flag, migration v2); `root-offline` toast wired
- [ ] Masonry is capped at 2,000 items (MASONRY_MAX) — the hand-rolled absolute virtual window holds 60fps there; revisit the windowed layout before lifting the cap to 50k
- [ ] Grid reflow animation on window resize (rows repack instantly — `layout` on 9k tiles is not affordable)
- [ ] THUMBNAILS ARE LAZY (user rule): generate ONLY when the user opens a directory/grid — never during scan, never eagerly for a whole root. Cache cleanup: measure scan perf (target 10k < 5s) when needed without a release bench run.


Phase 0 (docs) — done: `docs/SPEC.md`, `docs/DESIGN.md`, `.clinerules`, `TODO.md`.

## Phase 1 — Project skeleton (DONE)
- [x] Scaffold Tauri v2 + React 18 + Vite + TS strict + Tailwind v4 + shadcn/ui (hand-rolled shadcn-style on Radix)
- [x] Install zustand, @tanstack/react-query, framer-motion, lucide-react, react-virtuoso, exifreader (exifreader deferred to Phase 4 — metadata phase)
- [x] Bundle Inter + JetBrains Mono locally (@fontsource-variable, no CDN)
- [x] Define design tokens in Tailwind v4 `@theme` per docs/DESIGN.md (also as CSS vars)
- [ ] tauri-plugin-sql wired (Phase 2 scope — sql plugin + migrations deferred)
- [x] App shell: canvas + grain overlay + scrollbars; /style living style sheet — **v2.2 soft glass editorial** (glass whitelist: pills only; solid tonal chrome; accent anchors; "glass pills over content" + "chrome surfaces" demo sections; screenshot QA pending: no browser tool in env)
- [x] Frameless window + custom title bar (drag-region spacer, window controls, maximize icon swap)
- [x] Conventional commits: `feat: design system`, `feat: design system v2`, `feat: frameless window + custom title bar`, `style: glass & accent calibration v2.2`

## Phase 2 — Libraries & scanning (DONE)
- [x] Rust: fs walk (whitelist, skip hidden/system), volumes info via sysinfo, fs watch (notify, 2s debounce)
- [x] Onboarding: volume list (accent gradient capacity bars, mono digits), folder picker + drag-drop dropzone, scan view with mono counters + log tail
- [x] Scan pipeline: dedupe path+mtime+size, incremental rescan, live counters + mono log feed (scan-progress events)
- [x] Roots persisted in SQLite (tauri-plugin-sql migrations v1); sidebar roots show capacity bar + rescan action
- [ ] Ejected-drive safe behavior (Phase 6 hardening — root stays, rescan skips missing paths)
- [ ] Settings: manage libraries, per-root rescan (Phase 6; rescan already available per root + rescan all)
- [x] cargo clippy clean (0 warnings, `-D warnings`) + pnpm typecheck clean
- [x] Commits: `fix: tauri v2 capabilities permissions`, `feat: onboarding root picker`, `feat: scan core + sqlite`

## Phase 3 — Library grid UI (DONE)
- [x] Sidebar 260/68 rail: roots + capacity bars, all media, Photos, Videos, Favorites, Albums, Recents, Trash, settings/scan status — counts from `library_summary`
- [x] Top bar 64px solid chrome + ephemeral chips row: breadcrumbs + mono count, search (`/`), chips All/Photos/Videos/Favorites, sort menu (date/name/size/duration asc-desc), segmented view modes, selection toggle
- [x] Justified grid (target row height 220, gap 8), masonry/square/list modes, sticky mono uppercase date headers + counts
- [x] Virtualization via react-virtuoso (whole 9,390-row library in one query; rows repack on resize)
- [x] Card hover contract: inner scale 1.03, bottom gradient, mono duration/resolution chips, heart, selection checkbox; video scrub-preview (400ms delay, rate 6, stops + resets on leave, play glyph 40%)
- [x] Folder navigation: root click → folder cards (cover = thumb/dominant color, mono count) + subfolder shelf + folder media grid; clickable mono breadcrumbs; alt+← up
- [x] Selection + floating glass action bar (favorite / trash / clear); mono status line with live ago-ticker
- [x] States: shimmer skeletons in final grid shape, dashed empty box + CTA, offline tiles, error box with retry
- [ ] Perf validation on real hardware: cold start < 1.5s (10k cached), 60fps scroll at 9.4k, scan 10k < 5s — needs the user's run
- [x] `feat: justified virtualized grid` · `feat: grid states + offline tiles` · `style: gallery polish pass`
- [ ] Keyboard: arrows + Enter (selection) work; Enter must open the viewer once Phase 4 lands
- Dev QA surface: `#/grid-demo` renders the real grid with synthetic rows (no Tauri calls) for layout screenshots

## Phase 4 — Viewers
- [ ] Photo viewer: contain-fit, bottom bar (fit/1:1/zoom/rotate/favorite/info/trash), arrows, filmstrip, wheel zoom-to-cursor, drag pan, dbl-click 1:1
- [ ] Video player: custom controls, ambient mode, auto-hide 2s, progress line + buffered ghost + scrub preview, center cluster, volume popover, speed/loop/snapshot/PiP/fullscreen, up-next filmstrip, resume chip, full keyboard map
- [ ] Metadata: exifreader + element metadata → info panel mono
- [ ] QA + screenshot pass; `feat: photo and video viewers`

## Phase 5 — Organization features
- [ ] Favorites hearts + smart view; Albums (DB-only) UI; Trash (DB flag) + restore
- [ ] Search substring + filter chips; sort date/name/size/duration asc–desc
- [ ] Collage mode (2–6 items, mosaic split, per-tile view/play)
- [ ] QA + screenshot pass; `feat: favorites albums trash search collage`

## Phase 6 — Windows integration & polish
- [ ] Single-instance plugin; file associations (image+video); launch-to-viewer with sibling queue, no full scan
- [ ] External player fallback ("Open in external player", VLC/MPC path in Settings; auto-show on unsupported codec)
- [ ] Settings: thumbnail cache size + clear, external player path
- [ ] Final perf audit + QA + screenshot pass; `feat: windows integration`
- [ ] Document ffmpeg sidecar as v2 option in docs/SPEC.md
