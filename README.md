# Mod Manager

Drop mod archives (.zip / .rar / .7z) onto the window and they install into your game's mod folder.

## Features

- **Finds your games itself.** Add Game lists every game in every Steam library. For Ready or Not and BeamNG.drive the mods folder is built in, so there's nothing to pick; BeamNG's `UserPath` setting in `startup.ini` is respected. For other games the app guesses from the folder layout (Unreal `Content\Paks`, BepInEx `plugins`, a `Mods` folder) and labels it as a guess to check. Call of Duty is listed as not supported, because file mods risk an account ban.
- **GTA V and RDR2: modded story mode, clean online.** Script mods (Script Hook, `.asi` loaders, `scripts\`) are kept in the app and only copied into the game folder in modded mode. **Play modded** puts them in and starts GTA V with `-nobattleye -scOfflineOnly`, so it can't reach GTA Online; RDR2 has no such switch, so the app reminds you to pick Story Mode. **Play online** takes them all out, checks the game folder against a snapshot taken when the game was added, and refuses to start if anything else is there, including mods copied in by hand. OpenIV `.oiv` packages aren't handled.
- **Only installs what the game reads.** For Ready or Not, just the `.pak` / `.ucas` / `.utoc` files go into `Paks` and readmes are left out. A custom map's WorldGen `.sav` goes to `%LOCALAPPDATA%\ReadyOrNot\Saved\SaveGames`.
- **Mods can't overwrite each other.** If two mods contain the same file, or a file is already there that the app didn't install, the install is refused and the app says which mod to deactivate.
- **Profiles.** Save the mods currently in the game as a named set and switch between sets in one click.
- **Game update warnings.** When Steam updates a game, the app flags the mods added before the update, since those are the likely cause of crashes.
- **Updates itself.** The installed (setup.exe) version downloads new releases from GitHub and offers a restart.
- Errors are written to `Documents\Mod Manager\data\log.txt`.

## Download (Windows)

Grab the latest `.exe` from the [releases repo](https://github.com/alext0525/mod-manager-releases/releases) (public, since this source repo is private):

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

Bump `version` in `package.json`, then push a matching tag like `v1.2.1`. The GitHub Actions workflow builds both exes on Windows and publishes them, plus `latest.yml`, as a release in the public [mod-manager-releases](https://github.com/alext0525/mod-manager-releases) repo. Installed copies check for updates without logging in, so they can't see this private repo's releases. They read `latest.yml` there to find an update.

Publishing needs a `RELEASES_TOKEN` secret in this repo: a fine-grained personal access token limited to `mod-manager-releases`, with **Contents: Read and write**. You can also run the workflow manually from the Actions tab and download the exes from the run's artifacts.
