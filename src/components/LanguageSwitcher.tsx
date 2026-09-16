import { useTranslation } from "react-i18next";
import { Segmented } from "@/components/ui/Segmented";
import { persistLang, type Lang } from "@/i18n";

/** RU / EN pill switcher; choice is persisted to SQLite settings. */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current: Lang = i18n.language.startsWith("ru") ? "ru" : "en";

  const change = async (lng: Lang) => {
    await i18n.changeLanguage(lng);
    document.documentElement.lang = lng;
    try {
      await persistLang(lng);
    } catch {
      /* keep UI responsive even if persistence fails */
    }
  };

  return (
    <Segmented<Lang>
      aria-label={t("settings.language")}
      options={[
        { value: "ru", label: "RU" },
        { value: "en", label: "EN" },
      ]}
      value={current}
      onChange={(v) => void change(v)}
      className="w-full justify-center"
    />
  );
}