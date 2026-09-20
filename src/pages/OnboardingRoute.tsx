import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { WindowTitleBar } from "@/components/WindowTitleBar";
import { IconButton } from "@/components/ui/IconButton";
import { Onboarding } from "@/pages/Onboarding";
import { getDb } from "@/lib/db";
import { useRootsStore } from "@/state/library";
import { useNavigate } from "react-router-dom";

/** QA route: /#/onboarding — the root picker without waiting for first run. */
export default function OnboardingRoute() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const load = useRootsStore((s) => s.load);

  useEffect(() => {
    getDb()
      .catch(() => undefined)
      .then(() => load());
  }, [load]);

  return (
    <div className="flex h-full flex-col">
      {/* F8: "Add library" from Settings lands here — without a back action the
          only exit was an app restart */}
      <WindowTitleBar
        leftAction={
          <IconButton label={t("actions.back")} onClick={() => navigate(-1)}>
            <ArrowLeft size={18} />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1">
        <Onboarding onDone={() => navigate("/")} />
      </div>
    </div>
  );
}
