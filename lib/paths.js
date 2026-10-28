const path = require('path');

// Where the app keeps its JSON state and each game's zips/ + unzipped/ folders.
// Running from source this is the repo's parent folder (the original layout).
// A packaged build can't write next to its own files, so main.js points
// MOD_MANAGER_HOME somewhere writable before anything else loads.
const HOME = process.env.MOD_MANAGER_HOME || path.join(__dirname, '..', '..');
const DATA_DIR = process.env.MOD_MANAGER_HOME
  ? path.join(HOME, 'data')
  : path.join(__dirname, '..', 'data');

module.exports = { HOME, DATA_DIR };
