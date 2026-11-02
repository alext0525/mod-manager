const fs = require('fs');
const path = require('path');
const os = require('os');

const { extractArchive } = require('../extractor');
const { walkFiles, walkDirs, moveInto, isDoc, expandNestedArchives, isUnder } = require('./files');

// The Witcher 3 reads mods from <game>\mods: each mod is a folder whose name
// starts with "mod" and holds a content\ folder. DLC-style mods are folders
// starting with "dlc" in <game>\dlc. Some mods also ship bin\ files (menu and
// config XML) that merge into <game>\bin.

function hasContent(dir, files) {
  const prefix = path.join(dir, 'content').toLowerCase() + path.sep;
  return files.some((f) => f.toLowerCase().startsWith(prefix));
}

// Outermost folders matching `test`, so a mod folder inside another is part of it.
function outermost(dirs) {
  return dirs.filter((d) => !dirs.some((o) => o !== d && isUnder(o, d)));
}

async function prepare({ archivePath, stagingDir }) {
  const archiveName = path.basename(archivePath);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'w3-prep-'));
  try {
    await extractArchive(archivePath, scratch);
    await expandNestedArchives(scratch);
    const files = walkFiles(scratch);
    const dirs = walkDirs(scratch);

    const modDirs = outermost(dirs.filter((d) => /^mod/i.test(path.basename(d)) && hasContent(d, files)));
    const dlcDirs = outermost(
      dirs.filter((d) => /^dlc/i.test(path.basename(d)) && hasContent(d, files) && !modDirs.some((m) => isUnder(m, d)))
    );
    const binDirs = outermost(
      dirs.filter(
        (d) => path.basename(d).toLowerCase() === 'bin' && ![...modDirs, ...dlcDirs].some((m) => isUnder(m, d))
      )
    );
    if (!modDirs.length && !dlcDirs.length && !binDirs.length) {
      throw new Error(
        `"${archiveName}" doesn't look like a Witcher 3 mod: no folder starting with "mod" or "dlc" ` +
          `that holds a content folder, and no bin folder.`
      );
    }

    const used = new Set();
    const stage = (dir, destRoot) => {
      for (const rel of files.filter((f) => isUnder(dir, f))) {
        const inner = rel.slice(dir.length + 1);
        // Readmes at a mod's top level aren't game files.
        if (!inner.includes(path.sep) && isDoc(inner)) continue;
        moveInto(path.join(scratch, rel), path.join(stagingDir, destRoot, inner), archiveName);
        used.add(rel);
      }
    };
    for (const d of modDirs) stage(d, path.join('mods', path.basename(d)));
    for (const d of dlcDirs) stage(d, path.join('dlc', path.basename(d)));
    for (const d of binDirs) stage(d, 'bin');

    const kinds = [];
    if (modDirs.length) kinds.push(modDirs.length === 1 ? 'mod' : `${modDirs.length} mods`);
    if (dlcDirs.length) kinds.push('DLC-style mod');
    if (binDirs.length) kinds.push('menu/config files (bin)');

    const notes = [];
    if ([...used].some((f) => /[\\/]content[\\/]scripts[\\/].+\.ws$/i.test(f))) {
      notes.push(
        'This mod changes game scripts. If another script mod changes the same script, the game ' +
          'won\'t start until they\'re combined with Script Merger.'
      );
    }
    if (binDirs.length) {
      notes.push('Menu/config XML files in bin\\ only show up in-game if the mod\'s menu entry is set up as its readme says.');
    }

    const skipped = files.filter((f) => !used.has(f));
    return { skipped, skippedFiles: skipped.length, kind: `Witcher 3 ${kinds.join(' + ')}`, notes };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

module.exports = {
  id: 'witcher3',
  prepare,
  rootLabel: 'Game folder',
  hint: 'mod… folders go into mods\\, dlc… folders into dlc\\, bin\\ files into bin\\.',
};
