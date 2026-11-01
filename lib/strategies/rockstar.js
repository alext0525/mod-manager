const fs = require('fs');
const path = require('path');
const os = require('os');

const { extractArchive } = require('../extractor');

// GTA V / RDR2 script mods: Script Hook, ASI loaders and the mods that run on
// them all go into the game's install folder, laid out as in the archive. The
// files only sit there while the game is in modded mode (lib/modeSwitch.js).

// Something at this level that only makes sense in the game's root folder.
function isRootLevel(entries) {
  return entries.some((e) =>
    e.isDirectory()
      ? /^(scripts|mods|lml)$/i.test(e.name)
      : /\.(asi|dll)$/i.test(e.name)
  );
}

// Walks through wrapper folders ("MyMod v1.2/...") and Script Hook's "bin"
// folder down to the level that belongs in the game root.
function findRoot(dir, depth = 0) {
  if (depth > 4) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  if (isRootLevel(entries)) return dir;
  const dirs = entries.filter((e) => e.isDirectory());
  const bin = dirs.find((d) => d.name.toLowerCase() === 'bin');
  if (bin) return findRoot(path.join(dir, bin.name), depth + 1);
  if (dirs.length === 1) return findRoot(path.join(dir, dirs[0].name), depth + 1);
  return null;
}

// Readmes, screenshots and installers ride along in most archives. Inside
// mods\ and lml\ everything is game data and is kept.
const DOC_EXTS = /\.(txt|md|pdf|url|png|jpe?g|gif|bmp|webp|html?|rtf|docx?)$/i;
function isLeftOut(relPath) {
  const top = relPath.split(path.sep)[0].toLowerCase();
  if (top === 'mods' || top === 'lml') return false;
  const name = path.basename(relPath).toLowerCase();
  // Script Hook V's args.txt has made the game refuse to start since mid-2025.
  if (name === 'args.txt') return true;
  return DOC_EXTS.test(name) || name.endsWith('.exe');
}

function walkFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, base, out);
    else out.push(path.relative(base, full));
  }
  return out;
}

async function prepare({ archivePath, stagingDir }) {
  const archiveName = path.basename(archivePath);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rockstar-prep-'));
  try {
    await extractArchive(archivePath, scratch);
    const all = walkFiles(scratch);

    if (all.some((f) => f.toLowerCase().endsWith('.oiv'))) {
      throw new Error(
        `"${archiveName}" is an OpenIV package (.oiv). Those are installed with OpenIV's Package ` +
          `Installer into the game's mods folder, which this app can't switch on and off. If you ` +
          `do install one by hand, the app will see the mods folder and block "Play online" until ` +
          `it's gone.`
      );
    }

    const root = findRoot(scratch);
    if (!root) {
      throw new Error(
        `"${archiveName}" doesn't look like a script mod: no .asi or .dll file and no scripts, ` +
          `mods or lml folder was found in it.`
      );
    }

    const files = walkFiles(root);
    let kept = 0;
    for (const rel of files) {
      if (isLeftOut(rel)) continue;
      const dest = path.join(stagingDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(path.join(root, rel), dest);
      kept += 1;
    }
    if (kept === 0) throw new Error(`"${archiveName}" has no mod files in it.`);
    return { skippedFiles: all.length - kept };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// Root-folder names that always mean mods — even ones already there when the
// clean snapshot was taken, e.g. Script Hook copied in by hand.
const MOD_MARKERS = [
  /\.asi$/i,
  /^(dinput8|scripthookv|scripthookrdr2|scripthookvdotnet\d*|version|dsound)\.dll$/i,
  /^(scripts|mods|lml|plugins)$/i,
];

function isModMarker(name) {
  return MOD_MARKERS.some((re) => re.test(name));
}

// What the game's root folder looks like clean: everything there now except
// anything that's obviously a mod. Taken when the game is added.
function takeSnapshot(installDir) {
  return fs.readdirSync(installDir).filter((name) => !isModMarker(name));
}

module.exports = {
  id: 'rockstar',
  prepare,
  isModMarker,
  takeSnapshot,
  // Files are only in the game folder in modded mode.
  switchable: true,
  hint: 'Script mods (Script Hook, .asi, scripts\\) — only in the game folder while modded mode is on.',
};
