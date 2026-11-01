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
  const known = gameDetect.knownGameFor(game);
  const processes = (known && known.processes) || [strategy.requiresGameClosed].filter(Boolean);
  if (processes.some(isProcessRunning)) {
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

// Games whose mods only sit in the game folder in modded mode (GTA V, RDR2).
function isSwitchable(game) {
  return Boolean(getStrategy(game.strategy).switchable);
}

// Mods of a switchable game are "in the modded set" (enabled) separately from
// having their files in the game folder (active).
function deployedNow(game) {
  return !isSwitchable(game) || game.mode === 'modded';
}

// Every game file a mod claims, mapped to that mod's name: what an active mod
// has put in place, and for switchable games everything an enabled mod would
// put in place in modded mode. Optional side files aren't owned by anyone
// (see strategies/paks.js).
function claimedFiles(exceptModId) {
  const switchableIds = new Set(gameStore.loadGames().filter(isSwitchable).map((g) => g.id));
  const claimed = new Map();
  for (const mod of modStore.loadMods()) {
    if (mod.id === exceptModId) continue;
    const staged = switchableIds.has(mod.gameId);
    if (staged ? mod.enabled === false : mod.active === false) continue;
    for (const p of placementsOf(mod)) {
      if (p.optional) continue;
      const files = staged ? listFiles(path.join(mod.unzippedPath, p.from || '')) : p.files || [];
      for (const rel of files) claimed.set(path.join(p.to, rel).toLowerCase(), mod.name);
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
            `in the game at a time. Take "${owner}" out first.`
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

// Mods unpacked and checked but not yet in the game, keyed by stage id. An
// install is two steps so the user can see exactly what will go where first.
const staged = new Map();

// What the install preview shows: the detected kind, each destination with
// its files, and everything left out of the archive.
function summarize(stageId, entry) {
  const { mod, plan, targetDir, deploy, prepared } = entry;
  return {
    stageId,
    name: mod.name,
    kind: prepared.kind || '',
    notes: [
      ...(prepared.notes || []),
      ...(deploy ? [] : ['Kept in the app until you press Play modded — the game folder stays clean.']),
    ],
    destinations: plan
      .filter((p) => p.files.length)
      .map((p) => ({
        label: p.label || (p.to === targetDir ? entry.rootLabel : 'Folder'),
        dir: p.to,
        files: p.files,
        optional: Boolean(p.optional),
      })),
    skipped: prepared.skipped || [],
    skippedCount: prepared.skippedFiles || 0,
  };
}

// Step 1: copy the archive into the app, unpack and sort it, and check it
// against the other mods. Nothing touches the game folder.
async function stageMod({ gameId, zipPath, customTargetDir }) {
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
        (isWanted(existing) ? '.' : ' (it\'s switched off — turn it back on instead).')
    );
  }
  if ([...staged.values()].some((s) => s.mod.gameId === gameId && s.mod.name === baseName)) {
    throw new Error(`"${baseName}" is already waiting to be installed.`);
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
  try {
    const prepared =
      (await strategy.prepare({
        archivePath: storedZipPath,
        stagingDir: unzippedDir,
        modName,
        sideFiles: (known && known.sideFiles) || [],
        ue4ssBinaries: known && known.ue4ssBinaries ? known.ue4ssBinaries(game.modsPath) : null,
        lml: Boolean(known && known.lml),
      })) || {};

    const plan = buildPlan(unzippedDir, prepared.placements || [{ from: '' }], targetDir);
    if (plan.every((p) => p.optional || p.files.length === 0)) {
      throw new Error(`"${path.basename(zipPath)}" appears to be empty — nothing was installed.`);
    }
    assertNoConflicts(modId, modName, plan);

    const mod = {
      id: modId,
      gameId,
      name: modName,
      zipPath: storedZipPath,
      unzippedPath: unzippedDir,
      targetDir,
      kind: prepared.kind || undefined,
      skippedFiles: prepared.skippedFiles || 0,
      installedOnBuild: gameDetect.currentBuildId(game),
      ...(isSwitchable(game) ? { enabled: true } : {}),
    };
    // Switchable games in clean mode keep the mod in the app until modded mode.
    const entry = {
      mod,
      plan,
      targetDir,
      deploy: deployedNow(game),
      prepared,
      discard,
      rootLabel: strategy.rootLabel || 'Mods folder',
    };
    staged.set(modId, entry);
    return summarize(modId, entry);
  } catch (err) {
    discard();
    throw err;
  }
}

// Step 2: put a staged mod in the game. Conflicts are checked again, since
// other mods may have been installed since it was staged.
function commitStaged(stageId) {
  const entry = staged.get(stageId);
  if (!entry) throw new Error('That install is no longer waiting — add the mod again.');
  const { mod, plan, targetDir, deploy } = entry;
  const game = gameStore.getGame(mod.gameId);
  try {
    assertGameClosed(game);
    assertNoConflicts(mod.id, mod.name, plan);
  } catch (err) {
    discardStaged(stageId);
    throw err;
  }
  staged.delete(stageId);
  const record = {
    ...mod,
    placements: deploy
      ? copyPlan(plan, targetDir)
      : plan.map(({ srcDir, files, ...p }) => ({ ...p, to: p.to === targetDir ? undefined : p.to, files: [] })),
    active: deploy,
    installedAt: new Date().toISOString(),
  };
  modStore.addMod(record);
  return record;
}

// Cancels a staged install, removing the app's copies.
function discardStaged(stageId) {
  const entry = staged.get(stageId);
  if (!entry) return;
  staged.delete(stageId);
  entry.discard();
}

// Stage and commit in one go (no preview).
async function installMod(args) {
  const summary = await stageMod(args);
  return commitStaged(summary.stageId);
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

const { isWanted } = modStore;

// Puts a mod in use or takes it out. For switchable games that means joining
// or leaving the modded set; its files only move right away in modded mode.
function setModWanted(modId, wanted) {
  const mod = modStore.getMod(modId);
  const game = gameStore.getGame(mod.gameId);
  if (!isSwitchable(game)) return wanted ? activateMod(modId) : deactivateMod(modId);

  if (!wanted && mod.active) deactivateMod(modId);
  if (wanted && game.mode === 'modded') {
    // Checked against the other mods in the modded set before it joins it.
    modStore.updateMod(modId, { enabled: true });
    try {
      activateMod(modId);
    } catch (err) {
      modStore.updateMod(modId, { enabled: false });
      throw err;
    }
  } else if (wanted) {
    // Clean mode: nothing is copied, but it still mustn't clash with the rest
    // of the modded set.
    assertNoConflicts(mod.id, mod.name, buildPlan(mod.unzippedPath, mod.placements || [{ from: '' }], mod.targetDir));
  }
  return modStore.updateMod(modId, { enabled: wanted });
}

// Puts exactly `modIds` in use: everything else is taken out first, so
// switching between profiles never trips the conflict check on its own mods.
function applyProfile({ gameId, modIds }) {
  assertGameClosed(gameStore.getGame(gameId));
  const wanted = new Set(modIds);
  const mods = modStore.loadMods().filter((m) => m.gameId === gameId);
  const errors = [];

  for (const m of mods) {
    if (!isWanted(m) || wanted.has(m.id)) continue;
    try {
      setModWanted(m.id, false);
    } catch (err) {
      errors.push(`${m.name}: ${err.message}`);
    }
  }
  for (const m of mods) {
    if (isWanted(m) || !wanted.has(m.id)) continue;
    try {
      setModWanted(m.id, true);
    } catch (err) {
      errors.push(`${m.name}: ${err.message}`);
    }
  }
  return { errors };
}

module.exports = {
  installMod,
  stageMod,
  commitStaged,
  discardStaged,
  removeMod,
  activateMod,
  deactivateMod,
  setModWanted,
  applyProfile,
  assertGameClosed,
};
