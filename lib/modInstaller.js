const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const gameStore = require('./gameStore');
const modStore = require('./modStore');
const gameDetect = require('./gameDetect');
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

function listFiles(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, base, out);
    else out.push(path.relative(base, full));
  }
  return out;
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

// Where a mod's files go: each placement copies unzipped/<from>/ into `to`
// (the game's mods folder when `to` is unset). Mods installed before
// placements existed have a single one covering all of unzipped/.
function placementsOf(mod) {
  const placements = mod.placements || [{ from: '', files: mod.installedFiles || [] }];
  return placements.map((p) => ({ ...p, to: p.to || mod.targetDir }));
}

// Every game file an active mod has put in place, mapped to that mod's name.
// Optional side files aren't owned by anyone (see strategies/paks.js).
function claimedFiles(exceptModId) {
  const claimed = new Map();
  for (const mod of modStore.loadMods()) {
    if (mod.id === exceptModId || mod.active === false) continue;
    for (const p of placementsOf(mod)) {
      if (p.optional) continue;
      for (const rel of p.files || []) claimed.set(path.join(p.to, rel).toLowerCase(), mod.name);
    }
  }
  return claimed;
}

// Refuses before anything is copied, so a mod can never silently replace
// another mod's file — or one the app didn't put there.
function assertNoConflicts(modId, modName, plan) {
  const claimed = claimedFiles(modId);
  for (const p of plan) {
    if (p.optional) continue;
    for (const rel of p.files) {
      const dest = path.join(p.to, rel);
      const owner = claimed.get(dest.toLowerCase());
      if (owner) {
        throw new Error(
          `"${modName}" and "${owner}" both contain ${path.basename(rel)}, so only one of them can be ` +
            `in the game at a time. Deactivate "${owner}" first.`
        );
      }
      if (fs.existsSync(dest)) {
        throw new Error(
          `${path.basename(rel)} is already in ${p.to}, but this app didn't put it there (it may have ` +
            `been installed by hand). Delete it from that folder first, then add the mod here.`
        );
      }
    }
  }
}

function buildPlan(stagingRoot, placements, targetDir) {
  return placements.map((p) => {
    const srcDir = path.join(stagingRoot, p.from);
    return { ...p, to: p.to || targetDir, srcDir, files: listFiles(srcDir) };
  });
}

// Copies the plan's files and returns placements ready to store on the mod
// record, each listing what it actually put down.
function copyPlan(plan, targetDir) {
  return plan.map(({ srcDir, files, ...p }) => {
    const copied = [];
    for (const rel of files) {
      const dest = path.join(p.to, rel);
      if (p.optional && fs.existsSync(dest)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(srcDir, rel), dest);
      copied.push(rel);
    }
    return { ...p, to: p.to === targetDir ? undefined : p.to, files: copied };
  });
}

