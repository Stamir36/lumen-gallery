import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FolderX, RotateCcw } from "lucide-react";
import { api, type ExcludedFolderRow } from "@/lib/api";
import { MonoChip } from "@/components/ui/Chip";

/**
 * Hidden folders (FIX 5), listed where libraries are managed.
 *
 * An exclusion is a decision, not a deletion: the rows stay in the database with
 * `excluded = 1`, the scan skips the subtree, and restoring here clears the flag
 * and asks for a rescan so anything added while the folder was hidden appears.
 */
export function ExcludedFolders() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data = [] } = useQuery({
    queryKey: ["excluded"],
    queryFn: () => api.listExcluded(),
    staleTime: 5_000,
  });

  const restore = useMutation({
    mutationFn: (row: ExcludedFolderRow) => api.restoreFolder(row.rootId, row.path),
    onSuccess: async () => {
      toast.success(t("settings.excluded_restored"));
      await qc.invalidateQueries();
      // the subtree was skipped while hidden: pick up whatever appeared inside
      void api.rescanAll().catch(() => undefined);
    },
    onError: (e) => {
      console.error("restore folder failed", e);
      toast.error(t("errors.action_failed"));
    },
  });

  if (data.length === 0) return null;

  return (
    <div className="mb-6 rounded-control border border-hairline p-4">
      <div className="mb-3 flex items-center gap-2">
        <FolderX size={15} className="text-ttertiary" />
        <span className="text-sm text-tprimary">{t("settings.excluded_title")}</span>
        <span className="font-mono text-[11px] tabular-nums text-ttertiary">
          {data.length}
        </span>
      </div>
      <ul className="space-y-2">
        {data.map((row) => (
          <li
            key={row.id}
            className="flex items-center gap-3 rounded-control bg-surface-2 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-tprimary">{row.name}</p>
              <p className="truncate font-mono text-[11px] text-ttertiary">{row.path}</p>
            </div>
            {row.hidden > 0 && (
              <MonoChip>{t("settings.excluded_hidden", { count: row.hidden })}</MonoChip>
            )}
            <button
              type="button"
              disabled={restore.isPending}
              onClick={() => restore.mutate(row)}
              aria-label={t("settings.excluded_restore")}
              title={t("settings.excluded_restore")}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill text-tsecondary transition-colors duration-[160ms] hover:bg-white/[.08] hover:text-tprimary disabled:opacity-40"
            >
              <RotateCcw size={15} />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] text-ttertiary">{t("settings.excluded_hint")}</p>
    </div>
  );
}
