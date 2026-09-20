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
      {/* Fluid layout per v2.2: no max-width, 40px gutters. The accent wash
          sits on the PAGE (like the onboarding hero), not on a card — one
          title, one glow, no duplicate header inside the content. */}
      <main className="relative min-h-0 flex-1 overflow-y-auto px-10 py-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[380px]"
          style={{
            background:
              "radial-gradient(60% 70% at 24% 0%, var(--accent-soft), transparent 70%)",
            opacity: 0.7,
          }}
        />
        <div className="relative space-y-12">
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-tprimary">
            {t("settings.title")}
          </h1>
          <SettingsContent />
        </div>
      </main>
    </div>
  );
}
