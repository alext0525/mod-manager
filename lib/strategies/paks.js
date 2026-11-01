const fs = require('fs');
const path = require('path');
const os = require('os');

const { extractArchive } = require('../extractor');

// Unreal Engine games like Ready or Not load .pak files from their Paks folder;
// newer mods add a matching .ucas/.utoc pair that must sit beside the .pak.
// Everything else in a mod archive (readmes, preview images, wrapper folders)
// is left out, except side files the game's catalog entry knows a home for.
const PAK_EXTS = new Set(['.pak', '.ucas', '.utoc']);

// Subfolders of Paks that mean something to the game or a mod loader. A file
// found under one keeps that folder; any other folder is just a wrapper.
const KEPT_SUBFOLDERS = ['logicmods', '~mods'];

function walkFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, base, out);
    else out.push(path.relative(base, full));
  }
  return out;
}

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

function moveInto(srcFile, destFile, archiveName) {
  if (fs.existsSync(destFile)) {
    throw new Error(
      `"${archiveName}" has more than one file called "${path.basename(destFile)}" in different ` +
        `folders — usually alternative versions of the same mod. Unzip it, re-zip only the version ` +
        `you want, and drop that in.`
    );
  }
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.renameSync(srcFile, destFile);
}

// Stages game files under stagingDir/game and each kind of side file under
// stagingDir/side-<n>, and tells the installer where each of those goes.
async function prepare({ archivePath, stagingDir, sideFiles = [] }) {
  const archiveName = path.basename(archivePath);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'paks-prep-'));
  try {
    await extractArchive(archivePath, scratch);
    const files = walkFiles(scratch);

    const pakFiles = files.filter((f) => PAK_EXTS.has(path.extname(f).toLowerCase()));
    if (pakFiles.length === 0) {
      const shown = files.slice(0, 5).map((f) => path.basename(f)).join(', ');
      throw new Error(
        `"${archiveName}" has no .pak file in it, so it isn't a mod this game can load` +
          (shown ? ` (found: ${shown}).` : '.')
      );
    }

    for (const rel of pakFiles) {
      moveInto(path.join(scratch, rel), path.join(stagingDir, 'game', pakDestination(rel)), archiveName);
    }

    const placements = [{ from: 'game' }];
    let skipped = files.length - pakFiles.length;
    sideFiles.forEach((rule, n) => {
      const matches = files.filter((f) => rule.pattern.test(path.basename(f)));
      if (matches.length === 0) return;
      const from = `side-${n}`;
      for (const rel of matches) {
        moveInto(path.join(scratch, rel), path.join(stagingDir, from, path.basename(rel)), archiveName);
      }
      // Side files are extras: never overwrite one that's already there, and
      // never delete it on removal, since the game may have rebuilt it since.
      placements.push({ from, to: rule.dir(), label: rule.label, optional: true });
      skipped -= matches.length;
    });

    return { placements, skippedFiles: skipped };
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
