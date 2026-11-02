const fs = require('fs');
const path = require('path');
const os = require('os');

const { extractArchive } = require('../extractor');
const {
  walkFiles,
  moveInto,
  expandNestedArchives,
  findVariants,
  defaultSelection,
  filterSelected,
} = require('./files');

// Unreal Engine games like Ready or Not load .pak files from their Paks folder;
// newer mods add a matching .ucas/.utoc pair that must sit beside the .pak.
// Everything else in a mod archive (readmes, preview images, wrapper folders)
// is left out, except side files the game's catalog entry knows a home for.
const PAK_EXTS = new Set(['.pak', '.ucas', '.utoc']);

// Subfolders of Paks that mean something to the game or a mod loader. A file
// found under one keeps that folder; any other folder is just a wrapper.
const KEPT_SUBFOLDERS = ['logicmods', '~mods'];

function pakDestination(relPath) {
  const parts = relPath.split(path.sep);
  const file = parts.pop();
  const lower = parts.map((p) => p.toLowerCase());
  for (const keep of KEPT_SUBFOLDERS) {
    const i = lower.lastIndexOf(keep);
    if (i !== -1) return path.join(parts[i], file);
  }
  return file;
}


// UE4SS is a script loader for Unreal games. It and the Lua/C++ mods that run
// on it don't live in Paks: the loader sits next to the game's exe
// (dwmapi.dll + ue4ss\), and each script mod is a folder in its Mods folder.
const UE4SS_MOD_ENTRY = /(^|[\\/])(Scripts[\\/]main\.lua|dlls[\\/]main\.dll)$/i;

// Where this game's UE4SS keeps its mods, if UE4SS is installed.
function ue4ssModsDir(binariesDir) {
  if (!binariesDir) return null;
  const candidates = [
    { loader: path.join(binariesDir, 'ue4ss', 'UE4SS.dll'), mods: path.join(binariesDir, 'ue4ss', 'Mods') },
    { loader: path.join(binariesDir, 'UE4SS.dll'), mods: path.join(binariesDir, 'Mods') },
  ];
  const found = candidates.find((c) => fs.existsSync(c.loader));
  return found ? found.mods : null;
}

// The archive folder holding the UE4SS loader itself (dwmapi.dll beside a
// ue4ss folder, or UE4SS.dll), relative to the archive root; null if absent.
function findUe4ssLoader(files) {
  const lower = files.map((f) => f.toLowerCase().split(path.sep).join('/'));
  for (const f of lower) {
    if (f.endsWith('ue4ss/ue4ss.dll')) return path.dirname(path.dirname(f));
    if (path.basename(f) === 'ue4ss.dll') return path.dirname(f);
  }
  return null;
}

function under(dir, rel) {
  const d = dir === '.' ? '' : dir.toLowerCase();
  const r = rel.toLowerCase().split(path.sep).join('/');
  return d === '' || r.startsWith(d + '/');
}

