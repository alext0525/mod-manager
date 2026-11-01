const { extractArchive } = require('../extractor');

// For games the app doesn't know: the archive is fully extracted and all of
// its contents are copied into the mods folder as they are.
async function prepare({ archivePath, stagingDir }) {
  await extractArchive(archivePath, stagingDir);
}

module.exports = {
  id: 'loose',
  prepare,
  hint: 'Mods are extracted and all their files copied into the mods folder.',
};
