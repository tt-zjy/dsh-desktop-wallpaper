# Contributing

Thanks for taking a look. This plugin is intentionally small: **two hand-written JS files, no
dependencies, no build step.**

## Layout

| Path | What it is |
| --- | --- |
| `lib/index.js` | Host half: a Cordis plugin that registers ordinary HTTP routes (image + diagnostics). |
| `lib/client.js` | Browser half: runs in the app window; injects the background layer, the control panel and the theme token overrides. |
| `tests/unit.cjs` | Fake-DOM unit tests for the browser half. |
| `scripts/set-package-name.mjs` | Renames the package in every place that must stay in sync. |
| `assets/default.jpg` | Bundled default wallpaper (1672×941); a `default.png` or `default.svg` overrides it, and `imagePath` overrides both. |
| `docs/*.jpg` | Screenshots used by the README. Documentation only — `package.json`'s `files` keeps them out of the published package. |

## Before you push

```sh
npm run verify     # syntax check + unit tests; needs no install
```

CI runs exactly the same two commands.

## Things that must stay in sync

The package name appears in **three** places; a mismatch makes the client half fail to load:

1. `package.json` → `name`
2. `lib/index.js` → `export const name`
3. `lib/client.js` → `window.__ModuleLoader__.load({ id })` **and** `const PKG`

Use the helper instead of editing by hand:

```sh
node scripts/set-package-name.mjs @you/dsh-desktop-wallpaper
```

`lib/client.js` must keep the `window.__ModuleLoader__.load({ id, factory })` shape, with `id`
equal to the package name, and export `apply` (plus `inject`) from the factory. That contract is
how DSH's client runtime loads browser-side plugin code.

## Testing against a real DSH

1. Install into a profile: `dsh plugin --profile <profile> install <this-package-or-path>`.
2. For the **desktop app**, note that it owns `profiles/desktop/cordis.patch.yml` and rewrites it at
   boot — put the entry in the home user layer (`$DSH_HOME/cordis.patch.yml`) or install through the
   app's own plugin UI instead.
3. The browser bundle is served under a content-hash revision computed at host boot, so **code
   changes need a restart** to reach a window. Settings changes never do.
4. Diagnostics: after the app is running, `GET /dsh-desktop-wallpaper/status` lists every run mark
   (protocol, injected tokens, image size, topmost element chain), and `GET /dsh-desktop-wallpaper/request`
   bumps a counter that makes the running window report a fresh snapshot within ~5s.

## Versioning

- Keep the `peerDependencies` range (`@deepseek-ai/dsh`) honest. DSH refuses to load a plugin whose
  declared range does not satisfy the running runtime, and tells the user how to grant an exact-version
  exemption if they accept the risk. That mechanism is the whole point of declaring the range.
- Add a `CHANGELOG.md` entry per release, and tag releases (`v1.0.0`) so people can pin
  `github:tt-zjy/dsh-desktop-wallpaper#v1.0.0`.

## Never commit

- `.probe/` or any extracted DSH runtime sources, logs, or personal absolute paths.
- Wallpaper images you do not have the right to redistribute.
