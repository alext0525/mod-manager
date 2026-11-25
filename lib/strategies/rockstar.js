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
      ? /^(scripts|mods|lml|plugins)$/i.test(e.name)
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

// Lenny's Mod Loader (RDR2) asset mods: a folder holding install.xml, or
// stream\ / replace\ folders. Each goes into the game's lml\<folder name>.
// Returns those folders relative to the archive root ('.' for the root).
function findLmlMods(files) {
  const dirs = new Set();
  for (const f of files) {
    const parts = f.split(path.sep);
    const lower = parts.map((p) => p.toLowerCase());
    if (lower[lower.length - 1] === 'install.xml') {
      dirs.add(parts.slice(0, -1).join(path.sep) || '.');
      continue;
    }
    const i = lower.findIndex((p, n) => n < lower.length - 1 && (p === 'stream' || p === 'replace'));
    if (i !== -1) dirs.add(parts.slice(0, i).join(path.sep) || '.');
  }
  // A folder inside another LML mod folder belongs to that mod.
  const list = [...dirs].sort((a, b) => a.length - b.length);
  return list.filter((d) => !list.some((o) => o !== d && (o === '.' || d.startsWith(o + path.sep))));
}

// What a game-root-level set of files is, for the install preview.
function describeRoot(files) {
  const names = files.map((f) => f.toLowerCase().split(path.sep));
  const kinds = [];
  if (names.some((p) => p[p.length - 1] === 'scripthookv.dll')) kinds.push('Script Hook V');
  if (names.some((p) => p[p.length - 1] === 'scripthookrdr2.dll')) kinds.push('Script Hook RDR2');
  if (names.some((p) => p.length === 1 && p[0].endsWith('.asi'))) kinds.push('ASI plugin');
  if (names.some((p) => p[0] === 'scripts' && p.length > 1)) kinds.push('script mod (scripts\\)');
  if (names.some((p) => p[0] === 'plugins' && p.length > 1)) kinds.push('plugin mod (plugins\\)');
  if (names.some((p) => p[0] === 'lml' && p.length > 1)) kinds.push('Lenny\'s Mod Loader files');
  if (names.some((p) => p[0] === 'mods' && p.length > 1)) kinds.push('mods folder (asset replacements)');
  return kinds.length ? kinds.join(' + ') : 'game folder files';
}

async function prepare({ archivePath, stagingDir, lml = false }) {
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

    if (all.some((f) => f.toLowerCase().endsWith('.rpf'))) {
      throw new Error(
        `"${archiveName}" contains .rpf game archives (such as a DLC pack or vehicle replacement). ` +
          `These cannot be installed by dropping them into the game folder — they must be installed with ` +
          `OpenIV into the game's mods folder or via an OpenIV package (.oiv), and usually require updating dlclist.xml.`
      );
    }

    const root = findRoot(scratch);
    const notes = [];

    // Not laid out like the game folder: maybe a Lenny's Mod Loader mod or loose script mod.
    if (!root) {
      const lmlMods = lml ? findLmlMods(all) : [];
      if (lmlMods.length > 0) {
        const used = new Set();
        for (const dir of lmlMods) {
          const name = dir === '.' ? path.basename(archivePath, path.extname(archivePath)) : path.basename(dir);
          for (const rel of all) {
            if (dir !== '.' && !rel.startsWith(dir + path.sep)) continue;
            const inner = dir === '.' ? rel : rel.slice(dir.length + 1);
            if (isLeftOut(inner) && !inner.includes(path.sep)) continue;
            const dest = path.join(stagingDir, 'lml', name, inner);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.renameSync(path.join(scratch, rel), dest);
            used.add(rel);
          }
        }
        notes.push('Lenny\'s Mod Loader mods only load with Lenny\'s Mod Loader, Script Hook and an ASI loader installed.');
        const skipped = all.filter((f) => !used.has(f));
        return {
          skipped,
          skippedFiles: skipped.length,
          kind: `Lenny's Mod Loader mod${lmlMods.length > 1 ? 's' : ''}`,
          notes,
        };
      }

      // Check for loose scripts (.cs, .vb, .lua)
      const scriptFiles = all.filter((f) => /\.(cs|vb|lua)$/i.test(f));
      if (scriptFiles.length > 0) {
        const kept = [];
        const skipped = [];
        for (const rel of all) {
          if (isLeftOut(rel)) {
            skipped.push(rel);
            continue;
          }
          const dest = path.join(stagingDir, 'scripts', path.basename(rel));
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.renameSync(path.join(scratch, rel), dest);
          kept.push(path.join('scripts', path.basename(rel)));
        }
        notes.push('Script mod files placed in scripts\\ folder. Requires Script Hook V .NET (for .cs/.vb) or a Lua loader (for .lua).');
        return { skipped, skippedFiles: skipped.length, kind: 'script mod (scripts\\)', notes };
      }

      throw new Error(
        `"${archiveName}" doesn't look like a mod the app can place: no .asi or .dll file, no ` +
          `scripts, mods, lml or plugins folder` +
          (lml ? ', and no Lenny\'s Mod Loader folder (install.xml, stream or replace).' : '.')
      );
    }

    const files = walkFiles(root);
    const kept = [];
    const skipped = all.filter((f) => !path.join(scratch, f).startsWith(root + path.sep));
    for (const rel of files) {
      if (isLeftOut(rel)) {
        skipped.push(rel);
        continue;
      }
      const dest = path.join(stagingDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(path.join(root, rel), dest);
      kept.push(rel);
    }
    if (kept.length === 0) throw new Error(`"${archiveName}" has no mod files in it.`);
    if (kept.some((f) => f.toLowerCase().startsWith('mods' + path.sep))) {
      notes.push('Files in the mods folder only load with OpenIV.asi and an ASI loader installed.');
    }
    return { skipped, skippedFiles: skipped.length, kind: describeRoot(kept), notes };
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
  rootLabel: 'Game folder',
  hint: 'Script mods (Script Hook, .asi, scripts\\) — only in the game folder while modded mode is on.',
};
