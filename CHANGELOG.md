# Changelog

All notable changes to LUMEN are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org).

## [Unreleased]

### Added

- **Project website** — a dependency-free landing page in `site/` (English and
  Russian, plus the privacy policy), published to GitHub Pages by
  `.github/workflows/pages.yml`: <https://stamir36.github.io/lumen-gallery/>.
- **Microsoft Store packaging** — `pnpm build:store` builds the installer with
  `src-tauri/tauri.microsoftstore.conf.json`: offline WebView2 installer,
  explicit publisher name and no interactive installer UI, which is what a Win32
  Store submission requires.
- **Personalization wizard on first run** — language, accent, interface density,
  corners and behavior in four steps, with a live miniature of the library that
  follows every choice. It ends with a real summary panel and remembers that it
  has been seen.
- **Background (tray) mode** — opt-in switch. When enabled, closing the window
  parks LUMEN in the tray (left click shows it, right click offers *Open* /
  *Exit*), so the next launch and the next file open are instant. Off by
  default: closing the app quits it and frees the WebView2 memory.
- **Corner language presets** (sharp / default / round) applied to the whole UI
  through one attribute.
- **Micro-animation switch** — one control that stills every transition in the
  app, CSS and Framer Motion alike.
- **Behavior section in Settings** — autoplay, swipe navigation, hover captions,
  tray mode, excluded files and thumbnail worker count in one place.
- **View-change motion** — switching between smart views, libraries, folders and
  the explorer gives the grid a 140 ms rise instead of a hard cut.
- **Settings navigation pill** that slides between sections.
- **Custom cursor option** (Settings › Personalization, off by default) — the
  drawn LUMEN pointer: a white arrow with an accent dot tail, pressed state
  included. Also available as `assets/cursor.svg`.
- **About in the settings nav** and a **developer-mode easter egg**: the
  text-selection switch is hidden until the About logo is clicked five times
  (the unlock persists).

### Fixed

- **The setup wizard no longer runs off its own step list** — pressing *Next* on
  the last step used to advance into empty screens forever; it now finishes.
- **Blank `#/settings` and `#/onboarding` pages outside Tauri** — a window API
  call threw inside an effect and unmounted the whole route.
- **Duplicate date-header keys in the grid** — sorting by *date added* while
  grouping by *date shot* produced repeated group keys, which broke the
  virtualizer's size map and left date headers with no rows under them.
- **Clipped active tile in the viewer filmstrip** — the highlight is painted
  inside the tile now, so the virtualized list can no longer cut it off.
- **Card animation is on by default**, and an explicit `false` still wins.
- **Accent stripe on the active navigation row** removed — it read as a stray
  border against the tinted pill.
- **Pointer cursor no longer covers the whole window** — the opt-in class on
  `<html>` collided with the Tailwind utility of the same name and cursor
  inherits; it is a scoped data-attribute now.
- **The titlebar version pill matches the About screen** — the hard-coded v0.1
  was replaced by a quiet pill fed from the app version.
- **Main-layout diagrams** — the two wizard cards (and the new Settings cards)
  show the real geometry of each shell instead of two near-identical slabs.

### Changed

- Settings page rebuilt on shared row/switch/pill primitives; the Appearance
  section was trimmed and Behavior extracted.
- Masonry tiles glide to their new slots when the layout re-packs instead of
  snapping.

## [0.2.0]

Pre-public baseline: indexing and filesystem watching, four grid layouts,
folder explorer, lightbox and video player with resume positions, collage and VR
dome, favourites/trash/recents, search and filters, colour correction, file
associations, mini-player, hotkey sheet, accent theming, Russian and English.
