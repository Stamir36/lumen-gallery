import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import i18n from "@/i18n";
import { queryClient } from "@/lib/queryClient";
import { tauriAvailable } from "@/lib/assets";
import { getDb } from "@/lib/db";
import type { MediaRow } from "@/lib/api";

/**
 * Row-level writes for the library UI. All state lives in SQLite; the grid
 * refetches through react-query, and failures surface on the console AND as a
 * toast (no silent data loss) — .clinerules error contract.
 *
 * In the Tauri app every write here goes through the Rust SINGLE-WRITER task
 * (`db_exec`): thumb updates are batched on the same queue, so a favorite
 * toggle can no longer wait behind a storm of thumbnail transactions. In the
 * browser QA route there is no IPC — fall back to the sql plugin directly.
 */
/**
 * `?1, ?2, …` for `count` positional binds.
 *
 * This used to start at `?2` while the parameter array held exactly `count`
 * values: the first id bound to `?2`, `?1` was never bound and the last id had
 * no parameter at all — which is why bulk (and the selection-bar) favourite /
 * trash silently failed. Positional numbering must start at 1 and match the
 * array 1:1.
 */
function placeholderList(count: number) {
  return Array.from({ length: count }, (_, i) => `?${i + 1}`).join(", ");
}

/** SQLite's parameter ceiling is 999 (much lower on old builds): stay far below. */
const MAX_PARAMS_PER_STATEMENT = 512;

/** Bulk writes are chunked so a 9k selection cannot blow the parameter limit. */
function chunkIds(ids: number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < ids.length; i += MAX_PARAMS_PER_STATEMENT) {
    out.push(ids.slice(i, i + MAX_PARAMS_PER_STATEMENT));
  }
  return out;
}

/** dev-only latency probe: favorite round-trip must stay under 50ms */
export const lastWriteMs = { value: 0 };

/** Runs one whitelisted statement and returns `rows_affected`. */
async function run(sql: string, params: (number | string)[]): Promise<number> {
  const t0 = performance.now();
  try {
    if (tauriAvailable()) {
      return await invoke<number>("db_exec", {
        sql,
        params: params.map((p) => String(p)),
      });
    }
    const db = await getDb();
    const res = await db.execute(sql, params);
    return Number(res.rowsAffected ?? 0);
  } finally {
    lastWriteMs.value = Math.round(performance.now() - t0);
    if (import.meta.env.DEV) {
      console.info(`[perf] db_exec ${lastWriteMs.value}ms · ${sql.slice(0, 40)}`);
    }
  }
}

/** One refetch for a whole action, not one per chunk. */
async function invalidateAfterWrite() {
  await queryClient.invalidateQueries({ queryKey: ["media"] });
  await queryClient.invalidateQueries({ queryKey: ["library-summary"] });
  await queryClient.invalidateQueries({ queryKey: ["folders"] });
}

export async function setFavorite(ids: number[], favorite: boolean) {
  if (ids.length === 0) return;
  try {
    let affected = 0;
    for (const chunk of chunkIds(ids)) {
      affected += await run(
        `UPDATE media SET favorite = ${favorite ? 1 : 0} WHERE id IN (${placeholderList(
          chunk.length,
        )})`,
        chunk,
      );
    }
    // a statement that ran but touched nothing means the ids went stale
    // (rescan / filter changed under the selection): say so instead of lying
    if (affected === 0) {
      console.warn("set favorite touched 0 rows", ids.length);
      toast.error(i18n.t("errors.action_nothing"));
    }
    await invalidateAfterWrite();
  } catch (e) {
    console.error("set favorite failed", e);
    toast.error(i18n.t("errors.action_failed"));
  }
}

/**
 * Optimistic toggle (FIX 2): the heart flips instantly, a failure rolls it
 * back and toasts. Uses the LOCAL row cache (no full refetch needed to see
 * the change), invalidated queries update the DB copy in the background.
 */
/**
 * Returns whether the write actually landed, so optimistic OVERRIDES held
 * outside the query cache (the viewer's session favourites, B9) can be dropped
 * on rollback instead of keeping a heart the database never took.
 */
export async function toggleFavorite(id: number): Promise<boolean> {
  let rollback: (() => void) | undefined;
  try {
    // optimistic: flip the heart in every cached "media" payload NOW
    const queries = queryClient.getQueryCache().findAll({ queryKey: ["media"] });
    const snapshots = queries.map((q) => ({ q, data: q.state.data }));
    rollback = () => {
      for (const { q, data } of snapshots) q.setData(data);
    };
    for (const q of queries) {
      const rows = q.state.data as MediaRow[] | undefined;
      if (Array.isArray(rows)) {
        q.setData(
          rows.map((r) => (r.id === id ? { ...r, favorite: !r.favorite } : r)),
        );
      }
    }

    const affected = await run(
      `UPDATE media SET favorite = CASE favorite WHEN 1 THEN 0 ELSE 1 END WHERE id = ?1`,
      [id],
    );
    if (affected === 0) throw new Error("row not found");
    await invalidateAfterWrite();
    return true;
  } catch (e) {
    console.error("toggle favorite failed", e);
    rollback?.();
    toast.error(i18n.t("errors.action_failed"));
    return false;
  }
}

/** Trash is a DB flag in v1 (SPEC §8) — files are never touched. */
export async function trashMedia(ids: number[]) {
  if (ids.length === 0) return;
  try {
    let affected = 0;
    for (const chunk of chunkIds(ids)) {
      affected += await run(
        `UPDATE media SET trashed = 1 WHERE id IN (${placeholderList(chunk.length)})`,
        chunk,
      );
    }
    if (affected === 0) {
      console.warn("trash touched 0 rows", ids.length);
      toast.error(i18n.t("errors.action_nothing"));
      return;
    }
    await invalidateAfterWrite();
    toast.success(i18n.t("actions.trashed", { count: affected }));
  } catch (e) {
    console.error("trash failed", e);
    toast.error(i18n.t("errors.action_failed"));
  }
}

/** Unflag rows — instant, no rescan: the files never left the disk. */
export async function restoreTrash(ids: number[]) {
  if (ids.length === 0) return;
  try {
    let affected = 0;
    for (const chunk of chunkIds(ids)) {
      affected += await run(
        `UPDATE media SET trashed = 0 WHERE id IN (${placeholderList(chunk.length)})`,
        chunk,
      );
    }
    await invalidateAfterWrite();
    toast.success(i18n.t("trash.restored", { count: affected }));
  } catch (e) {
    console.error("restore failed", e);
    toast.error(i18n.t("errors.action_failed"));
  }
}

/**
 * "Delete forever" (P6): every file goes to the OS RECYCLE BIN through the
 * Rust `trash` crate — NEVER unlink. On success the DB row is dropped; a
 * per-file failure aborts with rows kept, so the library never loses track of
 * a file that still exists on disk.
 */
export async function deleteForever(rows: { id: number; path: string }[]) {
  if (rows.length === 0) return;
  try {
    await invoke<number>("trash_delete", { paths: rows.map((r) => r.path) });
    let affected = 0;
    for (const chunk of chunkIds(rows.map((r) => r.id))) {
      affected += await run(
        `DELETE FROM media WHERE id IN (${placeholderList(chunk.length)})`,
        chunk,
      );
    }
    await invalidateAfterWrite();
    toast.success(i18n.t("trash.deleted", { count: affected }));
  } catch (e) {
    console.error("delete forever failed", e);
    toast.error(String(e));
  }
}
