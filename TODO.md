# LUMEN — Roadmap (Phases 1–6)

Phase 0 (docs) — done: `docs/SPEC.md`, `docs/DESIGN.md`, `.clinerules`, `TODO.md`.

## Phase 1 — Project skeleton
- [x] Scaffold Tauri v2 + React 18 + Vite + TS strict + Tailwind v4 + shadcn/ui (hand-rolled shadcn-style on Radix)
- [x] Install zustand, @tanstack/react-query, framer-motion, lucide-react, react-virtuoso, exifreader (exifreader deferred to Phase 4 — metadata phase)
- [x] Bundle Inter + JetBrains Mono locally (@fontsource-variable, no CDN)
- [x] Define design tokens in Tailwind v4 `@theme` per docs/DESIGN.md (also as CSS vars)
- [ ] tauri-plugin-sql wired, SQLite migrations v1 (items, roots, albums, album_items, favorites, trash flag, watch_progress, settings) — planned next in Phase 2 (DB is scanning-related)
- [x] App shell: canvas + grain overlay + scrollbars; /style living style sheet (screenshot QA pending first build)
- [ ] Conventional commit `feat: design system`

## Phase 2 — Libraries & scanning
- [ ] Rust: fs walk (whitelist, skip hidden/system), volumes info, fs watch (2s debounce)
- [ ] Onboarding: volume list (capacity bars, mono digits), drag-drop folder
- [ ] Scan pipeline: dedupe path+mtime+size, incremental rescan, live counters + mono log feed
- [ ] Ejected-drive safe behavior
- [ ] Settings: manage libraries, per-root rescan
- [ ] QA + screenshot pass; `feat: libraries and scanning`

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
