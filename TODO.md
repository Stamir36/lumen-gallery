# LUMEN — Roadmap (Phases 1–6)

## Phase 4.1 — user-reported fixes (2026-09-18) — DONE
- [x] `fix: watch_progress rebuilt in milliseconds` — v1 had already created the table with `position_s`,
      so v6's `CREATE TABLE IF NOT EXISTS` never added the ms columns and every save failed every 5s.
      Verified on a copy of the real DB (`scripts/db-schema-check.cjs`)
- [x] `fix: real scrub frames, left-aligned caption, pill alignment setting` — the progress bubble seeks a
      real frame; the caption is `text-left` (a `<button>` centres its text) and brighter; the viewer pill
      can sit centre/left/right; wheel zoom + scrub + swipe are coalesced to one update per frame, and
      opening a viewer stops any card scrub-preview left running
- [x] `feat: perf watchdog + measured fps chip` — long-task observer + main-thread drift probe log stalls
      (`[perf] long task …ms`), and the status line can show measured rAF frame rate + worst frame
- [x] `feat: folder exclusions` — `excluded_folders` + `media.excluded`, scan prunes the subtree,
      exclude/restore through the single writer; checked against real data (1542 rows hidden, restore exact,
      prefix boundary exact)
- [x] `feat: hidden-folder UI and thumbnail worker setting` — right-click a folder card to exclude it,
      restore list in Settings › Libraries, "show excluded" chip mode, thumbnail workers 2/4/6/8/12
- [ ] Still open from the earlier list: a measured 60 fps **claim** at 9.4k (the chip now exists — numbers
      from a real run are the missing piece)

## Phase 3.8 — stabilization batch S1 (2026-09-17) — DONE
Findings + evidence: `docs/AUDIT-2026-09-17.md`.
- [x] S1.1 warm seed: `seedThumbs` renders rows that already carry `thumb_path` from the DB value; only rows needing work are enqueued (`4a417ec`, `9f154dd`)
- [x] S1.2 app-wide queue: ONE `ThumbEngine` semaphore (`thumb_workers` setting, default 4, rebuilds on change) + in-flight dedupe, sub-batches of 24, per-row `thumb-result` push, frontend dedupe by `(id, mtime, size)`, visible-first ordering
- [x] S1.3 the writer emits `thumbs-ready {ids}` after a committed flush; the frontend patches the cached row (warm on remount) — verified through the dev-server module graph (`ingest` → ok)
- [x] S1.4 versioned cache `(mtime, size)` + migration v5 `thumb_size`; a stale entry deletes its file and re-renders, `thumb_error` rows retry when the version moves (`cache_version_needs_mtime_and_size`)
- [x] S1.5 browser fallback persists its JPEG into `appCacheDir/thumbs` through `thumb_record`; the negative marker is keyed by `(id, mtime, size)`
- [x] S1.6 tile contract: shimmer → thumb → neutral tile + mono ext chip; videos keep the play glyph instead of an error patch
- [x] S1.7 bulk favourite/trash: placeholders start at `?1`, chunks ≤512, `rows_affected` checked with an i18n toast (`errors.action_nothing`)
- [x] S1.8 scan upsert compares `excluded.mtime`/`excluded.size`; `unchanged_rescan_counts_zero_changes` runs the real statement
- [x] S1.9 explorer `tree | grid` sub-toggle (persisted, `ui.explorer_layout`), folders never in both panes, capped self-scrolling folder strip with v2.2 gutters
- [x] S1.10 `backend-ready` event + `backend_ready` probe; the first library query awaits it
- [x] S1.11 fs watchers restored for every stored root at boot (unreachable roots are logged, not crashed)
- [x] S1.12 video thumb frames, browser-fallback thumbs, settings and the cache wipe all go through the writer (`thumb_record`, `ResetThumbs`, `writeSetting` → `db_exec`)

