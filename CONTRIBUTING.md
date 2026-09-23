# Contributing to LUMEN

Thanks for wanting to help. LUMEN is a desktop gallery: it is judged by how it
*feels* while scrolling 50 000 files, so small details matter more than big
rewrites.

[English](#english) · [Русский](#русский)

---

## English

### Before you start

- **Open an issue first** for anything bigger than a bug fix. The UI has a
  deliberate design language (`docs/DESIGN.md`), and a patch that ignores it
  will be asked to change even if the code is fine.
- **Read `docs/SPEC.md`** for how the library, thumbnails and viewer are meant
  to behave.

### Setup

```bash
pnpm install
pnpm tauri dev        # or dev.bat on Windows
```

Requirements: Node 20+, pnpm, Rust stable 1.77.2+, Windows 10/11 with WebView2.

### Checks to run before you push

```bash
pnpm typecheck
pnpm build
pnpm e2e                                   # first time: pnpm e2e:update
(cd src-tauri && cargo clippy --all-targets)
```

Pixel baselines (`e2e/*.spec.ts-snapshots/`) are **not** committed — they depend
on the machine's fonts and GPU. Record them locally once; if your change is
supposed to alter the UI, re-record and *look at the diff before accepting it*.

### Code conventions

- **TypeScript**: strict, no `any` escaping into the public surface. Comment the
  *why*, not the *what* — the code already says what.
- **Rust**: 2-space indentation, `snake_case`, one writer for SQLite. Never open
  a second pool connection next to `writer::spawn`; send the write through the
  task instead.
- **Design tokens**: colours, radii and motion come from `src/index.css` and
  `src/lib/settings.ts`. No hard-coded hex values in components.
- **i18n**: every user-visible string goes through `t()` and lands in *both*
  `src/i18n/ru.json` and `src/i18n/en.json`. A raw key on screen is a bug.
- **Accessibility**: controls keep an accessible name (`aria-label`), switches
  use `role="switch"` + `aria-checked`; the e2e specs read those attributes.

### Pull requests

- One concern per PR, with a short "why" in the description.
- If a UI change is visible, add or update the relevant Playwright spec — the
  wizard walkthrough in `e2e/setup-wizard.spec.ts` is the model to copy: it
  clicks real controls and asserts real state instead of only pixels.
- Mention the Windows version and library size for anything performance-related.

### Reporting bugs

Include: Windows version, library size, the exact steps, and the tail of
`%LOCALAPPDATA%\com.unesell.lumen\logs\LUMEN.log`. If the app froze, the log
already contains frame times and long-task warnings — please paste them.

---

## Русский

### Перед началом

- **Сначала issue** — для всего, что больше простого багфикса. У интерфейса есть
  осознанный язык дизайна (`docs/DESIGN.md`), и патч, который его игнорирует,
  придётся переделать даже при корректном коде.
- **Прочитайте `docs/SPEC.md`** — там описано, как должны вести себя библиотека,
  превью и просмотрщик.

### Установка

```bash
pnpm install
pnpm tauri dev        # или dev.bat на Windows
```

Нужно: Node 20+, pnpm, Rust stable 1.77.2+, Windows 10/11 с WebView2.

### Что прогнать перед отправкой

```bash
pnpm typecheck
pnpm build
pnpm e2e                                   # в первый раз: pnpm e2e:update
(cd src-tauri && cargo clippy --all-targets)
```

Пиксельные базлайны (`e2e/*.spec.ts-snapshots/`) **не коммитятся** — они зависят
от шрифтов и GPU конкретной машины. Запишите их локально один раз; если ваше
изменение действительно меняет интерфейс — перезапишите и **посмотрите на diff
перед тем, как принять его**.

### Правила кода

- **TypeScript**: strict, никакого `any` на публичной поверхности. Комментируйте
  *почему*, а не *что* — код и так говорит, что он делает.
- **Rust**: отступ в 2 пробела, `snake_case`, единственный писатель в SQLite.
  Никогда не открывайте второе подключение к пулу рядом с `writer::spawn` —
  отправляйте запись через задачу.
- **Токены дизайна**: цвета, радиусы и анимации берутся из `src/index.css` и
  `src/lib/settings.ts`. Никаких хардкод-цветов в компонентах.
- **i18n**: любая видимая пользователю строка идёт через `t()` и попадает в
  **оба** файла — `src/i18n/ru.json` и `src/i18n/en.json`. Ключ вместо текста на
  экране — это баг.
- **Доступность**: у элементов управления есть доступное имя (`aria-label`),
  переключатели используют `role="switch"` + `aria-checked`; e2e-тесты читают
  именно эти атрибуты.

### Pull request

- Одна задача на PR, с коротким «зачем» в описании.
- Если интерфейс визуально изменился — добавьте или обновите тест Playwright.
  Образец для подражания — сценарий мастера настройки
  (`e2e/setup-wizard.spec.ts`): он кликает по настоящим контролам и проверяет
  настоящее состояние, а не только пиксели.
- Для всего, что связано с производительностью, указывайте версию Windows и
  размер библиотеки.

### Баг-репорт

Приложите: версию Windows, размер библиотеки, точные шаги и последние строки из
`%LOCALAPPDATA%\com.unesell.lumen\logs\LUMEN.log`. Если приложение зависло — в
логе уже есть времена кадров и предупреждения о долгих задачах, вставьте их.