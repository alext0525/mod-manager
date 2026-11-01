const fs = require('fs');
const path = require('path');
const os = require('os');

const { extractArchive, listArchive, createZipFromFolder } = require('../extractor');

// BeamNG loads mods straight out of .zip files in the user folder — the archive
// is never extracted into the game. So "preparing" a mod means producing one or
// more correctly-rooted .zip files, which are then dropped into current\mods\.

// The only folders a real BeamNG mod has at its root.
const VALID_TOP_LEVEL = new Set([
  'vehicles',
  'levels',
  'art',
  'assets',
  'lua',
  'scripts',
  'ui',
  'gameplay',
  'settings',
  'trackeditor',
  'vehiclegroups',
  'mod_info', // repository-generated metadata, optional but legitimate
]);

// A BeamNG mod is data only. Any of these means something is wrong or hostile.
const BLOCKED_EXTS = new Set([
  '.exe', '.dll', '.bat', '.cmd', '.ps1', '.vbs', '.scr', '.msi', '.jar', '.reg',
]);

function findBlockedFiles(relativePaths) {
  return relativePaths.filter((p) => BLOCKED_EXTS.has(path.extname(p).toLowerCase()));
}

function blockedError(archiveName, offenders) {
  const shown = offenders.slice(0, 5).join(', ');
  const more = offenders.length > 5 ? ` (+${offenders.length - 5} more)` : '';
  return new Error(
    `Blocked "${archiveName}": it contains program files (${shown}${more}). ` +
      `A real BeamNG mod never needs these — nothing was installed.`
  );
}

function topSegment(relPath) {
  return relPath.split('/')[0];
}

function rootsOf(relativePaths) {
  return [...new Set(relativePaths.map(topSegment))];
}

function hasValidRoot(relativePaths) {
  return rootsOf(relativePaths).some((r) => VALID_TOP_LEVEL.has(r.toLowerCase()));
}

function walkFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, base, out);
    else out.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return out;
}

// Walks down through wrapper folders until it finds the level that actually
// holds BeamNG's top-level folders. Returns null if there isn't one.
function findContentRoot(dir, depth = 0) {
  if (depth > 4) return null;
  const dirs = fs.readdirSync(dir, { withFileTypes: true }).filter((c) => c.isDirectory());

  if (dirs.some((d) => VALID_TOP_LEVEL.has(d.name.toLowerCase()))) return dir;

  // A single wrapper folder (e.g. "CoolMod/vehicles/...") — strip it and retry.
  if (dirs.length === 1) return findContentRoot(path.join(dir, dirs[0].name), depth + 1);

  return null;
}

// Packs only the recognised top-level folders, so stray readme/wrapper junk
// doesn't end up at the archive root.
async function zipContentRoot(contentRoot, outZipPath, tempRoot) {
  const packRoot = fs.mkdtempSync(path.join(tempRoot, 'pack-'));
  for (const entry of fs.readdirSync(contentRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && VALID_TOP_LEVEL.has(entry.name.toLowerCase())) {
      fs.renameSync(path.join(contentRoot, entry.name), path.join(packRoot, entry.name));
    }
  }
  if (fs.readdirSync(packRoot).length === 0) {
    throw new Error('No BeamNG mod folders found to pack.');
  }
  await createZipFromFolder(packRoot, outZipPath);
  fs.rmSync(packRoot, { recursive: true, force: true });
}

function uniqueName(dir, base) {
  let candidate = path.join(dir, base + '.zip');
  let n = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${n}).zip`);
    n += 1;
  }
  return candidate;
}

// Turns one .zip into a game-ready .zip inside stagingDir.
// Copies it untouched when it is already rooted correctly (BeamNG advises
// against renaming/rewriting mod zips), and repacks it when it is wrapped.
async function normalizeZip({ zipPath, stagingDir, outName, tempRoot }) {
  const entries = await listArchive(zipPath);
  if (entries.length === 0) throw new Error(`"${path.basename(zipPath)}" is empty.`);

  const blocked = findBlockedFiles(entries);
  if (blocked.length) throw blockedError(path.basename(zipPath), blocked);

  if (hasValidRoot(entries)) {
    fs.copyFileSync(zipPath, uniqueName(stagingDir, outName));
    return;
  }

  // Wrapped (e.g. "ModName/vehicles/..."): unpack and repack from the real root.
  const scratch = fs.mkdtempSync(path.join(tempRoot, 'unwrap-'));
  await extractArchive(zipPath, scratch);
  const contentRoot = findContentRoot(scratch);
  if (!contentRoot) {
    throw new Error(
      `"${path.basename(zipPath)}" doesn't look like a BeamNG mod — its top-level folder is ` +
        `"${rootsOf(entries)[0]}", not one of vehicles/levels/lua/ui/art/etc.`
    );
  }
  await zipContentRoot(contentRoot, uniqueName(stagingDir, outName), tempRoot);
  fs.rmSync(scratch, { recursive: true, force: true });
}

