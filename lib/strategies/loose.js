const { extractArchive } = require('../extractor');

// For games the app doesn't know: the archive is fully extracted and all of
// its contents are copied into the mods folder as they are.
async function prepare({ archivePath, stagingDir }) {
  await extractArchive(archivePath, stagingDir);
  return {
    kind: 'Copied as-is',
    notes: [
      'The app doesn\'t know this game, so it can\'t check where these files belong. Compare the ' +
        'list below with the mod\'s install instructions before installing.',
    ],
  };
}

module.exports = {
  id: 'loose',
  prepare,
  hint: 'Mods are extracted and all their files copied into the mods folder.',
};
