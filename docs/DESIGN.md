# LUMEN — Design System v2 «Soft Glass Editorial»

> **READ THIS FILE BEFORE ANY UI WORK.** Every UI decision must trace back to a
> token or rule here. Feel: Material You softness + matte frosted glass +
> andidea editorial whitespace. NOT a dense developer-tool.

## 1. Color Tokens

| Token | Value | Usage |
|---|---|---|
| `canvas` | `#0A0A0C` | app background |
| `surface-1` | `#141518` | cards, panels (tonal elevated) |
| `surface-2` | `#1E2023` | raised tonal surfaces, hover fills, inputs |
| `surface-3` | `#26282C` | highest elevation (dialogs, popovers) |
| `border` | `rgba(255,255,255,.06)` | hairlines — editorial dividers ONLY |
| `border-hover` | `rgba(255,255,255,.12)` | rare hover hairline |
| `text-primary` | `#F2F2F4` | headings, primary text |
| `text-secondary` | 62% white | body |
| `text-tertiary` | 38% white | micro-labels, meta |
| `accent` | `#6EC1FF` | interactive states + progress ONLY |
| `success` | `#3ECF8E` · `danger` `#FF5C5C` · `warning` `#F5B85C` | status |

Accent discipline unchanged: focus/active/progress only, never decoration.
Prefer **tonal elevation over borders**: replace most hairlines with surface
steps + soft ambient shadow. Hairlines remain only as editorial dividers
(section separators, table rows).

## 2. Elevation Levels

| Level | Recipe |
|---|---|
| `elev-0` | flat on canvas |
| `elev-1` | surface-1 + shadow `0 8px 24px rgba(0,0,0,.35)` |
| `elev-2` | surface-2 + shadow `0 8px 24px rgba(0,0,0,.35)` |
| `elev-3` | surface-3 + shadow `0 12px 32px rgba(0,0,0,.55)` (dialogs, popovers) |
| hover | lift −2px + shadow `0 12px 28px rgba(0,0,0,.4)` + faint accent glow `0 0 0 1px rgba(110,193,255,.18)` |

## 3. Glass Whitelist — v2.3

**backdrop-filter is allowed ONLY on small floating overlays:**
video player pill, top chips, filmstrip rail, scrub preview bubble,
floating selection action bar, context menu, scroll-top FAB, tooltips.
**FORBIDDEN on:** topbar, sidebar, dialogs, cards, segmented track,
settings panels. macOS-style muddy blur on structural chrome is a bug.

### 3.1 Dark glass recipe (v2.3 — the single place blur lives)

```
background: linear-gradient(180deg, rgba(14,14,18,.68), rgba(14,14,18,.55));
backdrop-filter: blur(28px) saturate(1.4);
border: 1px solid rgba(255,255,255,.08);
box-shadow: inset 0 1px 0 rgba(255,255,255,.10), 0 8px 24px rgba(0,0,0,.35);
border-radius: 999px (pills) · 16px (menu, bubble, filmstrip rail);
```

**Why dark:** the v2.2 white-tinted recipe (white 9%→3% + brightness 1.08)
washed out over white/bright frames — selection pill and context menu text
became invisible. The dark tint keeps the frosted look while guaranteeing
contrast over pure-white content.

**QA contract:** /style section 07 renders the same pill + context menu
over (a) pure white, (b) a bright photo, (c) pure black — text must be
readable in all three.

### 3.2 Structural chrome = solid tonal

- **Topbar:** `surface-1` solid + bottom editorial hairline.
- **Sidebar:** `surface-1` solid + right hairline.
- **Menus / dialogs:** `surface-2` solid, radius 16–20, border white/6,
  shadow `0 16px 48px rgba(0,0,0,.5)`.
- **Cards / settings panels:** `surface-1`/`surface-2` solid per v2.

Glass must still be tested over colorful content (/style section 07).

## 3.3 Accent Anchor Rule (kept from v2.1, unchanged)

Colorfulness without breaking monochrome discipline: **exactly 3–5 accent
anchors per screen**, nothing else:

1. **Active Segmented pill** — solid `#6EC1FF`, text `#0A0A0C`; inactive
   hover = white 8% pill.
2. **Active sidebar row** — accent 14% tinted glass + accent icon + accent
   counter.
3. **Capacity/progress bars** — accent fill/gradient.
4. **Editorial section numbers** ("01", thin 300).
5. **Hover glow + focus ring.**

