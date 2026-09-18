# LUMEN вЂ” Architecture Audit (K3, 2026-09-18)

Scope: read-only audit at `HEAD = 927b3e9` (master, Phase 0вЂ“6 complete, pre-Phase-7).
Method: full line-by-line read of `src-tauri/src/*.rs` (13 files), `src/lib/*.ts`,
`src/components/**`, `src/pages/**`, `src/state/**`, `tauri.conf.json`,
`capabilities/default.json`, `Cargo.toml`; cross-checked against `docs/SPEC.md`,
`docs/DESIGN.md` v2.4, `TODO.md`, `git log`. All items from `docs/AUDIT-2026-09-17.md`
(S1.1вЂ“S1.12) were re-verified as **fixed** and are NOT re-reported. Every claim cites
`file:line` verified against the actual code. Anything not provable from code is marked
UNCONFIRMED.

---

## Executive summary

- **The codebase is in genuinely good shape.** The Rust/JS boundary matches SPEC В§15,
  the single-writer pattern works, the thumbnail pipeline (version-keyed, visible-first,
  durable via writer events) is the best-designed subsystem, and the 2026-09-17 audit
  fixes all landed with regression tests. Video-element and timer lifecycle hygiene on
  the frontend is unusually disciplined.
- **Two P0 security holes share one root cause: the webview is trusted too much.**
  `db_exec`'s prefix whitelist admits arbitrary writes (incl. a settingsв†’process-launch
  chain), and the VR media server's canonicalize-fallback + `Access-Control-Allow-Origin: *`
  lets any webpage on the machine read library files past a symlink/TOCTOU gap. Neither
  needs network access вЂ” both need only JS running in *any* local context.
- **The biggest correctness risk is silent, not loud:** fire-and-forget writes
  (`thumb_ok`, `progress`, `folder_exclusion`) discard send/SQL errors, so a writer
  panic or flush failure becomes thumbnails/resume-positions/exclusions that quietly
  never persist вЂ” the UI still toasts success (`commands.rs:981-995`).
- **Scale cliffs are documented but real:** `list_media` reads the whole table and
  sorts/filters in Rust (`commands.rs:708-777`); the thumbnail queue never drops
  off-screen work (`thumbs.ts:138-170`); the watcher debounce starves under continuous
  churn (`watch.rs:117-132`). All fine at 9.4k rows, all degrade before the 50k SPEC target.
- **Recommended Phase 7 order:** (1) P0.1 + P0.2 security fixes (~1.5 days),
  (2) writer liveness + exclusion oneshot (~1 day), (3) CSP enablement (~ВЅ day),
  (4) focus-management + ThumbTile-retry UX fixes (~1 day), (5) assoc unregister
  round-trip on a VM (still pending per `TODO.md:148` вЂ” the P2.1 encoding bug below
  means it likely never worked).

---

## P0 вЂ” Critical (data loss / security / crashes)

### P0.1 вЂ” `db_exec` prefix whitelist admits arbitrary writes and subquery exfiltration

`src-tauri/src/commands.rs:287-296`:

```rust
const ALLOWED: &[&str] = &[
    "UPDATE media SET favorite",
    "UPDATE media SET trashed",
    "INSERT INTO settings",
    "UPDATE settings",
    "DELETE FROM media WHERE id",
];
if !ALLOWED.iter().any(|a| sql.starts_with(a)) { ... }
```

The gate is a `starts_with` prefix match; everything after the prefix is free-form.
Within the 4 096-byte limit (`commands.rs:297`) a caller can send:

- `UPDATE settings SET value = (SELECT group_concat(path, char(10)) FROM media) WHERE key = 'external_player'`
  вЂ” a **subquery** that exfiltrates the full library file listing into a settings row
  the frontend will happily read back. Prefix-matches `UPDATE settings`.
- `DELETE FROM media WHERE id IN (SELECT id FROM media)` вЂ” wipes the entire media table;
  still prefix-matches `DELETE FROM media WHERE id`.
- `INSERT INTO settings(key,value) VALUES ('extensions','exe,bat,cmd')` вЂ”
  settings-poisoning that widens the scan whitelist to executables (`scan.rs` reads the
  value verbatim; `kind_for_ext` then classifies them as "video").
- `UPDATE settings SET value = 'C:\evil\p.exe' WHERE key = 'external_player'`, then any
  later `open_external` вЂ” `commands.rs:198-222` passes `player` straight into
  `cmd /C start "" <player> <path>` with **no exe validation** (the `check_player`
  command at `commands.rs:103-107` is a separate, UI-only probe). One whitelisted SQL
  write becomes arbitrary process launch.

### P0.2 вЂ” Media server `is_allowed` canonicalize-fallback + symlink escape, on a wildcard-CORS loopback endpoint

`src-tauri/src/media_server.rs:76-78` + `:89-98`:

