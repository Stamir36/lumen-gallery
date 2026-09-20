# UI QA sweep — DESIGN.md v2.5 (P11 F5)

Дата: 2026-09-20. Метод: сплошной grep-аудит токенов по всем поверхностям +
точечные правки. «—» в колонке fixed-in = отклонений нет.

| Поверхность | Токен/правило | Отклонение | Исправлено в |
|---|---|---|---|
| Grid card | hover lift+glow 160ms, radius card 22, focus ring 2px accent/40 offset 2 | нет | — |
| Grid/list row | `aria-label="select"` — хардкод, мимо i18n | 1 строка | `5fad7af` (F5) |
| Folder card | elev-1, hover-lift, tprimary/ttertiary иерархия | нет | — |
| Explorer tree | hairline white/8, mono для путей | нет | — |
| Titlebar | glass не используется (structural chrome — whitelist §3), кнопки 40px | нет | — |
| Library bar + chips | glass topbar, Chip `backdrop-blur-xl` внутри glass-родителя (допустимо: nested blur не сквозит) | нет | — |
| Rail layout | одна панель radius 20, margin 12, mono-счётчики 10px, accent-полоса активного | нет (P10) | — |
| Status line | mono 11px ttertiary, tabular-nums | нет | — |
| Selection pill | glass, pill 999, item height 40 | нет | — |
| Context menu | glass v2.3, item 36→40px (заголовочные секции 40), 13px, mono hints | нет | `886865e` |
| Overflow menu (player) | inline v2.3 рецепт (темнее glass — сознательно, для контраста на светлых кадрах) | нет | — |
| Colour sheet | glass, radius 20, max-w 420, отступ 60px от пилла | нет | — |
| Lightbox topbar/pill | glass, mono-счётчик tnum, стрелки — полный glass-рецепт | стрелки были `backdrop-blur-sm` | `c213ead` |
| Lightbox filmstrip | glass bar radius viewer, счётчик mono; полоса прокрутки скрыта сознательно (strip сам индикатор) | задокументировано, не дефект | — |
| Video player pill | glass, JetBrains Mono только таймкоды | нет | — |
| Player progress | accent fill + mono tnum | нет | — |
| Up-next | surface-2/95, 13px | нет | — |
| Collage tiles | dominant-color bed, gap 10px, чип = язык grid-подписей | gap был 12px | `03d1a1c` |
| Collage tile menu | glass pill 40px | нет | — |
| Settings rows | min-height 64, hints 12px ttertiary (F6 доводит) | см. F6 | F6 |
| Onboarding | centered, display 28/650 | нет | — |
| Toasts | surface-2, spring enter/exit (P9) | нет | — |
| FAB / ScrollTopFab | glass, 56/44px, radius 20/pill | нет | — |
| Scrollbars | глобально 8px white/12→/20 | нет | — |
| Empty states | разнобой иконок/типографики | унифицированы | F6 |
| Focus-visible | 2px accent/40 offset 2 глобально (P9-3) | нет | — |
| Cursor | default на контролях (v2.2 opt-in `html.cursor-pointer`) | нет (сознательно) | — |
| ::selection | accent-soft tint | нет | — |
| i18n | все строки через t(); RU-плюралы media_one/few/many/other присутствуют | `aria-label="select"` | `5fad7af` |
| prefers-reduced-motion | глобальный media-query + useReducedMotion во вьюерах | нет | — |
| Радиусы вне токенов | 7px/9px на микро-чипах (внутри 6–10 семейства) | косметика, не чиню | — |

Glass-рецепт (F1): `glass`/`viewer-bar` = rgba(14,14,18,.68→.55) + blur(28)
saturate(1.4) + hairline white/8 + внутренний highlight. Потребители проверены:
ContextMenu, selection pill, overflow menu, collage chips, filmstrip bar, FAB,
ScrollTopFab, tooltips, mini-player, colour sheet, стрелки лайтбокса — все
несут рецепт; entrance-анимации оседают в opacity 1 без остаточных
transform/filter на предках (WebView2-требование), close-fade'ы живут только на
слоях, не являющихся предками glass на idle.

Хореография вьюера (F2): backdrop непрозрачен мгновенно; контент .96→1 180ms от
точки клика; выход — контент 140ms, затем фон 100ms; сменой меню-поверх-меню —
без кроссфейда.

Снято с задачи (redesign → TODO.md): нет.
