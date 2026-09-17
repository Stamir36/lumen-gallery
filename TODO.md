# LUMEN — Roadmap (Phases 1–6)## Deferred hardening (from fix batch, 2026-09-17)
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
