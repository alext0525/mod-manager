const { extractArchive } = require('../extractor');

// Ready or Not style: the game reads loose files out of its Paks folder, so the
// archive is fully extracted and its contents are what gets installed.
async function prepare({ archivePath, stagingDir }) {
  await extractArchive(archivePath, stagingDir);
}

module.exports = {
  id: 'paks',
  prepare,
  // Shown in the UI under the drop zone.
  hint: 'Mods are extracted and their files copied into the game\'s Paks folder.',
};
