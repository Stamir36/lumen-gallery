import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { HardDrive, FolderPlus, RefreshCw, CheckCircle2 } from "lucide-react";
import { PillButton } from "@/components/ui/PillButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { api, formatBytes, formatCount, type VolumeInfo } from "@/lib/api";
import { useRootsStore, useScanStore } from "@/state/library";

/**
 * Onboarding root picker per DESIGN.md v2.2:
 * chunky drive cards (radius 22, padding 28, tonal surface), accent gradient
 * capacity bar, hover lift; folder picker; dashed hairline dropzone.
 */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const [volumes, setVolumes] = useState<VolumeInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [addedLabel, setAddedLabel] = useState<string | null>(null);
  const { refresh } = useRootsStore();
  const { scanningRootId, phase, done, total, added, log } = useScanStore();

  useEffect(() => {
    api
      .getVolumes()
      .then(setVolumes)
      .catch(() => setVolumes([]));
  }, []);

  const add = async (path: string, kind?: string, label?: string) => {
    setBusy(path);
    try {
      await api.addRoot(path, kind, label);
      await refresh();
      setAddedLabel(label ?? path);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  };

  const chooseFolder = async () => {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === "string") {
      await add(picked, "folder");
    }
  };

  const scanning = scanningRootId !== null;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  /** Drag-drop a folder: HTML5 drop carries the absolute path. */
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const path = (e.dataTransfer.getData("text/plain") || "").trim();
    if (path) await add(path, "folder");
  };

  if (scanning) {
    return (
      <div className="flex h-full items-center justify-center px-10 py-16">
        <div className="w-full max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight text-tprimary">
            Scanning library
          </h1>
          <p className="mt-2 text-[15px] text-tsecondary">
            {addedLabel ?? "your library"} — files stay exactly where they are.
          </p>

          <GlassCard className="mt-10">
            <div className="flex items-end justify-between gap-8">
              <div className="flex flex-col gap-1">
                <span className="text-sm text-tsecondary">Files seen</span>
                <span className="font-mono text-5xl tracking-tight text-tprimary">
                  {formatCount(done)}
                </span>
                <span className="font-mono text-[11px] text-ttertiary">
                  {formatCount(total)} TOTAL
                </span>
              </div>
              <div className="flex flex-col gap-1 text-right">
                <span className="text-sm text-tsecondary">Media added</span>
                <span className="font-mono text-5xl tracking-tight text-accent">
                  {formatCount(added)}
                </span>
                <span className="font-mono text-[11px] text-ttertiary">
                  PHASE {phase.toUpperCase()}
                </span>
              </div>
            </div>

            <div className="mt-8 h-1 w-full overflow-hidden rounded-pill bg-surface-2">
              <div
                className="h-full rounded-pill bg-gradient-to-r from-accent/70 to-accent transition-[width] duration-200"
                style={{ width: `${pct}%` }}
              />
            </div>

            <div className="mt-6 rounded-control bg-black/20 p-4">
              <div className="font-mono text-[11px] leading-relaxed text-ttertiary">
                {log.length === 0
                  ? "waiting for scanner…"
                  : log.map((l) => (
                      <div key={l.at} className="truncate">
                        {l.text}
                      </div>
                    ))}
              </div>
            </div>
          </GlassCard>

          <div className="mt-8 flex justify-end gap-3">
            <PillButton variant="ghost" onClick={onDone}>
              Scan in background
            </PillButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-10 py-12">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-4xl font-bold tracking-tight text-tprimary">
          Add a library
        </h1>
        <p className="mt-2 max-w-xl text-[15px] text-tsecondary">
          Pick a drive or folder. LUMEN indexes it in place — nothing is copied,
          nothing leaves this machine.
        </p>

        {addedLabel && (
          <div className="mt-6 flex items-center gap-3 rounded-control bg-accent/[.14] px-4 py-3">
            <CheckCircle2 size={18} className="text-accent" />
            <span className="text-sm text-tprimary">
              Added {addedLabel} — scanning in the background
            </span>
            <button
              className="ml-auto text-sm text-tsecondary underline-offset-4 hover:underline"
              onClick={onDone}
            >
              Go to library
            </button>
          </div>
        )}

        <div className="mt-10">
          <div className="mb-4 text-lg font-semibold text-tprimary">Drives</div>
          <div className="flex flex-wrap gap-4">
            {volumes.length === 0 && (
              <div className="w-full rounded-card border border-dashed border-hairline px-8 py-12 text-center">
                <span className="text-sm text-ttertiary">No drives reported</span>
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
                    {formatBytes(v.availableBytes)} free /{" "}
                    {formatBytes(v.totalBytes)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-center gap-4">
          <PillButton onClick={chooseFolder}>
            <FolderPlus size={16} /> Choose folder…
          </PillButton>
          <PillButton variant="ghost" onClick={() => api.rescanAll()}>
            <RefreshCw size={16} /> Rescan all
          </PillButton>
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="mt-8 flex flex-col items-center justify-center rounded-card border border-dashed border-hairline-hover px-8 py-16"
        >
          <span className="text-sm text-ttertiary">
            Drop a folder here to add it as a library
          </span>
        </div>
      </div>
    </div>
  );
}