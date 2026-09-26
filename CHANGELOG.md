# Changelog

All notable changes to LUMEN are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org).

## [Unreleased]

### Added

- **Project website** — a dependency-free landing page in `site/` (English and
  Russian, plus the privacy policy), published to GitHub Pages by
  `.github/workflows/pages.yml`: <https://stamir36.github.io/lumen-gallery/>.
- **Microsoft Store packaging (MSIX)** — `pnpm build:msix` packages LUMEN
  through `src-tauri/msix/Package.appxmanifest` and `scripts/build-msix.ps1`.
  Windows installs the package, the Store signs it for free and hosts it, so
  this route needs no code-signing certificate and no download URL of your own.
  The package carries `lumen.exe` alone (~6 MiB) and runs against the machine's
  Evergreen WebView2 runtime; the manifest declares the file type associations,
  because a packaged app's writes to HKCU land in a private hive that Explorer
  cannot see.
- **Linked-installer build for the Store (fallback)** — `pnpm build:store` (or
  `build-store.bat`) builds the offline-WebView2 installer that the EXE/MSI
  route needs: per-user silent install, no installer UI, publisher set. It takes
  a certificate to sign, so it is the fallback, and its 210 MiB is published as
  a release asset rather than committed.
- **Code signing hook** — `scripts/sign-file.ps1` is wired to Tauri's
  `signCommand`, so the application binary, every NSIS plugin and the finished
  installer are signed in one pass (the linked-installer route requires all of
  them). It is a no-op until `LUMEN_SIGN_PFX` / `LUMEN_SIGN_THUMBPRINT` is set.
- **Slideshow** — hands-off playback of whatever the grid is showing: photos
  only, a slow Ken Burns drift, shuffle, 3–20 s slide duration and an optional
  file-name caption, started from the library bar next to the sort control (or
  by opening `/slideshow`). It reads the current view out of the same query the
  grid uses, so it opens instantly, needs no new backend call, and leaves the
  grid untouched underneath. Slide duration and caption are remembered.
- **Tools page** — a hub for the app's instruments, with animated cards and
  room for future tools. The duplicate finder moved here from the sidebar, so
  the sidebar is a pure library list again (drives + smart views). The page is
  a full screen with its own title bar, back button included, and follows the
  design system: tonal cards, no gradients, mono only for metadata.
- **Disk space tool** — "where did my drive go" for the indexed library: the
  heaviest files with size bars and thumbnails, the same bytes grouped by
  format, and per-library totals. Read-only — one SQL pass per view, no file
  is ever opened; the only action is "show in Explorer".
- **Update check** — Settings › About gains an explicit "Check for updates":
  one press queries the GitHub releases API of
  `Stamir36/lumen-gallery`, and a newer published version offers to open the
  releases page in the browser. A local build that is AHEAD of the latest
  release (development) is told nothing rather than "downgrade", and nothing
  is fetched at boot — the check belongs to the user, not the startup.
- **Slideshow polish** — slides now crossfade through a pre-decoded next
  picture (the transition never waits on the disk, which read as a black gap),
  the stage rises with a slight zoom when the show opens, and the control pill
  picks up a backdrop blur.
- **Duplicate finder** — finds files that share their content and shows them as
  groups, biggest waste first, with how much recycling the extras would return.
  The comparison narrows in three passes — equal file size in SQL, then a hash
  of the first 64 KB, then the whole file — so only the files that survive each
  pass are ever read end to end, and files under 1 MB are left out unless you
  lower the floor. You pick which copy to keep; the rest go to the Recycle Bin
  through the existing "delete forever" path, and nothing is ever unlinked.
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

- **The sidebar's tools row was labelled "Library"** — the `tools.title` string
  carried the wrong text in both locales, so the wand row duplicated the app
  section header instead of naming the hub. It now reads *Tools /
  Инструменты*, and the tools page dropped its redundant micro-label (the
  sidebar row is the section marker).
- **The language switcher no longer appears twice** — it was a sidebar footer
  dropdown *and* a Settings row; the sidebar copy is gone (Settings keeps it).
- **The Store listing could not be submitted** — the installer behind the linked
  URL was a plain `pnpm tauri build` artifact, whose WebView2 "download
  bootstrapper" fetches the runtime while setup runs. Microsoft classifies that
  as a downloader stub, so its validation could not complete an unattended
  install and refused the submission with *«модули PackageSet недействительны»*.
  The Store route is now an MSIX package instead: nothing is downloaded during
  setup, Microsoft signs and hosts it, and the linked-installer build remains as
  a documented fallback for the day a certificate is worth buying.
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
- **Tools hub cards redesigned** per DESIGN.md: oversized thin accent numbers
  ("01", "02"), live per-card library metadata (file count / indexed bytes)
  in mono, arrow affordance on hover, and a dashed "coming soon" placeholder
  for future tools.
- **Duplicates page redesigned**: the reclaimable-bytes figure is now the page
  headline (hero summary with group/file counters beside it), duplicate groups
  are tonal elev-1 cards with a leading "N × size" stat, the kept copy is a
  ring + bottom caption instead of a floating badge, thumbnails are clickable
  to switch the keep choice, and the pending scan shows an indeterminate
  accent bar until the first progress event arrives.
- **The sidebar groups library from tools** — the tools row is separated by an
  editorial hairline (`SidebarItem.divider`), so the menu reads as two
  sections instead of one undifferentiated list.

## [0.2.0]

Pre-public baseline: indexing and filesystem watching, four grid layouts,
folder explorer, lightbox and video player with resume positions, collage and VR
dome, favourites/trash/recents, search and filters, colour correction, file
associations, mini-player, hotkey sheet, accent theming, Russian and English.
