# Mod Manager

Drop mod archives (.zip / .rar / .7z) onto the window and they install into your game's mod folder.

## Features

- **Finds your games itself.** Ready or Not and BeamNG.drive are found through Steam (any library folder), so there's no mods folder to pick. For other games, point it at the install folder and it guesses where mods go (Unreal `Content\Paks`, BepInEx `plugins`, a `Mods` folder).
- **Only installs what the game reads.** For Ready or Not, just the `.pak` / `.ucas` / `.utoc` files go into `Paks` and readmes are left out. A custom map's WorldGen `.sav` goes to `%LOCALAPPDATA%\ReadyOrNot\Saved\SaveGames`.
- **Mods can't overwrite each other.** If two mods contain the same file, or a file is already there that the app didn't install, the install is refused and the app says which mod to deactivate.
- **Profiles.** Save the mods currently in the game as a named set and switch between sets in one click.
- **Game update warnings.** When Steam updates a game, the app flags the mods added before the update, since those are the likely cause of crashes.
- **Updates itself.** The installed (setup.exe) version downloads new releases from GitHub and offers a restart.
- Errors are written to `Documents\Mod Manager\data\log.txt`.

## Download (Windows)

Grab the latest `.exe` from the [Releases page](../../releases):

- `ModManager-x.y.z-setup.exe` — installer with Start-menu shortcut. Keeps itself up to date.
- `ModManager-x.y.z-portable.exe` — no install, just double-click to run. Doesn't auto-update.

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

If the build fails extracting `winCodeSign` with "A required privilege is not held by the client", Windows won't let electron-builder create symlinks. Skip that step (the exe isn't signed anyway):

```bash
npx electron-builder --win -c.win.signAndEditExecutable=false
```

## Publishing a release

Bump `version` in `package.json`, then push a matching tag like `v1.1.0`. The GitHub Actions workflow builds both exes on Windows and attaches them, plus `latest.yml`, to a GitHub Release. Installed copies read `latest.yml` to find the update. You can also run the workflow manually from the Actions tab and download the exes from the run's artifacts.