### Numbers measured while landing S1
- scan upsert (real SQL, in-memory SQLite): OLD guard `1/1/1` on an unchanged file; NEW `0/0/0` with `1` on a new mtime and `1` on a new size → an unchanged folder now reports 0 changes.
- bulk favourite (in-memory SQLite): the fixed placeholder list affects all 3 of 3 rows; 600 ids chunk into `512 + 88`.
- warm seed / streamed ingest / failure tile / explorer layout persistence: DOM-runtime check through the dev module graph (`status: ok` with `path`+`color`, `noPreview: true` on a decode failure, `ui.explorer_layout` = `grid` ↔ `tree`).
- STILL THE USER'S TO CAPTURE (needs the GUI): warm tile paint, cold first-tile time, 20 heart clicks with `[perf] db_exec` under 50 ms, zero sqlx slow-statement warnings over a 60 s scroll, fps on 9.4k. Probe line: `[perf] boot: backend … · db … · roots … · total …`.
- `cargo test --lib` cannot run in this environment: the test binary dies with `STATUS_ENTRYPOINT_NOT_FOUND` (WebView2/wry linkage, not our code) even with the loader DLL copied next to it — tests are therefore type-checked via `cargo clippy --all-targets` and the SQL behaviour is proven with `node:sqlite` instead.

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
- [x] Keyboard: arrows navigate, **Enter opens the viewer** on the focused card, Space marks selection; closing the viewer scrolls the grid back to that item (masonry scroller not wired yet — backlog)
- Dev QA surface: `#/grid-demo` renders the real grid with synthetic rows (no Tauri calls) for layout screenshots

## Phase 4 — Viewers
- [x] `fix: full-width date headers + hover captions setting` — the tonal band is edge-to-edge, `appearance.hover_captions` (SQLite, default ON) shows the filename caption on hover
- [x] `feat: photo lightbox` — contain-fit, glass pill (fit/1:1/zoom/rotate/favorite/info/trash), arrows, virtualized filmstrip, wheel zoom-to-cursor, drag pan, dbl-click 1:1, keys `0 1 i F ←→ Esc`
- [x] `feat: custom video player` — ambient layer, one glass pill, auto-hide 2s, 2px→6px progress with buffered ghost + scrub bubble, volume popover, speed/loop/snapshot (Pictures/Lumen)/PiP/fullscreen, up-next rail, resume `watch_progress` (migration v6), codec error card + external player
- [x] `feat: viewer queues + entry wiring` — one queue = current view order, portal overlay (grid does not re-render), return-to-item on close
- [ ] Metadata: exifreader (EXIF-only fields) on top of the element metadata already in the info panel
- [ ] Return-to-item in **masonry**: its scroller has its own virtual window, so the reveal id is ignored there for now
- [ ] QA + screenshot pass in the real app (video playback needs a local file; the browser QA route cannot serve the asset protocol)

## Phase 5 — Organization features
- [ ] Favorites hearts + smart view; Albums (DB-only) UI; Trash (DB flag) + restore
- [ ] Search substring + filter chips; sort date/name/size/duration asc–desc
- [ ] Collage mode (2–6 items, mosaic split, per-tile view/play)
- [ ] QA + screenshot pass; `feat: favorites albums trash search collage`

## Phase 6 — Windows integration & polish — DONE (0.2.0)
- [x] Single-instance plugin; file associations (opt-in OpenWithProgids, HKCU only, reversible); launch-to-viewer fullscreen
- [x] External player fallback; Settings: cache size + clear, player path
- [x] Installer: NSIS currentUser, ru/en selector
- [ ] Prod metrics (STEP 6, measured on the built exe):
  - installer 4.3 MB (4,490,997 B); portable 16.9 MB
  - cold start 0.45 s click→window visible; RAM idle 181 MB (process tree)
  - RAM with 4K video open: n/a this session (user desktop was in use — no screen automation)
  - smoke: db migrated to com.unesell.lumen (9,390 rows), watch_progress writes (14 rows),
    single-instance second-launch exit 0 + focus, file-arg launch → viewer played
  - associations register/unregister round-trip: PENDING (needs a VM / spare profile, see audit backlog)
- [ ] Associations round-trip on a VM + uninstaller .reg dry-run (user-side checklist)
- [ ] Doc ffmpeg sidecar as v2 option in docs/SPEC.md
