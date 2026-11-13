const fs = require('fs');

// The app's state files (games, mods, profiles). A write that's cut short —
// a crash or power loss mid-save — must not leave a half-written file, since
// the mod list is the only record of which game files the app put in place.
// So: write to a temp file, keep the previous good copy as .bak, then swap.

function readJson(file, fallback) {
  if (!fs.existsSync(file)) {
    return fs.existsSync(`${file}.bak`) ? JSON.parse(fs.readFileSync(`${file}.bak`, 'utf-8')) : fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    // Damaged: fall back to the last good copy rather than forgetting everything.
    if (fs.existsSync(`${file}.bak`)) return JSON.parse(fs.readFileSync(`${file}.bak`, 'utf-8'));
    throw new Error(`${file} is damaged and there's no backup copy of it (${err.message}).`);
  }
}

function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  try {
    // Only a file that still parses is worth keeping as the backup.
    JSON.parse(fs.readFileSync(file, 'utf-8'));
    fs.copyFileSync(file, `${file}.bak`);
  } catch {
    // no current file, or it's damaged — keep the existing .bak
  }
  fs.renameSync(tmp, file);
}

module.exports = { readJson, writeJson };