// Stages each kind of content under its own folder in stagingDir and tells
// the installer where each goes:
//   game/        .pak/.ucas/.utoc        -> Paks (LogicMods / ~mods kept)
//   ue4ss/       UE4SS loader            -> Binaries\Win64
//   ue4ss-mods/  UE4SS script mods       -> the installed UE4SS's Mods folder
//   side-<n>/    catalog side files      -> e.g. Ready or Not's SaveGames
// Anything else is left out and listed, so the user sees exactly what wasn't
// installed.
async function prepare({ archivePath, stagingDir, sideFiles = [], ue4ssBinaries, variants: chosen }) {
  const archiveName = path.basename(archivePath);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'paks-prep-'));
  try {
    await extractArchive(archivePath, scratch);
    await expandNestedArchives(scratch);
    const allFiles = walkFiles(scratch);

    // Several folders of .pak files: alternative versions or optional extras.
    // The user picks; nothing is staged until at least one is chosen.
    const versions = findVariants(
      allFiles,
      (f) => PAK_EXTS.has(path.extname(f).toLowerCase()),
      KEPT_SUBFOLDERS
    );
    const selection = chosen || (versions ? defaultSelection(versions) : []);
    const variantInfo = versions && {
      groups: versions.groups.map((g) => ({ ...g, selected: selection.includes(g.id) })),
    };
    if (versions && selection.length === 0) {
      return {
        needsChoice: true,
        variants: variantInfo,
        placements: [],
        kind: `${versions.groups.length} versions inside — pick which to install`,
      };
    }
    const files = filterSelected(allFiles, versions, selection);
    const used = new Set();
    const placements = [];
    const kinds = [];
    const notes = [];

    // The UE4SS loader itself.
    const loaderDir = findUe4ssLoader(files);
    if (loaderDir !== null) {
      if (!ue4ssBinaries) throw new Error(`"${archiveName}" is UE4SS, which this game isn't set up for.`);
      for (const rel of files.filter((f) => under(loaderDir, f))) {
        const inner = loaderDir === '.' ? rel : rel.slice(loaderDir.length + 1);
        if (/\.(txt|md|pdf|url|png|jpe?g)$/i.test(rel) && !/[\\/]/.test(inner)) continue;
        moveInto(path.join(scratch, rel), path.join(stagingDir, 'ue4ss', inner), archiveName);
        used.add(rel);
      }
      placements.push({ from: 'ue4ss', to: ue4ssBinaries, label: 'UE4SS loader' });
      kinds.push('UE4SS (script loader)');
    }

    // UE4SS script mods: each folder holding Scripts\main.lua or dlls\main.dll.
    const modDirs = [
      ...new Set(
        files
          .filter((f) => !used.has(f) && UE4SS_MOD_ENTRY.test(f))
          .map((f) => path.dirname(path.dirname(f)))
      ),
    ];
    if (modDirs.length) {
      const modsDir = ue4ssModsDir(ue4ssBinaries);
      if (!modsDir) {
        throw new Error(
          `"${archiveName}" is a UE4SS script mod, which needs UE4SS installed in the game first. ` +
            `Download UE4SS, add its zip here, then add this mod again.`
        );
      }
      for (const dir of modDirs) {
        // A mod at the archive root gets its folder name from the archive.
        const name = dir === '.' ? path.basename(archivePath, path.extname(archivePath)) : path.basename(dir);
        for (const rel of files.filter((f) => !used.has(f) && under(dir, f))) {
          const inner = dir === '.' ? rel : rel.slice(dir.length + 1);
          moveInto(path.join(scratch, rel), path.join(stagingDir, 'ue4ss-mods', name, inner), archiveName);
          used.add(rel);
        }
        // UE4SS only runs mods that are switched on; enabled.txt does that
        // without touching the user's mods.txt.
        const enabled = path.join(stagingDir, 'ue4ss-mods', name, 'enabled.txt');
        if (!fs.existsSync(enabled)) fs.writeFileSync(enabled, '');
      }
      placements.push({ from: 'ue4ss-mods', to: modsDir, label: 'UE4SS script mod' });
      kinds.push(`UE4SS script mod${modDirs.length > 1 ? 's' : ''}`);
    }

    // .pak files.
    const pakFiles = files.filter((f) => !used.has(f) && PAK_EXTS.has(path.extname(f).toLowerCase()));
    for (const rel of pakFiles) {
      moveInto(path.join(scratch, rel), path.join(stagingDir, 'game', pakDestination(rel)), archiveName);
      used.add(rel);
    }
    if (pakFiles.length) {
      placements.unshift({ from: 'game', label: 'Paks folder' });
      const logic = pakFiles.some((f) => /(^|[\\/])logicmods[\\/]/i.test(f));
      kinds.push(logic ? 'Blueprint mod (LogicMods)' : '.pak mod');
      if (logic && !ue4ssModsDir(ue4ssBinaries)) {
        notes.push('LogicMods only load with UE4SS installed. It isn\'t installed in this game yet.');
      }
    }

    // Side files the catalog knows a home for (e.g. a map's WorldGen save).
    sideFiles.forEach((rule, n) => {
      const matches = files.filter((f) => !used.has(f) && rule.pattern.test(path.basename(f)));
      if (matches.length === 0) return;
      const from = `side-${n}`;
      for (const rel of matches) {
        moveInto(path.join(scratch, rel), path.join(stagingDir, from, path.basename(rel)), archiveName);
        used.add(rel);
      }
      // Side files are extras: never overwrite one that's already there, and
      // never delete it on removal, since the game may have rebuilt it since.
      placements.push({ from, to: rule.dir(), label: rule.label, optional: true });
      const pakKind = kinds.indexOf('.pak mod');
      if (rule.label === 'WorldGen save' && pakKind !== -1) kinds[pakKind] = 'Map';
    });

    if (placements.length === 0) {
      const shown = files.slice(0, 5).map((f) => path.basename(f)).join(', ');
      throw new Error(
        `"${archiveName}" has no .pak file and no UE4SS mod in it, so it isn't a mod this game can load` +
          (shown ? ` (found: ${shown}).` : '.')
      );
    }

    const skipped = files.filter((f) => !used.has(f));
    return {
      placements,
      skipped,
      skippedFiles: skipped.length,
      kind: kinds.join(' + '),
      notes,
      variants: variantInfo || undefined,
    };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

module.exports = {
  id: 'paks',
  prepare,
  // Shown in the UI under the drop zone.
  hint: 'Only the mod\'s .pak files are copied into the game\'s Paks folder.',
};
