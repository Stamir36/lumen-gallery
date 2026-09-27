# Changelog

All notable changes to LUMEN are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org).

## [Unreleased]

### Added

- **Profiler history graphs** (Developer overlay) — an FPS sparkline over the
  last 30 s (ring buffer, 120 points, 60 fps guide line) plus an event strip
  marking video loads, seeks and buffering stalls on the same timeline. Two
  CAUSE layers sit on the graph: red bars for the DECODER's dropped frames
  (bars up + fps down = heavy format; bars empty + fps down = the UI thread)
  and an amber line for seconds of video buffered ahead (a falling line
  precedes every stall). The history lives outside the React store, so
  graphing it adds no per-frame re-renders. A screenshot of the overlay now
  shows the TREND and its cause, not just the current numbers.
- **Video profiling** (Developer overlay) — the profiler now watches the video
  player: source→first-frame load time, last-seek latency, seek count/worst and
  buffering stalls, each turned into a plain-language diagnostics finding
  ("slow to decode/seek", "slow source or storage") when a threshold is hit.
- **Fixed the whole profiler diagnostics block never interpolating** — every
  string used `{ms}`-style placeholders while the app's i18next is configured
  for `{{ms}}`, so users saw raw `{ms}` in the findings.
- **"Show in gallery" on the disk page** — every heaviest-files row gets a
  button that jumps into the app's own viewer at that file (route + viewer
  position), not just the Explorer reveal.

- **Hidden Developer section** (Settings, after the 5-logo-click easter egg) —
  a profiler toggle with an in-viewport overlay: live FPS, worst frame, long
  tasks, blocked time and JS heap, plus an automatic diagnostics block that
  turns the counters into plain-language findings and hints. The overlay docks
  to any corner (picker in the section), and the developer-only "allow text
  selection" and "FPS counter" switches moved here from Appearance.
- **Recycle-bin honesty on removable drives** — Windows keeps a recycle bin on
  fixed drives only; on a removable volume (verified: D:, DriveType 2, no
  `$Recycle.Bin`) the shell API deletes permanently while reporting success,
  which silently violated the app's "recoverable delete" promise. `trash_delete`
  now refuses such deletes with an explicit error instead of losing data.

### Changed

- **Settings search redesigned** — the field moved into the left section nav
  (quiet, tone-matched, no floating bar over the page content) and now sits at
  the TOP of the nav, before the section list. Row filtering and self-hiding
  sections work as before.
- **Window drag on every page** — the tool pages with their own slim headers
  (duplicates, disk, play) and the full-window slideshow route now embed the
  shared drag region, so the frameless window can be moved from anywhere; it
  was fixed chrome before (user note).
- **Easter egg discoverability** — the About screen now says the logo gesture
  exists (and flips to "developer mode on" once unlocked); the 5-click secret
  was otherwise unfindable.
- **Button hovers de-jumped** — the y-lift on IconButton, PillButton, FAB and
  the EmptyState CTA is replaced by a shadow/scale affordance; buttons no
  longer "jump" under the cursor (user note). Grid cards keep their optional
  lift behind the cardHover setting.

### Fixed

- **Mini-player rebuilt** (user bug report): the timeline chased the cursor
  off-screen while scrubbing (pointer capture was taken on the thumb, which
  re-renders mid-drag — capture now lives on the track, ratios are clamped,
  and a window pointerup releases the drag); the top strip is gone (name +
  close moved into the glass pill) and the whole window now drags from any
  empty spot, not just the caption.
- **Memory game restarts by itself** — the deck was derived from the live media
  query, so every background refetch re-dealt the board mid-game. The deck is
  now snapshotted into state when a round starts and is never rebuilt from
  query data; the hover y-lift (read as "cards jumping") is replaced by a
  shadow-only hover affordance.
- **Duplicates page thumbnails** — items with a stale/missing cached thumb and
  videos were never enqueued (the old guard skipped anything with a `thumbPath`
  and only ever called the image engine). All items now route through the
  shared generator pipeline, so video captures regenerate instead of showing
  the bare "MP4" chip forever.
- The memory game card no longer appears on the Tools hub at all — the easter
  egg stays reachable only by typing the /play route.
- **Restored lost search i18n keys** — `settings.search_placeholder` and
  friends leaked out of en/ru during the redesign and rendered as raw keys
  (user screenshot); re-added and synced with the new profiler/disk/easter-egg
  strings in both languages.

## [0.3.0]

### Added

- **Settings search** — one field filters the whole page: every row matches on
  its own label and hint, sections with nothing left hide themselves, and the
  sticky field keeps working while the filtered list is short. This was the
  first thing needed as the page kept growing.
- **Hidden photo-memory game** («Память») — an easter egg behind the About-logo
  gesture (5 clicks): a card board dealt from the library view you were just
  in, CSS-3D flips, pairs / moves counter and a win state. It is a game, so it
  lives on its own screen and its Tools card only renders once unlocked.
- **Android build preparation** — the Rust dependencies are split per platform
  (tray icon, HKCU associations, the OS recycle bin and single-instance are
  desktop-only and leave the mobile dependency graph entirely), the desktop-only
  modules get stubs with the same signatures (`src/mobile_stubs.rs`), so no
  `#[cfg]` leaks into shared code, and `commands::trash_delete` refuses on
  mobile rather than unlinking. `scripts/setup-android.ps1` installs the
  toolchain (JDK check, cmdline-tools, platform 35, build-tools, NDK, Rust
  targets), `pnpm android:init | android:dev | android:build` drive the APK, and
  [docs/ANDROID.md](docs/ANDROID.md) documents the whole path plus the gaps that
  remain (SAF folder picking, intent-filter associations, own trash folder).
- **Sidebar visibility setting** (Settings › Behavior) — a switch per row.
  Drives and the tools hub are structural and stay; everything else is the
  user's to trim, and future rows default to visible because the stored value
  is the hidden set, not the visible one.
- **Duplicates convenience pass** — sort by biggest win or by copy count,
  big groups collapse behind a "+N more" tile, and a floating glass bar offers
  "keep one in each group" for the whole report with a per-group progress
  readout.
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

- **The update check failed with a full quota left** — it called the GitHub
  REST API, which is rate-limited per IP, and a shared exit IP (VPN/CGNAT)
  burns the 60/h allowance for everyone behind it. The check now runs through
  a Rust command that HEADs `releases/latest` and reads the tag from the
  redirect's final URL — no API, no rate limit, no CORS.
- **The duplicate-scan progress bar was invisible on the first scan** — it
  rendered inside the summary block that only exists after groups arrive; the
  bar now lives above the results and is visible from the first moment.
- **The sidebar drive capacity bar ignored hover** — the track, fill and
  caption now light up together with the drive row (one `group/row`).
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

- **Tool page headers are quiet now** — `Segmented` gained `size="sm"` (32px) and
  `tone="quiet"` (active segment is tonal, not a solid accent pill), the
  duplicates header keeps one small size group plus a compact sort menu instead
  of two chunky pill groups, and the disk view switch shrank to match.
- **Rows that carry buttons breathe** — the update check and the file
  associations rows now follow the same 64px / py-4 rhythm as every other
  settings row instead of a cramped one-off padding.
- **Disk space tool restyled** to match the duplicates finder: the total is the
  page headline in the hero slot, every list lives in a tonal elev-1 card, bars
  share one accent gradient, a row armed for deletion wears a ring instead of
  turning into a red box, and the fetch shows an indeterminate bar while the
  single SQL pass runs.
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
