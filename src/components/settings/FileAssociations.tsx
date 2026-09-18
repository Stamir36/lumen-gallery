import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, CircleAlert, ExternalLink, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PillButton } from "@/components/ui/PillButton";
import { tauriAvailable } from "@/lib/assets";

/**
 * Opt-in file associations UI (Phase 6 STEP 4).
 *
 * The contract is user sovereignty: LUMEN only ADDS itself to the "Open with"
 * list (OpenWithProgids); becoming the DEFAULT app is a Windows Settings
 * action, offered here as a shortcut. Unregister deletes exactly the manifest
 * entries; the generated lumen-unregister.reg removes every trace even after
 * the portable exe is gone.
 */
interface AssocStatus {
  registered: boolean;
  registeredExe: string | null;
  pathDrift: boolean;
  regFile: string | null;
}

type Dialog = "register" | "unregister" | null;

export function FileAssociations() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<AssocStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);

  useEffect(() => {
    if (!tauriAvailable()) return;
    void invoke<AssocStatus>("assoc_status")
      .then((s) => {
        setStatus(s);
        // path drift guard: the exe moved — registration points at a ghost
        if (s.pathDrift) {
          toast(t("settings.assoc_drift_toast"), {
            action: {
              label: t("settings.assoc_register"),
              onClick: () =>
                void invoke<AssocStatus>("assoc_register")
                  .then(setStatus)
                  .then(() => toast.success(t("settings.assoc_registered_toast")))
                  .catch((e) => toast.error(String(e))),
            },
            duration: 10_000,
          });
        }
      })
      .catch(() => setStatus(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const register = () => {
    setBusy(true);
    void invoke<AssocStatus>("assoc_register")
      .then(setStatus)
      .then(() => setDialog("register"))
      .catch((e) => toast.error(String(e)))
      .finally(() => setBusy(false));
  };

  const unregister = () => {
    setBusy(true);
    void invoke<AssocStatus>("assoc_unregister")
      .then(setStatus)
      .then(() => toast.success(t("settings.assoc_unregistered_toast")))
      .catch((e) => toast.error(String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <div className="border-t border-hairline py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex flex-col gap-0.5">
            <span className="flex items-center gap-2 text-sm text-tprimary">
              <ShieldCheck size={16} className="text-tsecondary" />
              {t("settings.associations")}
            </span>
            <span className="text-[12px] text-ttertiary">
              {t("settings.assoc_hint")}
            </span>
          </span>
          <span className="flex items-center gap-3">
            <span
              className={
                "flex items-center gap-1.5 font-mono text-[12px] " +
                (status?.registered ? "text-tsecondary" : "text-ttertiary")
              }
            >
              {status?.registered ? (
                <CheckCircle2 size={14} className="text-accent" />
              ) : (
                <CircleAlert size={14} />
              )}
              {status?.registered
                ? t("settings.assoc_status_on")
                : t("settings.assoc_status_off")}
            </span>
            {status?.registered ? (
              <PillButton
                variant="ghost"
                disabled={busy}
                onClick={() => setDialog("unregister")}
              >
                {t("settings.assoc_unregister")}
              </PillButton>
            ) : (
              <PillButton disabled={busy || status === null} onClick={register}>
                {t("settings.assoc_register")}
              </PillButton>
            )}
          </span>
        </div>
        {status?.registered && status.regFile && (
          <p className="mt-3 break-all font-mono text-[11px] text-ttertiary">
            {t("settings.assoc_regfile_hint")}: {status.regFile}
          </p>
        )}
      </div>

      <AnimatePresence>
        {dialog !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-[160] flex items-center justify-center bg-black/60 p-6"
            role="dialog"
            aria-modal="true"
            onClick={() => setDialog(null)}
          >
            <motion.div
              initial={{ scale: 0.94, y: 12, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.96, y: 8, opacity: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[520px] rounded-control border border-white/[.08] bg-surface-1 p-6 shadow-2xl"
            >
              <h3 className="text-base font-semibold text-tprimary">
                {dialog === "register"
                  ? t("settings.assoc_dialog_title")
                  : t("settings.assoc_unreg_dialog_title")}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-tsecondary">
                {dialog === "register"
                  ? t("settings.assoc_dialog_body")
                  : t("settings.assoc_unreg_dialog_body")}
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
                {dialog === "register" && (
                  <PillButton
                    variant="ghost"
                    onClick={() => {
                      setDialog(null);
                      void invoke("assoc_open_settings").catch((e) =>
                        toast.error(String(e)),
                      );
                    }}
                  >
                    <ExternalLink size={16} />
                    {t("settings.assoc_open_settings")}
                  </PillButton>
                )}
                {dialog === "unregister" && (
                  <PillButton variant="ghost" onClick={unregister} disabled={busy}>
                    {t("settings.assoc_unreg_confirm")}
                  </PillButton>
                )}
                <PillButton onClick={() => setDialog(null)}>
                  {t("settings.assoc_later")}
                </PillButton>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