NO other accent usage anywhere (no accent text, icons, borders, fills outside
this list).

## 4. Radii

| Token | Value | Applies to |
|---|---|---|
| `radius-card` | 22px | cards, panels, dialogs (20–24 range) |
| `radius-control` | 14px | inputs, buttons, menus (14–16) |
| `radius-viewer` | 16px | floating viewer bars |
| `radius-pill` | 999px | pills, chips, segmented |

## 5. Spacing & Layout (4pt grid)

- Card padding: 24–28. Grid gap: 12–16 (grid cards 12, sections 16).
- Sidebar row height: 44–48, gap 12 between groups.
- Page gutters: 32–40. Section rhythm: 48–64 vertical between sections.
- Grain overlay 2% app-wide; vignette only in viewers.

## 6. Typography — v2.4 (FIX 5)

Two families plus one narrow exception, all bundled locally via @fontsource:

- **Display (page titles):** 28–40px / 650, tight leading (1.1). **Manrope.**
- **Section titles:** 18–20px / 600. Manrope.
- **Body / UI copy:** 14–15px / 400, lh 1.55. **Manrope Variable** — the code
  font is gone from the interface.
- **Technical micro-text** (counters, chips, micro-labels, status line, table
  headers, timecode chips in the grid): **Space Grotesk Variable** with
  `font-variant-numeric: tabular-nums` + `"tnum" 1`. Applied by the
  `.font-mono` rule in index.css, so every existing `font-mono` call site
  inherits it — tabular figures are mandatory for anything that ticks.
- **`.timecode` (JetBrains Mono Variable):** player timecodes and raw file
  paths ONLY. Decision recorded: Space Grotesk's tabular digits are
  metric-consistent, but a fixed-advance monospace still reads better for a
  running clock and for path strings, so JBM survives in exactly those two
  places and nowhere else.
- Micro-labels: 11px uppercase ls .12em, tertiary — **max 1–2 per screen**.
- Andidea touch: oversized thin accent section numbers ("01", 28–40px,
  weight 300, accent color) next to section titles.

## 7. Control Heights (chunky)

| Control | Height |
|---|---|
| Button (pill) | 44 (desktop default), 48 (page-level primary) |
| Icon button | 40 (44 for primary floating actions) |
| Input / search | 44 |
| Sidebar row | 44–48 |
| Segmented | 44, segments 40 |
| Slider | track 4px, thumb 18px white, accent fill left |
| Menu item | 40 |
| FAB | 56, radius 20 |

## 8. Motion

- framer-motion springs 260/26; hover 160ms ease-out.
- Hover: lift −2px (translateY) + soft shadow + faint accent glow.
- Pressed: scale .97. Route cross-fade 180ms.
- Honor `prefers-reduced-motion`.

## 9. Focus & Scrollbars

- Focus-visible: 2px accent/40, offset 2. Hit areas ≥ 40px for chunky controls.
- Scrollbars 8px, thumb white/12 → hover /20.

## 10. Components (v2 summary)

- **PillButton:** h-44 pill. Primary white/black; ghost = tonal surface-2 (no
  border), hover surface-3; danger text-only.
- **IconButton:** 40×40, radius-control, tonal, hover surface-2 + lift.
- **GlassCard:** radius-card, surface-1, elev-1, padding 24–28; hover lift.
- **Chip:** pill, glass tonal fill, mono for meta; 12px.
- **Segmented (chunky):** h-44 pill, glass bg, active segment surface-3 +
  primary text, layout-animated thumb.
- **Slider (soft):** 4px track surface-2, accent fill, 18px white thumb,
  shadow-popover on thumb; value chip mono.
- **GlassTopBar:** 64px, glass recipe, no bottom hairline (glass edge enough).
- **Sidebar:** 260px / 68px rail, glass, rows 44–48, capacity bar 6px accent.
- **FAB:** 56px, radius 20, glass-elev-2, accent glyph for primary action.
- **Dialog / Menu:** glass elev-3, radius-card / radius-control, items 40px.
- **Empty state:** dashed hairline + mono label (kept).
- **Skeletons:** surface-2 shimmer (kept).

## 11. Do / Don't

- DO prefer tonal elevation + glass; borders only as editorial dividers.
- DO give elements air: 24+ padding, 12+ gaps, 48+ section rhythm.
- DON'T use mono for UI copy; metadata only.
- DON'T use more than 1–2 uppercase micro-labels per screen.
- DON'T flatten hover states — always lift + glow.