```rust
pub fn canon(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())  // fallback = RAW path
}
```

`starts_inside` (`:101-103`) is `Path::starts_with` вЂ” component-aware, so no
`C:\root` vs `C:\rooted` confusion. But two real holes:

1. **Canonicalize failure в†’ raw path.** An NTFS junction/symlink planted inside a root
   (by another process, or shipped in an extracted archive) resolves at `File::open`
   time (`:251`) to outside the root, while the prefix compare ran against the
   unresolved form. `target.is_file()` follows the link, but the *string* compared is
   unresolved. Classic symlink escape/TOCTOU.
2. **Offline-root canonicalize.** `refresh()` (`:60-72`) builds `allow.roots` via the
   same `canon` fallback; a root whose drive is offline at refresh time stays in raw
   form and matches (or fails) by lexical luck.

Why this matters: the server binds `127.0.0.1:0` (`:197`) with
`Access-Control-Allow-Origin: *` (`:178`) вЂ” **any webpage in any browser** can
`fetch("http://127.0.0.1:<port>/stream?path=вЂ¦")` and read whatever the guard lets
through; the port is logged and loopback port-scanning from JS is cheap. CORS `*` is
*required* for the VR canvas (module doc `:1-11`), so the path guard is the *only*
barrier, and there is no auth token on the URL.

**Fix:** (a) reject the request when `canonicalize` errors instead of falling back to
raw; (b) open-then-verify (canonicalize after `File::open`, or
`GetFinalPathNameByHandle`) to kill the TOCTOU; (c) mint a per-process secret in
`start()` and require `?tok=` on every request, appended by `url_for`.
**Effort:** ~1 day. `cache.rs:12-21,36-40` already contains the correct
symlink/reparse-point rejection template.

---

## P1 вЂ” Important (perf / UX / maintainability), with fix estimates

### P1.1 вЂ” Writer task panic в†’ silent, permanent loss of thumbnails/progress/exclusions

`src-tauri/src/writer.rs:170` (`mpsc::channel::<Write>(4_096)`). The quiet-period
suicide from the old audit is fixed (regression test `writer.rs:490-527`). Remaining
failure mode: if `writer_loop` ever panics, the `Receiver` drops with the task;
`Sender` clones live forever in managed state (`lib.rs:210-211`). Two divergent outcomes:

