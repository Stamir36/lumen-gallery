# LUMEN — Design System (Phase 0)

> **READ THIS FILE BEFORE ANY UI WORK.** Every UI decision must trace back to a
> token or rule in this document. If a rule is missing, propose it here first.

Visual language extracted from references (dark minimalist UIs): near-black
canvas, 1px hairline borders, monospace uppercase micro-labels, pill segmented
controls, glassy bars, generous negative space, one restrained accent.
Layouts/content of references are NOT copied.

---

## 1. Color Tokens

| Token | Value | Usage |
|---|---|---|
| `canvas` | `#0A0A0C` | app background |
| `surface-1` | `#121216` | cards, sidebar, panels |
| `surface-2` | `#1A1A20` | hover fills, inputs, icon-button hover |
| `border` | `rgba(255,255,255,.06)` | 1px hairlines, dividers |
| `border-hover` | `rgba(255,255,255,.12)` | hairline on hover |
| `text-primary` | `#F2F2F4` | headings, primary text |
| `text-secondary` | 62% white | body, labels |
| `text-tertiary` | 38% white | micro-labels, meta, placeholders |
| `accent` | `#6EC1FF` | interactive states + progress ONLY |
| `success` | `#3ECF8E` | positive status |
| `danger` | `#FF5C5C` | destructive actions |
| `warning` | `#F5B85C` | warnings |

Accent discipline: `#6EC1FF` is reserved for focus/active/progress. Never use it
for large decorative surfaces.

## 2. Radius

| Token | Value | Applies to |
|---|---|---|
| `radius-card` | 14px | cards, panels, modals |
| `radius-control` | 10px | inputs, small controls |
| `radius-viewer-bar` | 12px | floating viewer bars |
| `radius-pill` | 999px | buttons, chips, segmented controls |

## 3. Typography

- **UI:** Inter 400/500/600.
- **Mono:** JetBrains Mono 400/500 — micro-labels, timecodes, counts, paths, logs.
- **Micro-label:** 11px mono, uppercase, `letter-spacing: .12em`, tertiary color.
- **H1:** 20px / 600.
- **Body:** 14px / 400, line-height 1.55.
- Fonts bundled locally (woff2 in repo). No CDN.

## 4. Spacing & Layout

- 4pt spacing grid (4 / 8 / 12 / 16 / 24 / 32 / 48 …).
- Page gutters: 24px.
- Grid gap: 8px.
- No shadows except popovers: `0 12px 32px rgba(0,0,0,.55)`.
- 2% grain overlay app-wide (subtle SVG/noise, `opacity: .02`).
- Vignette only inside photo/video viewers.

## 5. Motion

- framer-motion springs: `stiffness: 260, damping: 26`.
- Hover transitions: 160ms ease-out.
- Pressed scale: `.98`.
- Grid reflow: layout animations.
- Route cross-fade: 180ms.
- Always honor `prefers-reduced-motion` (disable springs/layout animations,
  fall back to opacity-only or none).

## 6. Components

### 6.1 Buttons
- Pill shape (`radius-pill`), height 32px minimum.
- **Primary:** white bg, black text.
- **Ghost:** hairline border, transparent bg.
- Pressed: `scale(.98)`.

### 6.2 Icon buttons
- 32×32px, `radius-control`.
- Hover: `surface-2` fill.
- Hit area ≥ 32px (pad visually-smaller glyphs).

### 6.3 Segmented control (pill)
- Pill container, `surface-1` bg, hairline border.
- Active segment: `surface-2` fill + primary text; inactive: secondary text.
- Mono uppercase micro-labels allowed for view modes.

### 6.4 Chips / badges
- Pill, hairline border, 11–12px. Mono for numeric/meta chips (duration,
  resolution, res-fps-codec).

### 6.5 Top bar
- 48px height, glass: `canvas` at ~70% opacity + `backdrop-blur`.
- Hairline bottom border.
- Contains: breadcrumb/title + mono count, search, segmented view control,
  sort menu, selection toggle.

### 6.6 Sidebar
- 240px; collapsed rail 64px (icons only, tooltips on hover).
- Items: 32px height, icon 16px, radius-control hover `surface-2`.
- Capacity bars: 4px track (`surface-2`), accent fill, mono digits
  `free / total`.
- Bottom section: Settings, scan status (mono).

### 6.7 Status line
- Bottom-left, mono, tertiary color:
  `12,482 items - 348 GB - scanned 2s ago`.

### 6.8 Cards (grid)
- Radius-card; overflow hidden.
- Hover: inner image `scale(1.03)` (160ms ease-out), bottom gradient
  (transparent → rgba(0,0,0,.6)), mono chips bottom-left, heart button
  top-right appears, checkbox top-left appears.
- Video hover: preview loop after 400ms delay, center play glyph at 40% opacity.

### 6.9 Floating action bar (selection)
- Glass pill bottom-center, popover shadow allowed, radius-pill.
- Actions: favorite, add to album, collage, open containing folder, trash.

### 6.10 Viewer bars
- Floating, `radius-viewer-bar` (12px), surface-1/85 + blur, hairline border.
- Video controls auto-hide after 2s idle; any pointer movement reveals.

### 6.11 Popovers / menus
- `surface-1`, hairline border, radius-control, shadow
  `0 12px 32px rgba(0,0,0,.55)`.
- Items: 32px, hover `surface-2`.

### 6.12 Inputs / search
- `surface-2` fill, hairline border, radius-control, height 32px.
- Search focuses with `/`; Esc clears/blurs.

### 6.13 Empty states
- Dashed hairline box + mono uppercase label, tertiary color, centered,
  generous padding.

### 6.14 Loading
- `surface-2` shimmer skeletons matching the final layout exactly
  (grid rows, headers, bars).

### 6.15 Progress (scan, capacity, video)
- Track `surface-2`; fill `accent`; 2px default, 6px interactive
  (video progress on hover); buffered segment = ghost (white/12).

## 7. Focus & Accessibility

- `:focus-visible` ring: 2px `accent` at 40% opacity, offset 2px.
- All hit areas ≥ 32px.
- Full keyboard support in viewers (see SPEC §11).

## 8. Scrollbars

- 8px wide, transparent track, thumb white/12, hover white/20.

## 9. Do / Don't

- DO use mono uppercase micro-labels for section headers and meta.
- DO keep large negative space; don't cram controls.
- DON'T use accent for decoration, large fills, or non-interactive color.
- DON'T add shadows beyond the popover rule.
- DON'T import fonts from CDN.
