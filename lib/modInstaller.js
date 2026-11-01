const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const gameStore = require('./gameStore');
const modStore = require('./modStore');
const { isSupportedArchive, SUPPORTED_EXTENSIONS } = require('./extractor');
const { getStrategy } = require('./strategies');
const { isProcessRunning } = require('./gameRunning');

function assertGameClosed(game) {
  const strategy = getStrategy(game.strategy);
  if (strategy.requiresGameClosed && isProcessRunning(strategy.requiresGameClosed)) {
    throw new Error(
      `${game.name} is running. Close the game first — changing mod files while it's ` +
        `open can leave its mod list out of sync.`
    );
  }
}

function uniquePath(dir, name, ext = '') {
  let candidate = path.join(dir, name + ext);
  let n = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${name} (${n})${ext}`);
    n += 1;
  }
  return candidate;
}

function copyRecursive(src, dest, baseSrc, collected) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyRecursive(srcPath, destPath, baseSrc, collected);
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
      collected.push(path.relative(baseSrc, srcPath));
    }
  }
}

function removeEmptyDirsUpTo(dir, stopAt) {
  let current = dir;
  while (current.startsWith(stopAt) && current !== stopAt) {
    if (!fs.existsSync(current)) {
      current = path.dirname(current);
      continue;
    }
    const remaining = fs.readdirSync(current);
    if (remaining.length > 0) break;
    fs.rmdirSync(current);
    current = path.dirname(current);
  }
}

async function installMod({ gameId, zipPath, customTargetDir }) {
  const game = gameStore.getGame(gameId);
  const targetDir = customTargetDir || game.modsPath;
  const strategy = getStrategy(game.strategy);

  if (!fs.existsSync(zipPath)) throw new Error(`File not found: ${zipPath}`);
  if (!isSupportedArchive(zipPath)) {
    throw new Error(
      `"${path.basename(zipPath)}" is not a supported archive. Supported types: ${SUPPORTED_EXTENSIONS.join(', ')}`
    );
  }
  if (!fs.existsSync(targetDir)) throw new Error(`Target folder not found: ${targetDir}`);
  assertGameClosed(game);

  const ext = path.extname(zipPath).toLowerCase();
  const baseName = path.basename(zipPath, ext);

  // 1. Copy the original archive into this game's zips/ folder
  fs.mkdirSync(game.zipsPath, { recursive: true });
  fs.mkdirSync(game.unzippedPath, { recursive: true });
  const storedZipPath = uniquePath(game.zipsPath, baseName, ext);
  fs.copyFileSync(zipPath, storedZipPath);
  const modName = path.basename(storedZipPath, ext);

  // 2. Let the game's strategy turn the archive into whatever the game actually
  //    wants installed — extracted files for Ready or Not, a game-ready .zip for
  //    BeamNG. Either way the result lands in unzipped/<modName>/.
  const unzippedDir = uniquePath(game.unzippedPath, modName);
  fs.mkdirSync(unzippedDir, { recursive: true });
  try {
    await strategy.prepare({ archivePath: storedZipPath, stagingDir: unzippedDir, modName });
  } catch (err) {
    // Nothing reached the game folder, so don't leave half-made copies behind.
    fs.rmSync(unzippedDir, { recursive: true, force: true });
    fs.rmSync(storedZipPath, { force: true });
    throw err;
  }

  // 3. Copy the prepared content into the game's mods folder
  const installedFiles = [];
  copyRecursive(unzippedDir, targetDir, unzippedDir, installedFiles);

  if (installedFiles.length === 0) {
    fs.rmSync(unzippedDir, { recursive: true, force: true });
    fs.rmSync(storedZipPath, { force: true });
    throw new Error(`"${path.basename(zipPath)}" appears to be empty — nothing was installed.`);
  }

  const mod = {
    id: crypto.randomUUID(),
    gameId,
    name: modName,
    zipPath: storedZipPath,
    unzippedPath: unzippedDir,
    targetDir,
    installedFiles,
    active: true,
    installedAt: new Date().toISOString(),
  };
  modStore.addMod(mod);
  return mod;
}

// Deletes a mod's files out of the game folder, leaving the managed
// copies in zips/ and unzipped/ untouched.
function removeFilesFromGame(mod) {
  for (const relFile of mod.installedFiles) {
    const filePath = path.join(mod.targetDir, relFile);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      removeEmptyDirsUpTo(path.dirname(filePath), mod.targetDir);
    }
  }
}

function deactivateMod(modId) {
  const mod = modStore.getMod(modId);
  if (!mod.active) return mod;
  assertGameClosed(gameStore.getGame(mod.gameId));
  removeFilesFromGame(mod);
  return modStore.updateMod(modId, { active: false });
}

function activateMod(modId) {
  const mod = modStore.getMod(modId);
  if (mod.active) return mod;
  assertGameClosed(gameStore.getGame(mod.gameId));

  if (!fs.existsSync(mod.unzippedPath)) {
    throw new Error(`The stored files for "${mod.name}" are missing. Re-add the mod file.`);
  }
  if (!fs.existsSync(mod.targetDir)) {
    throw new Error(`Game folder not found: ${mod.targetDir}`);
  }

  const installedFiles = [];
  copyRecursive(mod.unzippedPath, mod.targetDir, mod.unzippedPath, installedFiles);
  return modStore.updateMod(modId, { active: true, installedFiles });
}

// Removes a mod everywhere: out of the game folder, and out of the app's own
// zips/ and unzipped/ folders. `trash` (supplied by the main process) sends the
// managed copies to the Recycle Bin so a mistaken removal stays recoverable.
async function removeMod({ modId, trash }) {
  const mod = modStore.getMod(modId);
  assertGameClosed(gameStore.getGame(mod.gameId));

  removeFilesFromGame(mod);

  for (const managedPath of [mod.zipPath, mod.unzippedPath]) {
    if (!fs.existsSync(managedPath)) continue;
    if (trash) {
      await trash(managedPath);
    } else {
      fs.rmSync(managedPath, { recursive: true, force: true });
    }
  }

  modStore.removeMod(modId);
  return mod;
}

module.exports = { installMod, removeMod, activateMod, deactivateMod };
