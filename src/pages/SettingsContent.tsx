import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { RefreshCw, Trash2 } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { GlassCard } from "@/components/ui/GlassCard";
import { PillButton } from "@/components/ui/PillButton";
import { IconButton } from "@/components/ui/IconButton";
import { api, formatBytes, type RootRow } from "@/lib/api";
import { getDb } from "@/lib/db";
import { useRootsStore } from "@/state/library";

export function SettingsContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [roots, setRoots] = useState<RootRow[]>([]);
  const [player, setPlayer] = useState("");
  const [bytes, setBytes] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const db = await getDb();
        const [libraries, values, size] = await Promise.all([
          api.listRoots(),
          db.select<{ value: string }[]>("SELECT value FROM settings WHERE key = 'external_player'"),
          invoke<number>("thumbnail_cache_size"),
        ]);
        if (active) {
          setRoots(libraries); setPlayer(values[0]?.value ?? "");
          setBytes(size); setReady(true);
        }
      } catch {
        if (active) { setMessage("settings.load_error"); setFailed(true); }
      }
    })();
    return () => { active = false; };
  }, []);

  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setMessage(""); setFailed(false);
    try { await action(); setMessage("settings.saved"); }
    catch { setMessage("settings.operation_error"); setFailed(true); }
    finally { setBusy(false); }
  };
  const refresh = async () => {
    setRoots(await api.listRoots());
    await useRootsStore.getState().refresh();
  };

  return <div className="space-y-12">
    <GlassCard>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold">{t("settings.language")}</h2>
        <div className="w-44"><LanguageSwitcher /></div>
      </div>
      <div className="mt-6 flex justify-between border-t border-hairline pt-6">
        <span>{t("settings.theme")}</span><span className="text-tsecondary">{t("settings.dark")}</span>
      </div>
    </GlassCard>
    <GlassCard>
      <h2 className="mb-6 text-xl font-semibold">{t("settings.libraries")}</h2>
      {!roots.length && <p className="mb-6 text-tsecondary">{t(ready ? "settings.no_libraries" : "settings.loading")}</p>}
      <ul className="mb-6 space-y-4">{roots.map(root => <li key={root.id} className="flex items-center gap-3 rounded-control bg-surface-2 p-4">
        <div className="min-w-0 flex-1"><p className="truncate font-medium">{root.label || root.path}</p>
          <p className="break-all font-mono text-xs text-tsecondary">{root.path}</p></div>
        <IconButton label={t("sidebar.rescan", { label: root.label || root.path })} disabled={busy}
          onClick={() => void perform(async () => { await api.rescanRoot(root.id); await refresh(); })}><RefreshCw size={18} /></IconButton>
        <IconButton label={t("actions.remove_root")} disabled={busy}
          onClick={() => void perform(async () => { await api.removeRoot(root.id); await refresh(); })}><Trash2 size={18} /></IconButton>
      </li>)}</ul>
      <PillButton variant="ghost" onClick={() => navigate("/onboarding")}>{t("sidebar.add_library")}</PillButton>
      <p className="mt-4 text-sm text-tsecondary">{t("settings.remove_hint")}</p>
    </GlassCard>
    <GlassCard>
      <h2 className="mb-6 text-xl font-semibold">{t("settings.cache")}</h2>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <span className="font-mono">{bytes === null ? t("settings.loading") : formatBytes(bytes)}</span>
        <PillButton variant="ghost" disabled={!ready || busy} onClick={() => void perform(async () => {
          await invoke("clear_thumbnail_cache"); setBytes(await invoke<number>("thumbnail_cache_size"));
        })}>{t("settings.clear_cache")}</PillButton>
      </div>
    </GlassCard>
    <GlassCard>
      <form onSubmit={e => { e.preventDefault(); void perform(async () => {
        const db = await getDb();
        await db.execute("INSERT INTO settings(key, value) VALUES ('external_player', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [player.trim()]);
      }); }}>
        <label htmlFor="external-player" className="mb-6 block text-xl font-semibold">{t("settings.external_player")}</label>
        <input id="external-player" value={player} onChange={e => setPlayer(e.target.value)} disabled={!ready || busy}
          placeholder={t("settings.player_placeholder")} className="h-11 w-full rounded-control bg-surface-2 px-4 font-mono text-sm" />
        <PillButton className="mt-4" type="submit" disabled={!ready || busy}>{t("settings.save")}</PillButton>
      </form>
    </GlassCard>
    {message && <p role={failed ? "alert" : "status"} className={failed ? "text-danger" : "text-tsecondary"}>{t(message)}</p>}
  </div>;
}
