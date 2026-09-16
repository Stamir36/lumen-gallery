import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { open } from "@tauri-apps/plugin-dialog";
import {
  HardDrive,
  FolderPlus,
  RefreshCw,
  CheckCircle2,
  X,
} from "lucide-react";
import { PillButton } from "@/components/ui/PillButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { api, formatBytes, formatCount, type VolumeInfo } from "@/lib/api";
import { useRootsStore, useScanStore } from "@/state/library";

/**
 * Onboarding root picker per DESIGN.md v2.2 — explicit state machine:
 * picker (drives + volumes) | scanning (live progress) | done (accent CTA).
 * Every entry point resets to `picker` via resetToPicker().
 */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [volumes, setVolumes] = useState<VolumeInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const { refresh } = useRootsStore();
  const {
    view,
    setView,
    resetToPicker,
    phase,
    added,
    clearLog,
    finish,
  } = useScanStore();

  useEffect(() => {
    if (view === "picker") {
      api
        .getVolumes()
        .then(setVolumes)
        .catch((e) => {
          console.error("get_volumes failed:", e);
          toast.error("get_volumes failed — see console (F12)");
          setVolumes([]);
        });
    }
  }, [view]);

  const add = async (path: string, kind?: string, label?: string) => {
    setBusy(path);
    // UI reacts instantly; scan counters are driven SOLELY by Rust events.
    // Never call setScanning() here: a fast scan may finish before addRoot
    // resolves, and resetting after its events would zero live counters.
    clearLog();
    setView("scanning");
    try {
      await api.addRoot(path, kind, label);
      await refresh();
    } catch (e) {
      console.error("add_root failed:", e);
      toast.error(`add_root failed: ${String(e).slice(0, 120)}`);
      resetToPicker();
    } finally {
      setBusy(null);
    }
  };

  /** Scan finished: finalize event -> done view (counters persist until reset). */
  useEffect(() => {
    if (view === "scanning" && phase === "finalize") {
      finish();
      setView("done");
    }
  }, [view, phase, finish, setView]);

  const cancelScan = async () => {
    const id = useScanStore.getState().scanningRootId;
    if (id !== null) {
      await api.cancelScan(id).catch(() => undefined);
    }
    finish();
    resetToPicker();
  };

  const chooseFolder = async () => {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === "string") {
      await add(picked, "folder");
    }
  };

  /** Drag-drop a folder: HTML5 drop carries the absolute path. */
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const path = (e.dataTransfer.getData("text/plain") || "").trim();
    if (path) await add(path, "folder");
  };

  if (view === "scanning") {
    return <ScanningView onCancel={() => void cancelScan()} />;
  }

  if (view === "done") {
    return (
      <div className="h-full overflow-y-auto px-10 py-16">
        <div className="mx-auto w-full max-w-3xl">
          <GlassCard className="flex flex-col items-center gap-6 px-8 py-14 text-center">
            <CheckCircle2 size={44} className="text-accent" />
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-tprimary">
                {t("onboarding.scan_done_title")}
              </h1>
              <p className="mt-2 font-mono text-sm text-tsecondary">
                {t("onboarding.scan_done_summary", {
                  count: formatCount(added),
                })}
              </p>
            </div>
            <PillButton onClick={onDone} className="min-w-[280px]">
              {t("onboarding.to_library", { count: formatCount(added) })}
            </PillButton>
            <button
              className="text-sm text-tsecondary underline-offset-4 hover:underline"
              onClick={resetToPicker}
            >
              {t("onboarding.add_another")}
            </button>
          </GlassCard>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-10 py-12">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-4xl font-bold tracking-tight text-tprimary">
          {t("onboarding.title")}
        </h1>
        <p className="mt-2 max-w-xl text-[15px] text-tsecondary">
          {t("onboarding.subtitle")}
        </p>

        {/* Existing roots first (returning from done view). */}
        <ExistingRoots />

        <div className="mt-10">
          <div className="mb-4 text-lg font-semibold text-tprimary">
            {t("onboarding.drives")}
          </div>
          <div className="flex flex-wrap gap-4">
            {volumes.length === 0 && (
              <div className="w-full rounded-card border border-dashed border-hairline px-8 py-12 text-center">
                <span className="text-sm text-ttertiary">
                  {t("onboarding.no_drives")}
                </span>
              </div>
            )}
            {volumes.map((v) => {
              const used = v.totalBytes - v.availableBytes;
              const ratio = v.totalBytes > 0 ? used / v.totalBytes : 0;
              return (
                <button
                  key={v.mountPoint}
                  disabled={busy === v.mountPoint}
                  onClick={() => add(v.mountPoint, v.kind, v.name || v.mountPoint)}
                  className="w-[300px] rounded-card bg-surface-1 p-7 text-left shadow-elev1 transition-all duration-[160ms] ease-out hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(0,0,0,.4),0_0_0_1px_rgba(110,193,255,.18)] active:scale-[.97] disabled:opacity-50"
                >
                  <div className="flex items-center gap-3">
                    <HardDrive size={22} className="text-tsecondary" />
                    <span className="text-base font-semibold text-tprimary">
                      {v.name || v.mountPoint}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-ttertiary">
                    {v.mountPoint} · {v.fileSystem || "—"}
                  </div>
                  <div className="mt-6 h-1.5 w-full overflow-hidden rounded-pill bg-surface-2">
                    <div
                      className="h-full rounded-pill bg-gradient-to-r from-accent/70 to-accent"
                      style={{ width: `${Math.round(ratio * 100)}%` }}
                    />
                  </div>
                  <div className="mt-2 font-mono text-[12px] text-tsecondary">
                    {t("onboarding.free_of", {
                      free: formatBytes(v.availableBytes),
                      total: formatBytes(v.totalBytes),
                    })}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-center gap-4">
          <PillButton onClick={chooseFolder}>
            <FolderPlus size={16} /> {t("onboarding.choose_folder")}
          </PillButton>
          <PillButton variant="ghost" onClick={() => api.rescanAll()}>
            <RefreshCw size={16} /> {t("onboarding.rescan_all")}
          </PillButton>
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="mt-8 flex flex-col items-center justify-center rounded-card border border-dashed border-hairline-hover px-8 py-16"
        >
          <span className="text-sm text-ttertiary">
            {t("onboarding.dropzone_hint")}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Existing roots list shown on the picker so the user sees context. */
function ExistingRoots() {
  const roots = useRootsStore((s) => s.roots);
  if (roots.length === 0) return null;
  return (
    <div className="mt-8 flex flex-wrap gap-3">
      {roots.map((r) => (
        <div
          key={r.id}
          className="flex items-center gap-2 rounded-control bg-surface-1 px-4 py-2 shadow-elev1"
        >
          <HardDrive size={15} className="text-tsecondary" />
          <span className="text-sm text-tprimary">{r.label || r.path}</span>
          <span className="font-mono text-[11px] text-ttertiary">
            {formatCount(r.itemCount)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ScanningView({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  const { scanningRootId, phase, done, total, added, log } = useScanStore();
  const roots = useRootsStore((s) => s.roots);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const root = roots.find((r) => r.id === scanningRootId);

  return (
    <div className="h-full overflow-y-auto px-10 py-16">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-4xl font-bold tracking-tight text-tprimary">
          {t("onboarding.scanning_title")}
        </h1>
        <p className="mt-2 text-[15px] text-tsecondary">
          {root?.label ?? t("sidebar.library")} — {t("onboarding.subtitle")}
        </p>

        <GlassCard className="mt-10">
          <div className="flex items-end justify-between gap-8">
            <div className="flex flex-col gap-1">
              <span className="text-sm text-tsecondary">
                {t("scan_progress.files_seen")}
              </span>
              <span className="font-mono text-5xl tracking-tight text-tprimary">
                {formatCount(done)}
              </span>
              <span className="font-mono text-[11px] text-ttertiary">
                {t("scan_progress.total", { count: formatCount(total) })}
              </span>
            </div>
            <div className="flex flex-col gap-1 text-right">
              <span className="text-sm text-tsecondary">
                {t("scan_progress.media_added")}
              </span>
              <span className="font-mono text-5xl tracking-tight text-accent">
                {formatCount(added)}
              </span>
              <span className="font-mono text-[11px] text-ttertiary">
                {t("scan_progress.phase", { phase: phase.toUpperCase() })}
              </span>
            </div>
          </div>

          <div className="mt-8 h-1 w-full overflow-hidden rounded-pill bg-surface-2">
            <div
              className="h-full rounded-pill bg-gradient-to-r from-accent/70 to-accent transition-[width] duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>

          <div
            className="mt-6 max-h-40 overflow-y-auto rounded-control bg-black/20 p-4"
            ref={(el) => {
              if (el) el.scrollTop = el.scrollHeight;
            }}
          >
            <div className="font-mono text-[11px] leading-relaxed text-ttertiary">
              {log.length === 0
                ? t("onboarding.waiting")
                : log.slice(-50).map((l) => (
                    <div key={l.at} className="truncate">
                      {l.text}
                    </div>
                  ))}
            </div>
          </div>
        </GlassCard>

        <div className="mt-8 flex justify-end gap-3">
          {/* Cancel: cooperative abort in Rust + back to picker. */}
          <PillButton variant="ghost" onClick={onCancel}>
            <X size={16} /> {t("onboarding.cancel_scan")}
          </PillButton>
        </div>
      </div>
    </div>
  );
}
