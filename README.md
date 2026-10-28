# Mod Manager

Drop a mod archive (.zip / .rar / .7z) onto the window and it installs into your game's mod folder. Supports Ready or Not (Paks) and BeamNG.drive.

## Download (Windows)

Grab the latest `.exe` from the [Releases page](../../releases):

- `ModManager-x.y.z-portable.exe` — no install, just double-click to run.
- `ModManager-x.y.z-setup.exe` — installer with Start-menu shortcut.

Windows SmartScreen may warn because the exe isn't code-signed: click **More info → Run anyway**.

The exe keeps its settings and your mod library in `Documents\Mod Manager`.

## Run from source

Requires [Node.js](https://nodejs.org) 20+.

```bash
npm install
npm start
```

From source, state lives in `data/` and each game's `zips/` + `unzipped/` folders sit next to the repo folder.

## Build the exe yourself

```bash
npm run dist
```

Output lands in `dist/`. Building on Windows is simplest; on Linux/macOS it needs Wine.

## Publishing a release

Pushing a tag like `v1.0.0` runs the GitHub Actions workflow, which builds both exes on Windows and attaches them to a GitHub Release. You can also run it manually from the Actions tab and download the exes from the run's artifacts.