- `exec`/`reset_thumbs` (`writer.rs:102-113`, `:147-156`) fail *loudly* ("writer task
  stopped" в†’ `db_exec` error в†’ toast). Good.
- `thumb_ok`/`thumb_err`/`progress`/`folder_exclusion` (`writer.rs:116-145`) are
  `let _ = self.tx.send(...).await;` вЂ” **errors silently discarded**. `thumb_record`
  (`commands.rs:254-274`) and `save_progress` (`commands.rs:64-74`) then return `Ok(())`
  having lost the write. User symptom: thumbnails that never persist, resume positions
  that stop saving, "excluded" folders that aren't вЂ” with zero UI signal.

**Fix:** `log::error!` on every fire-and-forget send failure; supervise the loop
(return the `JoinHandle`, watchdog respawn). **Effort:** ВЅ day.

### P1.2 вЂ” `flush_guarded` drops the whole batch on second failure; UI already painted the thumb

`src-tauri/src/writer.rs:373-390`: on double failure (or retry panic) the batch is
dropped, `thumbs-ready` never fires, only `log::error!` records it. Meanwhile
`generate_thumbs` (`thumbs.rs:463-468`) emits per-row `thumb-result` from values that
only *queued* the write via fire-and-forget `thumb_ok` (`thumbs.rs:317-327`). So the
tile paints a `thumb_path` that may never reach the DB; next launch `media.thumb_path`
is NULL while the file exists on disk в†’ cold-cache re-decode storm вЂ” the exact pathology
the writer was built to remove. No re-queue, no dead-letter, no compensating event.

**Fix:** on double-failure re-queue once into a bounded retry buffer (or clear
`thumb_mtime` so the next scan retries) and emit a `thumb-batch-lost` event the UI can
re-enqueue from. **Effort:** ВЅ day.

### P1.3 вЂ” `exclude_folder` / `restore_folder` return `Ok(())` even when the write failed

`src-tauri/src/commands.rs:981-995` вЂ” fire-and-forget `folder_exclusion`
(`writer.rs:136-145`) swallows both the mpsc send error *and* the SQL result
(`writer.rs:283-290` logs `warn!`; the caller can't see it). The UI
(`src/components/settings/ExcludedFolders.tsx:26-35`) toasts "restored" on `onSuccess`
вЂ” which fires even if the DB write never happened. The media-server allow-list
(`media_server.rs:60-71`) refreshes from `excluded_folders`, so an "excluded" folder
remains servable over the CORS endpoint until something else triggers a refresh.

This breaks the `.clinerules` contract ("all invoke errors must be surfaced") **by
construction**, on a privacy-relevant action.
**Fix:** give `Write::FolderExclusion` a oneshot like `ResetThumbs` and return the real
result. **Effort:** 1 h.

### P1.4 вЂ” `list_media` full-table read; `limit`/`offset` applied in Rust after `SELECT *`

`src-tauri/src/commands.rs:708-777`: builds `SELECT * FROM media WHERE trashed = 0 [AND вЂ¦]`,
`fetch_all`s the whole result, filters `dir`/`q` and sorts **in Rust** (`:749-771`),
then `skip(offset).take(limit)`. The clamp at `:721` (`limit.unwrap_or(500).clamp(1, 200_000)`)
doesn't bound the SQL вЂ” the full row set crosses sqlx decode + IPC on every call.
`open_file`'s queue query (`:677-685`) is likewise unbounded. At 9.4k rows this is
fine; at 100k every grid refetch, favorite toggle (`invalidateAfterWrite` в†’ `["media"]`
in `mediaActions.ts:67-71`) and trash follow-up re-pulls and re-serializes the whole
table.

**Fix:** push `dir` into SQL (a `parent_dir` column, or `path >= ? AND path < ? ||
char(0x10FFFF)`), `q` via `instr(lower(path), ?)`, `LIMIT ? OFFSET ?` in SQL; keep Rust
sort only for the justified-layout subset. **Effort:** 1 day + index on
`(trashed, excluded, root_id, parent_dir)`.

### P1.5 вЂ” Watcher debounce starves under continuous churn; thread-per-root with 200 ms stop-poll

`src-tauri/src/watch.rs:87-145`: each watcher thread polls the stop channel via
`recv_timeout(200ms)`, and the debounce inner loop resets `waited = ZERO` on **every**
event (`:123`). Under a continuously-changing directory (downloads folder, Lightroom
export) `waited` never reaches `debounce` в†’ the rescan never fires вЂ” **indefinite
starvation**, not coalescing. Correct pattern: fire at most once per window measured
from the *first* event. Also N roots = N extra threads + NГ—5 wakes/s.

Separately, `remove_root` (`commands.rs:444-458`) stops the watcher *before*
`DELETE FROM roots`, but a scan already in flight from that watcher holds the per-root
`AsyncMutex` (`scan.rs`) and can upsert with the deleted `root_id` after the delete в†’
FK violation в†’ logged error, no corruption, but noisy.

**Fix:** cap the window with a `last_fired` timestamp; consider one `notify` watcher
with N paths. **Effort:** ВЅ day.

### P1.6 (B1) вЂ” ThumbTile "missing thumb file" retry is dead code вЂ” tile shimmers forever

`src/components/library/ThumbTile.tsx:90-96` calls `store.forget(media.id);
enqueueRows([media])` on `<img>` error, with the comment "retries at most twice". But
`src/lib/thumbs.ts:563` in `enqueueRows` does `if (asked.get(r.id) === version) continue;`
вЂ” `asked` was set when the row was first seeded/enqueued (`thumbs.ts:131`, `:566`) and
`forget()` (`thumbs.ts:58-63`) never clears it. So the re-enqueue is silently skipped;
### P1.7 (B2) вЂ” App subscribes to the whole scan store в†’ full-shell re-render per scan-progress event

`src/App.tsx:72`: `const { scanningRootId, done, added, lastScanAt } = useScanStore();`
вЂ” no selector, so App re-renders on *every* `applyProgress` (`state/library.ts` sets
`done/total/currentPath/log` per event). Scan events can arrive per walked file; at a
50k-file rescan that is tens of thousands of full App re-renders dragging `MediaGrid`
(not memoized) and every mounted card along вЂ” precisely while the user is watching the
UI. Only `scanningRootId !== null` and `lastScanAt` are actually consumed by App;
`done/added` are used by Onboarding only.

**Fix:** individual selectors (`useScanStore((s) => s.scanningRootId)` etc.).
**Effort:** ~10 min.

### P1.8 (B3) вЂ” Ambient layer ignores measured dimensions вЂ” a second full decoder for videos with unknown dims

`src/components/viewer/VideoPlayer.tsx:228-231`: `ambience` is memoized on
`[reduced, row.width, row.height]` and reads `row.width ?? 0` вЂ” `nat` (filled by
`onLoadedMetadata`) is *not* a dep and not read. For any video whose DB row still has
NULL width/height (never thumbnailed), `0 <= AMBIENT_MAX_PIXELS` is true, so the ambient
`<video src={src}>` mounts and stays mounted even after metadata reveals an 8K frame вЂ”
two decoders on one 4K/8K file = doubled IO+decode CPU for the entire playback, the
exact stutter source `AMBIENT_MAX_PIXELS` was added to prevent.

**Fix:** compute from `effW/effH` (`row.width ?? nat.w`) and include `nat` in deps.
**Effort:** ~15 min.

### P1.9 (B4) вЂ” Focus management gaps: no focus restore after viewer close, no focus trap, context menu not keyboard-navigable

- `src/components/viewer/ViewerOverlay.tsx:31-48` renders `role="dialog"
  aria-modal="true"` in a portal but never moves focus into it and the background is
  not inert; Tab order still walks the grid behind the overlay.
- On close, focus is lost to `<body>`, so the grid's arrow navigation (host div
  `tabIndex={0}`, `MediaGrid.tsx:369-371`) is dead until the user clicks the grid
  again вЂ” the "arrows navigate" feature silently stops working after every viewer
  round-trip.
- `src/components/ui/ContextMenu.tsx:116-141`: `role="menu"`/`menuitem` but no
  arrow-key handling and the menu never receives focus вЂ” favorite/trash/copy-path are
  mouse-only there.

**Fix:** focus the overlay root on open, restore to the previously focused card on
close; roving-tabindex (or Radix Menu) for ContextMenuHost. **Effort:** ВЅвЂ“1 day.

### P1.10 (B5) вЂ” External-open failures never reach the user
- **P2.1 вЂ” assoc unregister leaves ProgId default values in HKCU (round-trip bug).**
  `src-tauri/src/assoc.rs:151,158` encode default-value entries as `"{KEY}\0\0"`, but
  `assoc_unregister` (`:184`) splits on the **first** `'\0'`: for `"Lumen.Media\0\0"` it
  yields `value="\0"` (a 1-char NUL string, not `""`), so `value.is_empty()` is false
  and it tries `delete_value("\0")` вЂ” which doesn't exist. The `"exe" "%1"` command
  line and the ProgId description **survive unregister**, breaking the "zero traces"
  contract and leaving a remnant pointing at a possibly-deleted exe.
  `write_uninstall_reg` (`:222-226`) has the same split, and the `.reg` is written only
  to `appDataDir` (`:76-81`), so a portable build deleted by hand leaves both. This
  likely means the pending VM round-trip (`TODO.md:148`) would fail вЂ” fix *before*
  that test. **Fix:** encode manifest entries as `(key, Option<value>)` in JSON; emit
  `"@=-"` for default values in the `.reg`. **Effort:** 2 h + VM round-trip.
- **P2.2 вЂ” `open_external` launches `external_player` via `cmd /C start` with no
  validation.** `commands.rs:198-222`: player path comes from settings (writable via
  the whitelisted `INSERT INTO settings`, see P0.1); `check_player` (`:103-107`) runs
  only from the Settings UI; `open_external` never re-checks, no `.exe` check, and
  `cmd` stays in the launch chain (metacharacters in a path are reinterpreted by
  `cmd`'s parser). **Fix:** reject unless `.exe` + `is_file()`; prefer
  `Command::new(player).arg(&path)` without the `cmd` intermediary. **Effort:** 1 h.
- **P2.3 вЂ” Scan dedup is second-granularity mtime.** `scan.rs` truncates to
  `as_secs()`; S1.4 versioning inherits it via `(thumb_mtime, thumb_size)`. A file
  overwritten twice within one second at the same size keeps the same key в†’ scan
  reports "0 changes" and a stale thumbnail is served. FAT32's 2 s granularity makes
  it worse; unix-epoch storage means no DST/clock-skew bug вЂ” network drives with
  clamped mtimes are the realistic risk. **Recommendation:** store ns
  (`d.as_nanos() as i64`, fits until 2262) or document the trade-off + a "force rescan"
  affordance. **Effort:** 1 h docs / ВЅ day ns migration.
- **P2.4 вЂ” `save_snapshot` writes unbounded IPC bytes; no size cap, name collisions
  overwrite.** `commands.rs:79-100`: filename sanitization is traversal-safe
  (strip `\/:*?"<>|`, 80-char cap) but two snapshots of the same file in one session
  silently overwrite. **Fix:** cap `bytes.len()` (~64 MB), append a counter/timestamp.
  **Effort:** 30 min.
- **P2.5 вЂ” `legacy::migrate` copies `lumen.db`/`-wal`/`-shm` as three independent
  copies.** `legacy.rs:22-44`: a crash-mid-write source can yield a torn set (SQLite's
  own recovery makes this low-risk). The non-empty-target guard (`:33-37`) is correct
  and ordering is right today (before the sql plugin builds) вЂ” but the safety depends
  entirely on that ordering; add a comment that migrate must stay before plugin init.
  Low priority.
- **P2.6 вЂ” `capabilities/default.json` grants `sql:allow-execute` window-wide.**
  `default.json:21-25`: the browser fallback in `mediaActions.ts` uses `db.execute`
  directly when `!tauriAvailable()`, but inside Tauri the permission stays granted вЂ”
  any XSS bypasses the `db_exec` whitelist entirely. The whitelist is theatre unless
  `sql:allow-execute` is dropped and all writes forced through typed commands (keep
  `sql:allow-select` for reads). Also: `assets.rs:18-22` dynamically extends the fs
  scope to **every library root** at runtime (intended, for the WebView-decoder
  fallback) вЂ” record this in the security model doc.
- **P2.7 вЂ” Scan pass-2 deletes rows on any `exists() == false`, including permission
  errors and SMB dropouts.** `scan.rs` (pass-2 sweep): every stored path failing
  `Path::exists()` gets `DELETE FROM media WHERE path = ?1` вЂ” one statement per missing
  file (unbatched, bypassing the writer), and `exists()` is false for **access-denied
  and transient network dropouts**, not just truly-gone files. The root-level guard
  covers a whole ejected drive, but a single-file permission error mid-scan deletes
  the row and cascades `watch_progress` via FK вЂ” resume position gone. **Fix:**
  `symlink_metadata()` + delete only on `ErrorKind::NotFound`; batch through the
  writer. **Effort:** ВЅ day.
- **P2.8 вЂ” Dead-ish code / half-wired paths.** File-arg handling is duplicated:
  single-instance callback (`lib.rs`) vs `open_file` (`commands.rs:601+`) вЂ” two places
  to keep in sync. `ThumbOkItem.duration_ms` (`writer.rs`) is only ever filled by the
  webview capture path; the Rust generator always sends `None` (`thumbs.rs:317-327`).
  Hand-rolled `percent_decode` (`media_server.rs:120-144`) maps `+` в†’ space (form
  semantics) вЂ” harmless today because `url_for` only emits `percent_encode` output,
  but a hand-crafted URL with `+` decodes differently than authored.
- **P2.9 вЂ” CSP is disabled: `tauri.conf.json:27` `"csp": null`.** The webview has no
  Content-Security-Policy at all. Offline-first means the marginal risk is DOM-XSS
  escalation (inline script, `eval`) rather than exfiltration вЂ” but combined with
  P0.1/P2.6 any XSS is immediately full-impact. Minimum viable policy:
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src
  'self' asset: http://asset.localhost data: blob:; media-src 'self' asset:
  http://asset.localhost http://127.0.0.1:* blob:; connect-src 'self' ipc:
  http://ipc.localhost http://127.0.0.1:*`. **Effort:** ВЅ day including full
  click-through (inline styles and `blob:` thumbs must keep working).

### Frontend

## P2 — Nice-to-have / polish / architectural recommendations

### Backend

- **P2.1 — assoc unregister leaves ProgId default values in HKCU (round-trip bug).**
  `src-tauri/src/assoc.rs:151,158` encode default-value entries as `"{KEY}\0\0"`, but
  `assoc_unregister` (`:184`) splits on the **first** `'\0'`: for `"Lumen.Media\0\0"` it
  yields `value="\0"` (a 1-char NUL string, not `""`), so `value.is_empty()` is false
  and it tries `delete_value("\0")` — which doesn't exist. The `"exe" "%1"` command
  line and the ProgId description **survive unregister**, breaking the "zero traces"
  contract and leaving a remnant pointing at a possibly-deleted exe.
  `write_uninstall_reg` (`:222-226`) has the same split, and the `.reg` is written only
  to `appDataDir` (`:76-81`), so a portable build deleted by hand leaves both. This
  likely means the pending VM round-trip (`TODO.md:148`) would fail — fix *before*
  that test. **Fix:** encode manifest entries as `(key, Option<value>)` in JSON; emit
  `"@=-"` for default values in the `.reg`. **Effort:** 2 h + VM round-trip.
- **P2.2 — `open_external` launches `external_player` via `cmd /C start` with no
  validation.** `commands.rs:198-222`: player path comes from settings (writable via
  the whitelisted `INSERT INTO settings`, see P0.1); `check_player` (`:103-107`) runs
  only from the Settings UI; `open_external` never re-checks, no `.exe` check, and
  `cmd` stays in the launch chain (metacharacters in a path are reinterpreted by
  `cmd`'s parser). **Fix:** reject unless `.exe` + `is_file()`; prefer
  `Command::new(player).arg(&path)` without the `cmd` intermediary. **Effort:** 1 h.
- **P2.3 — Scan dedup is second-granularity mtime.** `scan.rs` truncates to
  `as_secs()`; S1.4 versioning inherits it via `(thumb_mtime, thumb_size)`. A file
  overwritten twice within one second at the same size keeps the same key → scan
  reports "0 changes" and a stale thumbnail is served. FAT32's 2 s granularity makes
  it worse; unix-epoch storage means no DST/clock-skew bug — network drives with
  clamped mtimes are the realistic risk. **Recommendation:** store ns
  (`d.as_nanos() as i64`, fits until 2262) or document the trade-off + a "force rescan"
  affordance. **Effort:** 1 h docs / ½ day ns migration.
- **P2.4 — `save_snapshot` writes unbounded IPC bytes; no size cap, name collisions
  overwrite.** `commands.rs:79-100`: filename sanitization is traversal-safe
  (strip `\/:*?"<>|`, 80-char cap) but two snapshots of the same file in one session
  silently overwrite. **Fix:** cap `bytes.len()` (~64 MB), append a counter/timestamp.
  **Effort:** 30 min.
- **P2.5 — `legacy::migrate` copies `lumen.db`/`-wal`/`-shm` as three independent
  copies.** `legacy.rs:22-44`: a crash-mid-write source can yield a torn set (SQLite's
  own recovery makes this low-risk). The non-empty-target guard (`:33-37`) is correct
  and ordering is right today (before the sql plugin builds) — but the safety depends
  entirely on that ordering; add a comment that migrate must stay before plugin init.
  Low priority.

- **P2.6 — `capabilities/default.json` grants `sql:allow-execute` window-wide.**
  `default.json:21-25`: the browser fallback in `mediaActions.ts` uses `db.execute`
  directly when `!tauriAvailable()`, but inside Tauri the permission stays granted —
  any XSS bypasses the `db_exec` whitelist entirely. The whitelist is theatre unless
  `sql:allow-execute` is dropped and all writes forced through typed commands (keep
  `sql:allow-select` for reads). Also: `assets.rs:18-22` dynamically extends the fs
  scope to **every library root** at runtime (intended, for the WebView-decoder
  fallback) — record this in the security model doc.
- **P2.7 — Scan pass-2 deletes rows on any `exists() == false`, including permission
  errors and SMB dropouts.** `scan.rs` (pass-2 sweep): every stored path failing
  `Path::exists()` gets `DELETE FROM media WHERE path = ?1` — one statement per missing
  file (unbatched, bypassing the writer), and `exists()` is false for **access-denied
  and transient network dropouts**, not just truly-gone files. The root-level guard
  covers a whole ejected drive, but a single-file permission error mid-scan deletes
  the row and cascades `watch_progress` via FK — resume position gone. **Fix:**
  `symlink_metadata()` + delete only on `ErrorKind::NotFound`; batch through the
  writer. **Effort:** ½ day.
- **P2.8 — Dead-ish code / half-wired paths.** File-arg handling is duplicated:
  single-instance callback (`lib.rs`) vs `open_file` (`commands.rs:601+`) — two places
  to keep in sync. `ThumbOkItem.duration_ms` (`writer.rs`) is only ever filled by the
  webview capture path; the Rust generator always sends `None` (`thumbs.rs:317-327`).
  Hand-rolled `percent_decode` (`media_server.rs:120-144`) maps `+` → space (form
  semantics) — harmless today because `url_for` only emits `percent_encode` output,
  but a hand-crafted URL with `+` decodes differently than authored.
- **P2.9 — CSP is disabled: `tauri.conf.json:27` `"csp": null`.** The webview has no
  Content-Security-Policy at all. Offline-first means the marginal risk is DOM-XSS
  escalation (inline script, `eval`) rather than exfiltration — but combined with
  P0.1/P2.6 any XSS is immediately full-impact. Minimum viable policy:
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src
  'self' asset: http://asset.localhost data: blob:; media-src 'self' asset:
  http://asset.localhost http://127.0.0.1:* blob:; connect-src 'self' ipc:
  http://ipc.localhost http://127.0.0.1:*`. **Effort:** ½ day including full
  click-through (inline styles and `blob:` thumbs must keep working).

### Frontend

- **B6 — Memo defeat on hot rows.** `MediaCard` is `memo`'d (`MediaCard.tsx:55`) but
  every parent render passes a fresh `onActivate={() => …}` (`MediaGrid.tsx:696`, same
  in `Masonry.tsx:148`), and `GridRow` itself is not memoized — any MediaGrid state
  change re-renders all visible cards. **Fix:** stable id-based callback.
  **Effort:** ~1 h.
- **B7 — Thumbnail queue never cancels off-screen work.** `thumbs.ts:138-170` `flush()`
  drains `[...onScreen, ...offscreen].slice(0, 24)` and re-arms until `queued` is empty
  (the comment documents "NOT a drop list"). Flinging through a 50k library enqueues
  every row ever mounted; the *serialized* video capture queue (`:413-447`, one at a
  time, ~8 s metadata timeout + 3 seeks each) can run for many minutes after a single
  fast scroll, competing with the viewer the user just opened. **Fix:** at flush time,
  skip ids not in `viewportIds` when `queued.size > N` (e.g. 200). **Effort:** ~2 h +
  scroll-storm QA.

- **B8 — `patchCachedRows` is O(cached rows) per `thumbs-ready` batch.**
  `thumbs.ts:~210-233` maps every cached `["media"]` query payload on each writer
  flush. Invisible at 9k; at 50k rows × hundreds of batches it is hundreds of millions
  of row visits on the main thread. UNCONFIRMED impact — needs the 50k measurement.
  **Effort:** ~3 h.
- **B9 — Viewer favorite overrides never reconciled.** `state/viewer.ts:89-95` keeps
  `favorites: Record<id,bool>` for the session; if `mediaActions.toggleFavorite` rolls
  back after a failed write (`mediaActions.ts:129-133`), only the react-query cache is
  restored — the viewer's override stays flipped, heart diverges from the DB until
  restart. **Fix:** clear `useViewer.favorites[id]` on rollback, or derive from the
  query cache row. **Effort:** ~1 h.
- **B10 — Onboarding cancel swallows failure.** `src/pages/Onboarding.tsx:79`:
  `await api.cancelScan(id).catch(() => undefined);` then unconditionally
  `finish(); resetToPicker();` — if cancel fails the UI claims "cancelled" while Rust
  keeps scanning. **Effort:** ~10 min.
- **B11 — Settings writes lose error detail.** `SettingsContent.tsx:149-151`
  `catch { setMessage("settings.operation_error") }` — no `console.error`, generic
  inline message; cursor toggle (`:104-111`) fully silent. Contrasts with
  `lib/settings.ts` which does console+toast per setter. **Effort:** ~30 min.
- **B12 — Lightbox decodes the original immediately.** `Lightbox.tsx:341+` renders the
  full-resolution original with only a shimmer underneath; the cached 480w thumb is
  not used as a placeholder. A 50 MP photo pays full decode before first paint.
  **Fix:** render `thumbSrc` underneath, fade the original in on load. **Effort:** ~2 h.
- **B13 — `scrollerRef` cleanup never runs.** `MediaGrid.tsx:335-344` returns a cleanup
  from the Virtuoso `scrollerRef` callback; React 18 ref callbacks ignore return values
  and react-virtuoso does not call it either — in dev StrictMode the scroll-persistence
  listener attaches twice. Benign duplicate today. **Effort:** ~20 min (track element
  in a ref + useEffect).
- **B14 — Player-wide re-render per timeupdate.** `VideoPlayer.tsx:535-540`
  `setCurrent` on every `timeupdate` (~4 Hz) re-renders the whole 1200-line component
  including the up-next `Filmstrip`. Works at current scale; isolate the progress
  line/timecodes into a subscribed child if the perf chip ever shows it. **Effort:** ~2 h.
- **B15 — Drive-eject / IO failure mid-playback shows the "codec" card.**
  `VideoPlayer.tsx:556` maps every `<video>` error to `setError("codec")` and the copy
  talks about codecs — a pulled USB drive mid-playback gets a misleading message.
  `mediaError.code` (MEDIA_ERR_NETWORK vs SRC_NOT_SUPPORTED) is available and unused.
  **Effort:** ~30 min.
- **B16 — Collage/VR micro-accessibility.** `CollageOverlay.tsx:385-400` seek bar has
  `role="slider"` + `tabIndex` but no keyboard handler; `VrView` canvas is
  pointer-only. **Effort:** ~1 h each.
- **B17 — Stale viewer queue after external mutation.** The queue is a snapshot of
  grid rows (`viewer.ts:49-56`); a rescan completing while the viewer is open refetches
  the grid but not the queue, so arrows walk rows that may no longer exist. Degrades
  gracefully (img `onError` → neutral tile), hence P2. UNCONFIRMED in practice; code
  path verified.
- **B18 — Session-long listeners without unlisten (by design; note HMR).**
  `initExternalOpen` (`externalOpen.ts:46,61`), `startThumbBridge` (`thumbs.ts`),
  scan/offline listeners (`state/library.ts:110-142`) drop their unlisten handles;
  module flags prevent double-subscribe in prod, but Vite HMR of those modules can
  double-subscribe in dev. Documented behavior; no action.
- **B19 — VR blob fallback reads up to 256 MB into JS memory.**
  `VideoPlayer.tsx:45,205-215` — on a 256 MB file the spike plus decode can OOM a weak
  iGPU laptop; no progress signal during the multi-second `readFile`. Consider making
  the (existing) media server the only path. **Effort:** backend-dependent.
- **B20 — Masonry hard cap at 2000.** `Masonry.tsx:22,52-53` truncates with a banner
  (acknowledged in TODO.md). At the 50k target masonry shows 4% of the library.
  Known/backlogged — recorded for completeness.

---

## Positive observations (what's done well — keep doing it)

- **Migrations v1–v8 are individually idempotent and the plugin versions them**
  (`lib.rs:53-102`). The v6/v7 watch_progress rebuild was the only collision, and v7
  documents exactly why the rebuild was safe (dead v1 columns).
- **Scan upsert guard is fixed and proven**: `scan.rs:129-143` compares against
  `excluded.*`; `unchanged_rescan_counts_zero_changes` (`scan.rs:428-491`) runs the real
  statement against in-memory SQLite, so the swapped-`?5/?6` bug cannot regress silently.
- **Thumbnail cache is version-keyed** `(thumb_mtime, thumb_size)`
  (`thumbs.rs:195-199`) with stale-file deletion; `thumb_error` retries when the version
  moves; decode is by content not extension and runs on `spawn_blocking` (`thumbs.rs:311`).
- **Media server hygiene**: loopback-only ephemeral port, GET/OPTIONS only (405
  otherwise), bounds-checked Range parsing incl. suffix/open-ended forms and 416, MIME
  allow-list, allow-list refreshed per `media_url` call, exclusions subtracted before
  the root check.
- **`cache.rs` hardening** (symlink/reparse-point rejection, extension filter,
  per-file `symlink_metadata`) is the correct template for the P0.2 media-server fix.
- **File associations never touch `UserChoice`** and stay in HKCU; the command line is
  properly quoted (`assoc.rs:156`: `"exe" "%1"`).
- **`Box::leak` is gone** — `commands.rs:301-307` owns the `String` into the writer.
- **Watcher registry prevents zombie rescans**: `remove_root` stops and joins the
  watcher thread before deleting the root row; boot-time restore skips unreachable
  roots without crashing (`lib.rs:36-42`).
- **Frontend listener hygiene**: every `useEffect` keydown/mousedown/resize/scroll
  listener is paired with a removal; timers are all cleared (StatusLine ticker,
  VideoPlayer save/chrome intervals with save-on-unmount flush, thumb-queue flush
  timer, MediaCard scrub timer + global `stopCardPreviews` on viewer open).
- **Video element lifecycle is disciplined**: hover scrub previews pause + clear `src`
  via the ref-callback null path (`MediaCard.tsx:296-303`); hidden thumb-capture video
  clears `src` in `finally` (`thumbs.ts:544-547`); the viewer gets a fresh element per
  row via `key={row.id}`; the only `URL.createObjectURL` is revoked in effect cleanup.
- **Esc layering is deliberate**: context menu uses capture + stopPropagation; the
  player resolves VR → fullscreen → viewer in order; collage captures Esc.
- **Data-layer error surfacing is strong**: every `mediaActions` write toasts with
  rollback; settings setters toast; swallowed `catch {}` sites are nearly all justified
  fallbacks (localStorage/private mode, browser-QA probes).
- **zustand selector discipline is good everywhere except P1.7**, and stale-closure
  risks were actively designed around (`zoomRef`, `onFatalRef`/`onTimeRef` in VrView,
  `getState()` in key handlers).

---

## Future-proofing (Phase 7+ architectural recommendations)

1. **Collage presets.** `CollageOverlay.tsx:35-149` hardcodes layouts as
   `switch(count)` with 2 variants per count. Adding a case is cheap, but
   *user-selectable* named presets (or 7+ tile layouts) mean replacing the variant
   model with a data-driven preset registry (`{ id, label, gridTemplate, tileAreas[] }`)
   before the hardcoded cases multiply. Decide now — the variant enum is still small.
2. **Global video filters (saturation/sharpness).** Natural hook: the main `<video>`
   element's style (`VideoPlayer.tsx:526`) plus the ambient layer's existing `filter`
   (`:511`). **Caveat:** CSS `filter` does NOT apply inside the WebGL dome — VR needs
   shader uniforms (`VrView.tsx:278-283`) or a 2D-canvas `ctx.filter` on the downscale
   path. A `useAppSettings` filter setting must fan out to all three surfaces
   explicitly; ship it disabled in VR or implement the shader path in the same PR, or
   the setting silently lies to VR users.
3. **MediaProvider abstraction (cloud/phone).** Paths are absolute OS paths end-to-end
   (`MediaRow.path` → `fileSrc`, `mediaUrl`, clipboard, `open_external`; thumbs fallback
   does `readFile(row.path)`; FolderTree concatenates path strings). A remote source
   needs changes at exactly three seams: `assets.ts:fileSrc`, `thumbs.ts` capture,
   `api.listMedia`/folder queries. Cheapest viable step: keep `path` as the universal
   key but introduce a scheme prefix (`local://`, `phone://`) parsed at those three
   seams — a full provider interface before v2 is over-engineering given the seam count.
4. **Multi-window lightbox.** `useViewer` (queue/index/favorites/reveal) is a
   per-window module singleton, as are `queryClient` and the thumb store. A second
   viewer window needs queue+index sync over a Tauri event; favorite writes already
   land in SQLite (the other window's cache goes stale up to `staleTime`) and
   `watch_progress` is already shared via DB. Feasible with a thin viewer-sync
   broadcast — but `externalOpen`'s `busy` flag and the fullscreen choreography assume
   one window. Recommendation: make the viewer store event-backed only when
   multi-window is actually scheduled; doing it now pays the complexity without the
   feature.

---

