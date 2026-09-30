# dsh-desktop-wallpaper

> A wallpaper plugin for **DeepSeek Harness**: pick any image, choose how much of the UI shows
> through, blur the background — everything applies live, without restarting.

English | [简体中文](README.zh-CN.md)

## Screenshots

![Wallpaper applied behind the interface](docs/wallpaper-applied.jpg)

*Your image sits behind the interface; the 🎨 button in the bottom-right corner opens the controls.*

![Control panel with translucency and blur sliders](docs/control-panel.jpg)

*The control panel: pick an image (or drag one onto the window), then tune UI translucency and
background blur — both preview while you drag.*

## Features

- **Manual image** — use the file picker, or just drag an image anywhere onto the window.
  Images are downscaled (≤2560px, JPEG q0.85) and kept in the app's own storage, so the host never
  has to write to disk.
- **UI translucency** (0–100%) — 0% shows the wallpaper on its own, 100% is close to the stock look.
- **Background blur** (0–60px) — blur is applied to the wallpaper layer only, so the interface stays sharp.
- **Live preview** — both sliders redraw while you drag.
- **Remembers your settings** across restarts, with one-click reset.
- **Health self-check** — the panel stays clean and only surfaces a warning line when a check fails.
- **No runtime dependencies, no build step** — one host file, one browser file.

## Requirements

- DSH **0.2.0-rc.2** (verified). The supported range is declared in `peerDependencies`
  (`@deepseek-ai/dsh`); DSH's compatibility policy refuses to load the plugin on an unsupported
  runtime and prints how to grant an exact-version exemption if you want to accept the risk.

## Install

```sh
# latest from the default branch
dsh plugin --profile <profile> install github:tt-zjy/dsh-desktop-wallpaper

# pin a release
dsh plugin --profile <profile> install github:tt-zjy/dsh-desktop-wallpaper#v1.0.0
```

Restart DSH afterwards unless the plugin manager reports it applied the change live.

> **Desktop app users:** the desktop application owns `profiles/desktop/cordis.patch.yml` and
> rewrites it at boot, so an entry installed into that file may disappear on the next launch.
> Put the entry in the home user layer (`$DSH_HOME/cordis.patch.yml`) or install through the app's
> own plugin UI instead.

## Usage

Click the **🎨** button in the bottom-right corner:

| Control | Effect |
| --- | --- |
| Choose image / Restore default | Replace or drop the wallpaper (system file dialog, or drag & drop onto the window) |
| UI translucency | How much the interface lets the wallpaper through |
| Background blur | Blur radius applied to the wallpaper only |
| Reset all | Back to the defaults |

Panel values are stored per window origin, so they come back after a restart.

## Configuration (optional)

The bundled default wallpaper is `assets/default.jpg` (1672×941). Dropping in a `default.png` or
`default.svg` next to it also works — they are tried in the order jpg → png → svg, and if none
exists the plugin simply leaves the UI untouched. To point at your own file, set `imagePath` on the
patch entry:

```yaml
- insert:
    - id: desktop-wallpaper
      name: dsh-desktop-wallpaper
      inject: [webServer, fs]
      config:
        imagePath: C:\pictures\my-wallpaper.jpg   # optional
```

## How it works

- **Host half** (`lib/index.js`) registers ordinary HTTP routes: `/dsh-desktop-wallpaper/image`
  serves the wallpaper (re-read from disk per request) and `/mark`, `/status`, `/request` carry
  diagnostics.
- **Browser half** (`lib/client.js`) runs inside the app window. It creates an independent
  fixed-position background layer (so blur never touches the interface) and overrides the
  `--dsw-alias-*` theme tokens so the UI surfaces become translucent. The tokens are pushed twice —
  an injected stylesheet *and* inline `!important` on `body` — because in practice only the inline
  form reliably wins over the theme's own stylesheet.

The host half exists because the desktop shell serves the window's HTML from packaged static assets;
host-side HTML injection cannot reach it, while any non-static path is forwarded to the host.

## Limitations

Please read this before filing an issue:

1. **Undocumented internals.** The plugin relies on the `--dsw-alias-*` token names, the
   `window.__ModuleLoader__.load({ id, factory })` bundle contract, and the `dsh-app:` shell
   protocol. These are not public API, so **a future DSH release may break it**. That is what the
   `peerDependencies` range is for: an unsupported runtime refuses the plugin instead of half-loading it.
2. **It injects UI and overrides theme tokens** (with `!important`) into the page. That is inherent
   to how a wallpaper works here. It reads no data and writes nothing except its own settings.
3. **Code changes need a restart.** The browser bundle is served under a content-hash revision
   computed when the host boots, so only a restart delivers a new bundle. Changing settings never needs one.
4. Verified on Windows. Paths go through DSH's `fs` service, so macOS/Linux should work, but they are untested.

## Development

```sh
npm run verify     # syntax check + unit tests (no install required)
```

Layout: `lib/index.js` (host), `lib/client.js` (browser), `tests/unit.cjs` (fake-DOM tests),
`scripts/set-package-name.mjs` (renames every place the package name appears).
See [CONTRIBUTING.md](CONTRIBUTING.md) for the contract the browser bundle must keep and for how to
test against a real DSH.

## License

[MIT](LICENSE). The bundled default wallpaper (`assets/default.jpg`) is AI-generated artwork
included under the same license; if you replace it, make sure you have the right to redistribute
the image you use.
