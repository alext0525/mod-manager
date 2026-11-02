const fs = require('fs');
const path = require('path');
const os = require('os');

const { extractArchive } = require('../extractor');
const { walkFiles, moveInto, expandNestedArchives } = require('./files');

// Assetto Corsa EVO: car mods are single .kspkg packages that go in
// Saved Games\ACE\mods. Track mods are folders the game doesn't pick up from
// there, so they're refused rather than copied somewhere useless.

async function prepare({ archivePath, stagingDir }) {
  const archiveName = path.basename(archivePath);
  if (path.extname(archivePath).toLowerCase() === '.kspkg') {
    fs.copyFileSync(archivePath, path.join(stagingDir, path.basename(archivePath)));
    return { kind: 'AC EVO car package', skippedFiles: 0 };
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-prep-'));
  try {
    await extractArchive(archivePath, scratch);
    await expandNestedArchives(scratch);
    const files = walkFiles(scratch);
    const packages = files.filter((f) => /\.kspkg$/i.test(f));
    // An EVO track is a folder with a <name>.track file (plus .scene files and
    // containers\, static_mesh\, textures\...). The game doesn't pick tracks up
    // from the mods folder, and the extra steps it needs aren't documented, so
    // copying it anywhere would only look installed.
    const track = files.find((f) => /\.track$/i.test(f));
    if (packages.length === 0 && track) {
      const name = path.basename(track, path.extname(track));
      throw new Error(
        `"${archiveName}" is an Assetto Corsa EVO track ("${name}"). EVO doesn't load tracks from its ` +
          `mods folder, and the extra steps a track needs aren't documented anywhere the app can rely ` +
          `on, so it won't copy it somewhere it wouldn't show up. Install this one with EvoForge ` +
          `(evoforge.fr), which handles EVO tracks.`
      );
    }
    if (packages.length === 0) {
      const looksLikeAc1 = files.some((f) => /\.kn5$/i.test(f) || /(^|[\\/])data\.acd$/i.test(f));
      throw new Error(
        looksLikeAc1
          ? `"${archiveName}" is an original Assetto Corsa mod (.kn5 / data.acd). Those don't work in ` +
              `AC EVO — add it to Assetto Corsa instead.`
          : `"${archiveName}" has no .kspkg car package in it. AC EVO only loads car mods packaged as ` +
              `.kspkg; track mods aren't installed by copying files yet.`
      );
    }
    for (const rel of packages) {
      moveInto(path.join(scratch, rel), path.join(stagingDir, path.basename(rel)), archiveName);
    }
    const skipped = files.filter((f) => !packages.includes(f));
    return {
      skipped,
      skippedFiles: skipped.length,
      kind: packages.length === 1 ? 'AC EVO car package' : `${packages.length} AC EVO car packages`,
      notes: ['AC EVO reads car mods when it starts, so restart the game if it\'s open.'],
    };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

module.exports = {
  id: 'kspkg',
  prepare,
  rootLabel: 'AC EVO mods folder',
  // A bare .kspkg can be dropped as it is, not only inside an archive.
  acceptsFiles: ['.kspkg'],
  hint: 'Car mods (.kspkg) go into Saved Games\\ACE\\mods.',
};
