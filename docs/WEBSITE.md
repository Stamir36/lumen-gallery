# The project site (GitHub Pages)

The landing page lives in **`site/`** and is plain static HTML — no build step, no
framework, no npm packages. Two files carry all the behaviour:
`site/assets/style.css` and `site/assets/app.js`.

```
site/
  index.html              English landing page
  ru/index.html           Russian landing page
  privacy/index.html      English privacy policy
  ru/privacy/index.html   Russian privacy policy
  404.html                GitHub Pages 404 (links back home)
  robots.txt              crawler policy + sitemap pointer
  sitemap.xml             all four pages, with hreflang alternates
  .nojekyll               tells Pages not to run Jekyll on the artifact
  assets/
    style.css  app.js     the only two dependency-free assets
    favicon.svg icon.svg  brand marks (icon.svg is the app icon itself)
    screen1–4.jpg         app screenshots (copies of assets/Screen*.jpg)
    setup-*.png           first-run wizard screenshots
```

## Preview locally

```bash
pnpm site          # python -m http.server 4173 --directory site
```

Then open <http://localhost:4173/>. Opening `site/index.html` directly from the
filesystem also works (all references are relative), but a real server is closer
to how Pages serves it — and it is required for the Russian paths, which GitHub
Pages resolves from `/ru/` to `/ru/index.html`.

Both languages are separate HTML files rather than client-side translation, so
the page reads correctly for search engines and works with JavaScript disabled.
Every page carries `hreflang` alternates pointing at its translation.

## Deploy it

1. **Enable Pages once.** Repository → **Settings → Pages → Build and
   deployment → Source: `GitHub Actions`.** (Do *not* pick "Deploy from a
   branch": the workflow publishes an artifact, not a branch.)
2. **Push anything under `site/`** to `master`, or run the workflow manually
   from **Actions → Deploy site → Run workflow**.
3. **Wait for the green check.** The job `build` validates that no local link in
   the site points at a missing file, then `deploy` publishes it.

The workflow is `.github/workflows/pages.yml`. It needs no secrets: it uses the
automatic `GITHUB_TOKEN` plus the `pages`/`id-token` permissions declared in the
file.

If Pages has not been enabled yet, the run does **not** fail: the `build` job
succeeds, the `deploy` job is skipped, and the run summary spells out the
setting to change. (The Actions token cannot enable Pages by itself — creating a
Pages site needs more than `GITHUB_TOKEN` is allowed, so `enablement: true`
would just fail with *Resource not accessible by integration*.)

## The URL you get

For a project repository without a custom domain, Pages serves it at:

```
https://stamir36.github.io/lumen-gallery/          ← English
https://stamir36.github.io/lumen-gallery/ru/       ← Russian
https://stamir36.github.io/lumen-gallery/privacy/  ← privacy policy
```

You can see the exact address after any successful deploy in
**Actions → Deploy site → Deploy** (the job prints it) and in
**Settings → Pages** ("Your site is live at …"). It takes a minute or two after
the first deploy before the domain answers.

Put that address in the repository's **About → Website** field, and it becomes
one of the first things people see on the GitHub page.

### Custom domain (optional)

Add `site/CNAME` containing the bare domain (for example `lumen.example.com`),
create a CNAME DNS record pointing at `stamir36.github.io`, then set the domain
in **Settings → Pages → Custom domain** and tick *Enforce HTTPS*.

> If you switch to a custom domain, the root-relative links inside `404.html`
> (`/lumen-gallery/…`) must be changed to `/…`, because the site no longer lives
> under the `/lumen-gallery/` prefix.

## Keeping the page honest

The site states facts that are checked in the repository, so update them
together:

| Page says | Keep in sync with |
|---|---|
| "Version 0.2.0" in the download block | `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` |
| "install it from the Microsoft Store once LUMEN is listed there" | replace with a store link and a store button once the listing is live (`docs/MICROSOFT-STORE.md`) |
| screenshots in `site/assets/` | re-copy from `assets/Screen*.jpg` after a UI change |
| privacy claims | the code: no telemetry, no network calls |

## Design rules

The page is deliberately plain, and it should stay that way:

- **No glass.** No `backdrop-filter`, no blur, no translucent panels, no coloured
  glows. Solid colours and 1 px rules only. A visitor's browser should not have
  to composite anything to read the page.
- **Whitespace does the layout work.** Section padding comes from
  `--section`; keep it generous and set vertical rhythm with `padding-top` /
  `padding-bottom` — `padding: X 0` on a section class overrides the horizontal
  padding of `.wrap` and pushes text against the window edge.
- **One accent colour**, used only for the primary button and links inside text.
- **Write for a normal user.** No build commands, no file paths, no tech stack.
  "Your photos stay on your computer" beats "local-first, zero telemetry".
- **Motion stays subtle**: a 14 px fade-up per section, nothing else.

## Adding a page

Copy an existing page, keep the shared header/footer, point `hreflang` at both
languages, add it to `sitemap.xml`, and link it from the footer. The
`Deploy site` workflow will refuse to publish if any local `href`/`src` does not
resolve, which is the cheapest possible broken-link check.
