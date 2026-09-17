import { toast } from "sonner";
import i18n from "@/i18n";
import { getDb } from "@/lib/db";
import { queryClient } from "@/lib/queryClient";

/**
 * Row-level writes for the library UI. All state lives in SQLite; the grid
 * refetches through react-query, and failures surface on the console AND as a
 * toast (no silent data loss) — .clinerules error contract.
 */
function placeholderList(count: number, startAt = 2) {
  return Array.from({ length: count }, (_, i) => `?${i + startAt}`).join(", ");
}

async function run(sql: string, params: (number | string)[]) {
  const db = await getDb();
  await db.execute(sql, params);
  await queryClient.invalidateQueries({ queryKey: ["media"] });
  await queryClient.invalidateQueries({ queryKey: ["library-summary"] });
  await queryClient.invalidateQueries({ queryKey: ["folders"] });
}

export async function setFavorite(ids: number[], favorite: boolean) {
  if (ids.length === 0) return;
  try {
    await run(
      `UPDATE media SET favorite = ${favorite ? 1 : 0} WHERE id IN (${placeholderList(ids.length)})`,
      ids,
    );
  } catch (e) {
    console.error("set favorite failed", e);
    toast.error(i18n.t("errors.action_failed"));
  }
}

export async function toggleFavorite(id: number) {
  try {
    await run(
      `UPDATE media SET favorite = CASE favorite WHEN 1 THEN 0 ELSE 1 END WHERE id = ?1`,
      [id],
    );
  } catch (e) {
    console.error("toggle favorite failed", e);
    toast.error(i18n.t("errors.action_failed"));
  }
}

/** Trash is a DB flag in v1 (SPEC §8) — files are never touched. */
export async function trashMedia(ids: number[]) {
  if (ids.length === 0) return;
  try {
    await run(
      `UPDATE media SET trashed = 1 WHERE id IN (${placeholderList(ids.length)})`,
      ids,
    );
    toast.success(i18n.t("actions.trashed", { count: ids.length }));
  } catch (e) {
    console.error("trash failed", e);
    toast.error(i18n.t("errors.action_failed"));
  }
}