async function installInnerZips({ dir, stagingDir, tempRoot }) {
  const zips = walkFiles(dir).filter((f) => f.toLowerCase().endsWith('.zip'));
  for (const rel of zips) {
    await normalizeZip({
      zipPath: path.join(dir, rel),
      stagingDir,
      outName: path.basename(rel, path.extname(rel)),
      tempRoot,
    });
  }
}

// What the staged mod zips contain, for the install preview — read from
// their top-level folders.
const KIND_OF_ROOT = {
  vehicles: 'vehicle',
  levels: 'map',
  ui: 'UI app',
  lua: 'script',
  scripts: 'script',
  gameplay: 'scenario',
  art: 'art / sounds',
  assets: 'assets',
  settings: 'settings',
  trackeditor: 'track',
  vehiclegroups: 'vehicle group',
};

async function describeStaged(stagingDir) {
  const kinds = new Set();
  const zips = fs.readdirSync(stagingDir).filter((f) => f.toLowerCase().endsWith('.zip'));
  for (const zip of zips) {
    for (const root of rootsOf(await listArchive(path.join(stagingDir, zip)))) {
      const kind = KIND_OF_ROOT[root.toLowerCase()];
      if (kind) kinds.add(kind);
    }
  }
  const label = [...kinds].join(' + ') || 'mod';
  return `BeamNG ${label}${zips.length > 1 ? ` (${zips.length} zips)` : ''}`;
}

async function prepare(args) {
  await stage(args);
  return { kind: await describeStaged(args.stagingDir) };
}

async function stage({ archivePath, stagingDir, modName }) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'beamng-prep-'));
  try {
    const ext = path.extname(archivePath).toLowerCase();

    if (ext === '.zip') {
      const entries = await listArchive(archivePath);
      const blocked = findBlockedFiles(entries);
      if (blocked.length) throw blockedError(path.basename(archivePath), blocked);

      const innerZips = entries.filter((e) => e.toLowerCase().endsWith('.zip'));
      if (innerZips.length === 0) {
        await normalizeZip({ zipPath: archivePath, stagingDir, outName: modName, tempRoot });
        return;
      }
      // A zip of zips is a mod pack — the game won't recurse, so each inner zip
      // has to be installed in its own right.
      const unpacked = path.join(tempRoot, 'pack');
      await extractArchive(archivePath, unpacked);
      await installInnerZips({ dir: unpacked, stagingDir, tempRoot });
      return;
    }

    // .rar / .7z are not mod formats — BeamNG only ever loads .zip. Unpack and
    // work out what's actually inside.
    const unpacked = path.join(tempRoot, 'outer');
    await extractArchive(archivePath, unpacked);

    const files = walkFiles(unpacked);
    const blocked = findBlockedFiles(files);
    if (blocked.length) throw blockedError(path.basename(archivePath), blocked);

    if (files.some((f) => f.toLowerCase().endsWith('.zip'))) {
      await installInnerZips({ dir: unpacked, stagingDir, tempRoot });
      return;
    }

    const contentRoot = findContentRoot(unpacked);
    if (!contentRoot) {
      throw new Error(
        `"${path.basename(archivePath)}" doesn't contain a BeamNG mod — no vehicles/levels/lua/ui/art ` +
          `folder and no inner .zip was found.`
      );
    }
    await zipContentRoot(contentRoot, uniqueName(stagingDir, modName), tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

module.exports = {
  id: 'beamng',
  prepare,
  hint: 'Mods stay zipped — the game-ready .zip is placed in your BeamNG user folder.',
  rootLabel: 'BeamNG mods folder',
  requiresGameClosed: 'BeamNG.drive.exe',
  VALID_TOP_LEVEL,
  BLOCKED_EXTS,
};