async function installMod({ gameId, zipPath, customTargetDir }) {
  const game = gameStore.getGame(gameId);
  const targetDir = customTargetDir || game.modsPath;
  const strategy = getStrategy(game.strategy);
  const known = gameDetect.knownGameFor(game);

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

  // Checked before copying anything — mod archives can be several GB.
  const existing = modStore.loadMods().find((m) => m.gameId === gameId && m.name === baseName);
  if (existing) {
    throw new Error(
      `"${baseName}" is already added` +
        (existing.active === false ? ' (it\'s deactivated — use Activate instead).' : '.')
    );
  }

  // 1. Copy the original archive into this game's zips/ folder
  fs.mkdirSync(game.zipsPath, { recursive: true });
  fs.mkdirSync(game.unzippedPath, { recursive: true });
  const storedZipPath = uniquePath(game.zipsPath, baseName, ext);
  fs.copyFileSync(zipPath, storedZipPath);
  const modName = path.basename(storedZipPath, ext);

  // 2. Let the game's strategy turn the archive into whatever the game actually
  //    wants installed — .pak files for Ready or Not, a game-ready .zip for
  //    BeamNG. Either way the result lands in unzipped/<modName>/.
  const unzippedDir = uniquePath(game.unzippedPath, modName);
  fs.mkdirSync(unzippedDir, { recursive: true });
  const discard = () => {
    // Nothing reached the game folder, so don't leave half-made copies behind.
    fs.rmSync(unzippedDir, { recursive: true, force: true });
    fs.rmSync(storedZipPath, { force: true });
  };

  const modId = crypto.randomUUID();
  let mod;
  try {
    const prepared =
      (await strategy.prepare({
        archivePath: storedZipPath,
        stagingDir: unzippedDir,
        modName,
        sideFiles: (known && known.sideFiles) || [],
      })) || {};

    const plan = buildPlan(unzippedDir, prepared.placements || [{ from: '' }], targetDir);
    if (plan.every((p) => p.optional || p.files.length === 0)) {
      throw new Error(`"${path.basename(zipPath)}" appears to be empty — nothing was installed.`);
    }
    assertNoConflicts(modId, modName, plan);

    // 3. Copy the prepared content into the game's folders
    mod = {
      id: modId,
      gameId,
      name: modName,
      zipPath: storedZipPath,
      unzippedPath: unzippedDir,
      targetDir,
      placements: copyPlan(plan, targetDir),
      skippedFiles: prepared.skippedFiles || 0,
      installedOnBuild: gameDetect.currentBuildId(game),
      active: true,
      installedAt: new Date().toISOString(),
    };
  } catch (err) {
    discard();
    throw err;
  }

  modStore.addMod(mod);
  return mod;
}

// Deletes a mod's files out of the game folder, leaving the managed
// copies in zips/ and unzipped/ untouched.
function removeFilesFromGame(mod) {
  const stillClaimed = claimedFiles(mod.id);
  for (const p of placementsOf(mod)) {
    if (p.optional) continue;
    for (const rel of p.files || []) {
      const filePath = path.join(p.to, rel);
      // Mods installed before conflict checks could share a file — leave it
      // for the other mod.
      if (stillClaimed.has(filePath.toLowerCase())) continue;
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        removeEmptyDirsUpTo(path.dirname(filePath), p.to);
      }
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
  const game = gameStore.getGame(mod.gameId);
  assertGameClosed(game);

  if (!fs.existsSync(mod.unzippedPath)) {
    throw new Error(`The stored files for "${mod.name}" are missing. Re-add the mod file.`);
  }
  if (!fs.existsSync(mod.targetDir)) {
    throw new Error(`Game folder not found: ${mod.targetDir}`);
  }

  const plan = buildPlan(mod.unzippedPath, mod.placements || [{ from: '' }], mod.targetDir);
  assertNoConflicts(mod.id, mod.name, plan);
  return modStore.updateMod(modId, {
    active: true,
    placements: copyPlan(plan, mod.targetDir),
    installedFiles: undefined,
    installedOnBuild: gameDetect.currentBuildId(game),
  });
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

// Puts exactly `modIds` in the game: everything else is deactivated first, so
// switching between profiles never trips the conflict check on its own mods.
function applyProfile({ gameId, modIds }) {
  assertGameClosed(gameStore.getGame(gameId));
  const wanted = new Set(modIds);
  const mods = modStore.loadMods().filter((m) => m.gameId === gameId);
  const errors = [];

  for (const m of mods) {
    if (m.active === false || wanted.has(m.id)) continue;
    try {
      deactivateMod(m.id);
    } catch (err) {
      errors.push(`${m.name}: ${err.message}`);
    }
  }
  for (const m of mods) {
    if (m.active !== false || !wanted.has(m.id)) continue;
    try {
      activateMod(m.id);
    } catch (err) {
      errors.push(`${m.name}: ${err.message}`);
    }
  }
  return { errors };
}

module.exports = { installMod, removeMod, activateMod, deactivateMod, applyProfile };
