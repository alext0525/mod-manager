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

// Dying Light: The Beast (Chrome Engine) loads mod paks from ph_ft\source, but
// only ones named data2.pak to data7.pak — data0.pak and data1.pak are the
// game's own. So each mod .pak is given the next free number, which also
// means at most six pak mods at once.
const FIRST_SLOT = 2;
const LAST_SLOT = 7;

async function prepare({ archivePath, stagingDir, takenNames = new Set(), variants: chosen }) {
  const archiveName = path.basename(archivePath);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-prep-'));
  try {
    await extractArchive(archivePath, scratch);
    await expandNestedArchives(scratch);
    const allFiles = walkFiles(scratch);
    const isPak = (f) => /\.pak$/i.test(f);

    const versions = findVariants(allFiles, isPak);
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
    const paks = files.filter(isPak).sort();
    if (paks.length === 0) {
      throw new Error(`"${archiveName}" has no .pak file in it, so it isn't a mod this game can load.`);
    }

    const notes = [];
    const assigned = new Set();
    for (const rel of paks) {
      let slot = FIRST_SLOT;
      while (slot <= LAST_SLOT && (takenNames.has(`data${slot}.pak`) || assigned.has(slot))) slot += 1;
      if (slot > LAST_SLOT) {
        throw new Error(
          `All six mod slots (data${FIRST_SLOT}.pak to data${LAST_SLOT}.pak) are in use, and the game ` +
            `doesn't load any more than that. Take a mod out, or combine mods into one pak with the ` +
            `community's Mod Merge Utility.`
        );
      }
      assigned.add(slot);
      const name = `data${slot}.pak`;
      moveInto(path.join(scratch, rel), path.join(stagingDir, name), archiveName);
      if (path.basename(rel).toLowerCase() !== name) {
        notes.push(`${path.basename(rel)} is installed as ${name} — the game only loads paks with those names.`);
      }
    }
    if (paks.length > 1) {
      notes.push('When two paks change the same thing, the higher-numbered one wins.');
    }

    const skipped = files.filter((f) => !paks.includes(f));
    return {
      skipped,
      skippedFiles: skipped.length,
      kind: `.pak mod (${[...assigned].map((s) => `data${s}`).join(', ')})`,
      notes,
      variants: variantInfo || undefined,
    };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

module.exports = {
  id: 'chromepaks',
  prepare,
  rootLabel: 'ph_ft\\source',
  hint: 'Mod .pak files go into ph_ft\\source as data2.pak to data7.pak (the only names the game loads).',
};
