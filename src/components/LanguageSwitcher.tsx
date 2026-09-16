import { useTranslation } from "react-i18next";
import { Check, Globe } from "lucide-react";
import { Menu, MenuTrigger, MenuContent, MenuItem } from "@/components/ui/Menu";
import { LOCALES, persistLang, type Lang } from "@/i18n";

/**
 * Language dropdown: globe + current native name; check on active locale.
 * Choice persists to SQLite settings key 'lang'.
 */
export function LanguageDropdown({ align = "end" }: { align?: "start" | "end" }) {
  const { t, i18n } = useTranslation();
  const current: Lang = i18n.language.startsWith("ru") ? "ru" : "en";
  const active = LOCALES.find((l) => l.code === current);

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
    <Menu>
      <MenuTrigger asChild>
        <button
          aria-label={t("settings.language")}
          className="inline-flex h-11 w-full items-center gap-3 rounded-control px-3 text-left text-sm text-tsecondary transition-all duration-[160ms] ease-out hover:bg-white/[.06] hover:text-tprimary"
        >
          <Globe size={18} />
          <span className="min-w-0 flex-1 truncate">
            {active?.nativeName ?? current.toUpperCase()}
          </span>
        </button>
      </MenuTrigger>
      <MenuContent align={align} className="w-44">
        {LOCALES.map((l) => (
          <MenuItem
            key={l.code}
            onClick={() => void change(l.code)}
            className={l.code === current ? "text-tprimary" : undefined}
          >
            <span className="flex h-4 w-4 items-center justify-center">
              {l.code === current && <Check size={14} className="text-accent" />}
            </span>
            {l.nativeName}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

/** Compact globe IconButton variant for the collapsed rail. */
export function LanguageDropdownIcon() {
  const { t } = useTranslation();
  const { i18n } = useTranslation();
  const current: Lang = i18n.language.startsWith("ru") ? "ru" : "en";
  const active = LOCALES.find((l) => l.code === current);

  const change = async (lng: Lang) => {
    await i18n.changeLanguage(lng);
    document.documentElement.lang = lng;
    try {
      await persistLang(lng);
    } catch {
      /* noop */
    }
  };

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          aria-label={`${t("settings.language")}: ${active?.nativeName ?? current}`}
          title={active?.nativeName ?? current}
          className="flex h-11 w-full items-center justify-center rounded-control text-tsecondary transition-all duration-[160ms] ease-out hover:bg-white/[.06] hover:text-tprimary"
        >
          <Globe size={18} />
        </button>
      </MenuTrigger>
      <MenuContent side="right" align="start" className="w-44">
        {LOCALES.map((l) => (
          <MenuItem
            key={l.code}
            onClick={() => void change(l.code)}
            className={l.code === current ? "text-tprimary" : undefined}
          >
            <span className="flex h-4 w-4 items-center justify-center">
              {l.code === current && <Check size={14} className="text-accent" />}
            </span>
            {l.nativeName}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}