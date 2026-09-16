# LUMEN — Roadmap (Phases 1–6)

## Deferred hardening (from fix batch, 2026-09-17)
- [ ] Consolidate library stats on @tanstack/react-query (App.tsx currently hand-rolls useEffect + useState for libraryStats)
- [ ] Restrictive CSP in tauri.conf.json — needs dev/prod split (`devUrl` requires relaxed CSP), do in packaging phase
- [ ] Offline media UI: gray tiles per contract in scan.rs (offline flag, migration v2); `root-offline` event available

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

## Phase 3 — Library grid UI
- [ ] Sidebar 240/64 rail: roots + capacity bars, Favorites, Albums, Videos, Images, Recents, Trash, settings/scan status
- [ ] Top bar 48px glass: breadcrumb + mono count, search (`/`), segmented view control, sort menu, selection toggle
- [ ] Justified grid (220px rows, 8px gap), masonry/square/list modes, sticky mono date headers + counts
- [ ] Virtualization for 50k items (react-virtuoso), layout animations
- [ ] Card hover interactions; video hover preview (400ms, 4-worker thumb queue, webp 480w, dominant-color placeholder)
- [ ] Selection + floating glass action bar; status line bottom-left
- [ ] Perf validation: cold start < 1.5s (10k cached), 60fps scroll, scan 10k < 5s
- [ ] QA + screenshot pass; `feat: library grid`

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
