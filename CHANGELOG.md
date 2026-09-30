# Changelog

All notable changes to this project are documented here.
This project follows semantic versioning, with the DSH runtime version pinned through
`peerDependencies` (see README).

## 1.0.0 — 2026-09-30

First release.

### Added

- Background layer rendered behind the UI (an independent fixed layer, so blur never blurs the interface).
- Live controls: UI translucency (0–100%) and background blur (0–60px), both previewed while dragging.
- Image switching: file picker or drag & drop anywhere in the window; images are downscaled to ≤2560px and stored in the app's own storage.
- Settings persist across restarts, plus one-click reset.
- Health self-check: the panel only surfaces a warning when one of the five checks fails.
- Host routes: `/image`, `/mark`, `/status`, `/request` (the last two exist for diagnostics).
- Bundled default wallpaper (`assets/default.jpg`, AI-generated, 1672×941), overridable with `default.png`/`default.svg` or the `imagePath` config.

### Notes

- Verified against DSH 0.2.0-rc.2 on Windows.
- The plugin relies on a few undocumented DSH internals; see the Limitations section of the README.
