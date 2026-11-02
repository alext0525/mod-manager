# Mod Manager

Drop mod archives (.zip / .rar / .7z) onto the window and they install into your game's mod folder.

## Features

- **Your games are ready without setup.** Every game the app knows that's installed through Steam (any library folder) is added automatically at startup, with its mod folders built in: Ready or Not, BeamNG.drive (respecting `UserPath` in `startup.ini`), GTA V Enhanced/Legacy, Red Dead Redemption 2, Assetto Corsa, Assetto Corsa EVO, Dying Light: The Beast and The Witcher 3. Add Game lists every other Steam game too. VTOL VR is marked as modded through Steam Workshop. Call of Duty and Ghost Recon Breakpoint are marked as not supported, because file mods risk an account ban. For games the app doesn't know it guesses from the folder layout (Unreal `Content\Paks`, BepInEx `plugins`, a `Mods` folder) and labels it as a guess to check.
- **GTA V and RDR2: modded story mode, clean online.** Script mods (Script Hook, `.asi` loaders, `scripts\`) are kept in the app and only copied into the game folder in modded mode. **Play modded** puts them in and starts GTA V with `-nobattleye -scOfflineOnly`, so it can't reach GTA Online; RDR2 has no such switch, so the app reminds you to pick Story Mode. **Play online** takes them all out, checks the game folder against a snapshot taken when the game was added, and refuses to start if anything else is there, including mods copied in by hand. OpenIV `.oiv` packages aren't handled.
- **See where every file goes before installing.** Dropped mods are unpacked and sorted first. A preview shows each mod's detected type (map, `.pak` mod, UE4SS script mod, BeamNG vehicle, Script Hook…), every destination folder with its files, and everything left out. Nothing touches the game until you press Install. Mods the app can't place correctly are refused with the reason, not guessed.
- **Different kinds of mod go to different places.** Ready or Not: `.pak` / `.ucas` / `.utoc` → `Paks` (keeping `LogicMods` / `~mods`); a map's WorldGen `.sav` → `%LOCALAPPDATA%\ReadyOrNot\Saved\SaveGames`; UE4SS itself → `Binaries\Win64`; UE4SS script mods → the installed UE4SS's `Mods` folder, switched on with `enabled.txt` (refused if UE4SS isn't installed yet). RDR2: Lenny's Mod Loader mods → `lml\<mod>`. Assetto Corsa: cars → `content\cars`, tracks → `content\tracks`, skins → `content\cars\<car>\skins`, apps → `apps\python` / `apps\lua` (recognised by `data.acd`, `ui_car.json`, `ui_track.json`, `ui_skin.json`…), packs already laid out like the game folder copied as they are. Assetto Corsa EVO: `.kspkg` car packages → `Saved Games\ACE\mods` (original-AC mods are refused). Dying Light: The Beast: mod `.pak` files → `ph_ft\source`, renamed to the next free `data2.pak`–`data7.pak` (the only names the game loads). The Witcher 3: `mod…` folders → `mods\`, `dlc…` folders → `dlc\`, `bin\` config → `bin\`, with a Script Merger note for script mods. Readmes, screenshots and installers are left out.
- **Alternative versions and optional extras.** When an archive has its `.pak` files in two or more folders side by side ("Normal" / "No CCTV", or main files next to "Optional"), or holds archives inside it, the preview lets you pick which to install. Versions must be picked; main files are chosen by default and extras are opt-in. A combination that clashes (two versions with the same file) is refused on the spot and the previous choice is kept.
- **Mods can't overwrite each other.** If two mods contain the same file, or a file is already there that the app didn't install, the install is refused and the app says which mod to deactivate.
- **Profiles.** Save the mods currently in the game as a named set and switch between sets in one click.
- **Requirement checks (GTA V / RDR2).** The app works out what each mod needs (Script Hook V or RDR2, Script Hook V .NET, an ASI loader, OpenIV.asi) and what it provides, and flags anything missing in the preview, the mod list and the mode panel. A newer Script Hook replaces the old one instead of clashing with it, and after a game update the app warns that Script Hook probably needs updating before Play modded.
- **Back to vanilla.** One button takes every app-installed mod out of a game. The set in use is saved as a "Before vanilla" profile so it comes back in one click. Hand-installed files aren't touched.
- **Crash helper.** Reads the game's newest crash report and logs (Ready or Not's `Saved\Crashes` and UE4SS log, BeamNG's `beamng.log`, Script Hook / ASI logs for GTA V and RDR2). It names the mods that appear at an error, plus those added most recently or before the latest game update. A banner appears after a new Ready or Not crash.
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
