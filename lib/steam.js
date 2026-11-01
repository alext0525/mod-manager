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

// { appId, name, installDir, buildId } from one appmanifest, or null when the
// game's folder isn't actually there (half-uninstalled, moved by hand...).
function readApp(lib, manifestFile) {
  let fields;
  try {
    fields = Object.fromEntries(readPairs(manifestFile).map(([k, v]) => [k.toLowerCase(), v]));
  } catch {
    return null;
  }
  if (!fields.installdir) return null;
  const installDir = path.join(lib, 'steamapps', 'common', fields.installdir);
  if (!fs.existsSync(installDir)) return null;
  return {
    appId: fields.appid,
    name: fields.name || fields.installdir,
    installDir,
    buildId: fields.buildid || null,
  };
}

// Returns { appId, name, installDir, buildId } for an installed Steam game, or null.
function findApp(appId) {
  for (const lib of libraryFolders()) {
    const manifest = path.join(lib, 'steamapps', `appmanifest_${appId}.acf`);
    if (!fs.existsSync(manifest)) continue;
    const app = readApp(lib, manifest);
    if (app) return app;
  }
  return null;
}

// Every game installed in any Steam library on this PC.
function listInstalledApps() {
  const apps = [];
  for (const lib of libraryFolders()) {
    const steamapps = path.join(lib, 'steamapps');
    let files;
    try {
      files = fs.readdirSync(steamapps);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!/^appmanifest_\d+\.acf$/i.test(file)) continue;
      const app = readApp(lib, path.join(steamapps, file));
      if (app) apps.push(app);
    }
  }
  return apps;
}

module.exports = { findSteamRoot, libraryFolders, findApp, listInstalledApps };
