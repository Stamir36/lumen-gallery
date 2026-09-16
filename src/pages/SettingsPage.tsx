import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { WindowTitleBar } from "@/components/WindowTitleBar";
import { IconButton } from "@/components/ui/IconButton";
import { SettingsContent } from "@/pages/SettingsContent";
import { useNavigate } from "react-router-dom";

/** /#/settings — libraries, language, cache, external player (SPEC §14). */
export default function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col">
      <WindowTitleBar
        leftAction={
          <IconButton label={t("actions.back")} onClick={() => navigate("/")}>
            <ArrowLeft size={18} />
          </IconButton>
        }
      />
      <main className="min-h-0 flex-1 overflow-y-auto px-8 py-12 lg:px-10">
        <div className="mx-auto max-w-3xl space-y-12">
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-tprimary">
            {t("settings.title")}
          </h1>
          <SettingsContent />
        </div>
      </main>
    </div>
  );
}
