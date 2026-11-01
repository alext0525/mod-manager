const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Steam records where it's installed in the registry. Its libraryfolders.vdf
// then lists every library (e.g. D:\SteamLibrary), and each installed game has
// an appmanifest_<appid>.acf in its library saying which folder it's in and
// which build is installed.

const REGISTRY_LOCATIONS = [
  ['HKCU\\Software\\Valve\\Steam', 'SteamPath'],
  ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
  ['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'],
];

let cachedRoot;

function findSteamRoot() {
  if (cachedRoot !== undefined) return cachedRoot;
  cachedRoot = null;
  if (process.platform !== 'win32') return cachedRoot;

  for (const [key, value] of REGISTRY_LOCATIONS) {
    try {
      const out = execFileSync('reg', ['query', key, '/v', value], {
        encoding: 'utf-8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const match = out.match(/REG_SZ\s+(.+)/);
      if (match) {
        const root = path.normalize(match[1].trim());
        if (fs.existsSync(root)) return (cachedRoot = root);
      }
    } catch {
      // key not present — try the next one
    }
  }
  const fallback = 'C:\\Program Files (x86)\\Steam';
  if (fs.existsSync(fallback)) cachedRoot = fallback;
  return cachedRoot;
}

// Steam's .vdf/.acf files are nested "key" "value" pairs. Only flat values are
// needed here, so a pair-matching regex is enough.
function readPairs(file) {
  const text = fs.readFileSync(file, 'utf-8');
  const pairs = [];
  for (const m of text.matchAll(/"([^"]+)"\s+"((?:[^"\\]|\\.)*)"/g)) {
    pairs.push([m[1], m[2].replace(/\\\\/g, '\\')]);
  }
  return pairs;
}

function libraryFolders() {
  const root = findSteamRoot();
  if (!root) return [];
  const folders = [root];
  const vdf = path.join(root, 'steamapps', 'libraryfolders.vdf');
  if (fs.existsSync(vdf)) {
    for (const [key, value] of readPairs(vdf)) {
      if (key.toLowerCase() === 'path') folders.push(path.normalize(value));
    }
  }
  const seen = new Set();
  return folders.filter((f) => {
    const k = f.toLowerCase();
    if (seen.has(k) || !fs.existsSync(f)) return false;
    seen.add(k);
    return true;
  });
}

// Returns { installDir, buildId } for an installed Steam game, or null.
function findApp(appId) {
  for (const lib of libraryFolders()) {
    const manifest = path.join(lib, 'steamapps', `appmanifest_${appId}.acf`);
    if (!fs.existsSync(manifest)) continue;
    const fields = Object.fromEntries(readPairs(manifest).map(([k, v]) => [k.toLowerCase(), v]));
    if (!fields.installdir) continue;
    const installDir = path.join(lib, 'steamapps', 'common', fields.installdir);
    if (!fs.existsSync(installDir)) continue;
    return { installDir, buildId: fields.buildid || null };
  }
  return null;
}

module.exports = { findSteamRoot, libraryFolders, findApp };
