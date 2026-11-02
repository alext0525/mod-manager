const fs = require('fs');
const path = require('path');
const os = require('os');

const { extractArchive } = require('../extractor');
const { walkFiles, walkDirs, moveInto, isDoc, expandNestedArchives, isUnder } = require('./files');

// Assetto Corsa: cars go in content\cars\<car>, tracks in content\tracks\<track>,
// skins in content\cars\<car>\skins\<skin>, Python apps in apps\python\<app>,
// Lua (Custom Shaders Patch) apps in apps\lua\<app>, CSP config in extension\.
// Archives already laid out like the game folder are copied as they are;
// otherwise each car/track/app folder is recognised by its tell-tale files.

const ROOT_FOLDERS = ['content', 'apps', 'extension', 'system'];

// Walks through single wrapper folders to a level laid out like the game folder.
function findGameRoot(dir, depth = 0) {
  if (depth > 3) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (entries.some((e) => ROOT_FOLDERS.includes(e.name.toLowerCase()))) return dir;
  if (entries.length === 1) return findGameRoot(path.join(dir, entries[0].name), depth + 1);
  return null;
}

function has(files, rel) {
  const want = rel.toLowerCase();
  return files.some((f) => f.toLowerCase() === want);
}

function outermost(dirs) {
  return dirs.filter((d) => !dirs.some((o) => o !== d && isUnder(o, d)));
}

function describe(rels) {
  const count = (re) => new Set(rels.map((f) => (f.match(re) || [])[1]).filter(Boolean)).size;
  const parts = [];
  const cars = count(/^content[\\/]cars[\\/]([^\\/]+)[\\/](?!skins[\\/])/i);
  const skins = count(/^content[\\/]cars[\\/][^\\/]+[\\/]skins[\\/]([^\\/]+)/i);
  const tracks = count(/^content[\\/]tracks[\\/]([^\\/]+)/i);
  const apps = count(/^apps[\\/](?:python|lua)[\\/]([^\\/]+)/i);
  if (cars) parts.push(cars === 1 ? 'car' : `${cars} cars`);
  if (!cars && skins) parts.push(skins === 1 ? 'skin' : `${skins} skins`);
  if (tracks) parts.push(tracks === 1 ? 'track' : `${tracks} tracks`);
  if (apps) parts.push(apps === 1 ? 'app' : `${apps} apps`);
  if (rels.some((f) => /^extension[\\/]/i.test(f))) parts.push('Custom Shaders Patch config');
  return `Assetto Corsa ${parts.join(' + ') || 'content'}`;
}

async function prepare({ archivePath, stagingDir, targetDir }) {
  const archiveName = path.basename(archivePath);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-prep-'));
  try {
    await extractArchive(archivePath, scratch);
    await expandNestedArchives(scratch);
    const all = walkFiles(scratch);
    const staged = [];
    const used = new Set();
    const put = (rel, destRel) => {
      moveInto(path.join(scratch, rel), path.join(stagingDir, destRel), archiveName);
      used.add(rel);
      staged.push(destRel);
    };

    const root = findGameRoot(scratch);
    if (root) {
      // Already laid out like the game folder.
      for (const rel of walkFiles(root)) {
        const top = rel.split(path.sep)[0].toLowerCase();
        if (!ROOT_FOLDERS.includes(top)) continue;
        put(path.relative(scratch, path.join(root, rel)), rel);
      }
    } else {
      const dirs = walkDirs(scratch);
      const sub = (d, f) => path.join(d, f);
      const cars = outermost(
        dirs.filter((d) => has(all, sub(d, 'data.acd')) || has(all, sub(d, path.join('ui', 'ui_car.json'))))
      );
      const tracks = outermost(
        dirs.filter(
          (d) =>
            !cars.some((c) => isUnder(c, d)) &&
            path.basename(d).toLowerCase() !== 'ui' &&
            all.some((f) => {
              const r = f.toLowerCase();
              const base = d.toLowerCase() + path.sep + 'ui' + path.sep;
              return r.startsWith(base) && r.endsWith('ui_track.json') && r.split(path.sep).length - base.split(path.sep).length <= 1;
            })
        )
      );
      // Skins on their own: <car>\skins\<skin>\ui_skin.json.
      const skins = outermost(
        dirs.filter(
          (d) =>
            has(all, sub(d, 'ui_skin.json')) &&
            ![...cars, ...tracks].some((u) => isUnder(u, d)) &&
            path.basename(path.dirname(d)).toLowerCase() === 'skins'
        )
      );
      const pyApps = dirs.filter((d) => has(all, sub(d, `${path.basename(d)}.py`)));
      const luaApps = dirs.filter(
        (d) => has(all, sub(d, 'manifest.ini')) && all.some((f) => isUnder(d, f) && /\.lua$/i.test(f))
      );

      const stageUnit = (dir, destRoot) => {
        for (const rel of all.filter((f) => isUnder(dir, f))) {
          const inner = rel.slice(dir.length + 1);
          if (!inner.includes(path.sep) && isDoc(inner) && !/\.(png|jpe?g)$/i.test(inner)) continue;
          put(rel, path.join(destRoot, inner));
        }
      };
      for (const d of cars) stageUnit(d, path.join('content', 'cars', path.basename(d)));
      for (const d of tracks) stageUnit(d, path.join('content', 'tracks', path.basename(d)));
      for (const d of skins) {
        const car = path.basename(path.dirname(path.dirname(d)));
        stageUnit(d, path.join('content', 'cars', car, 'skins', path.basename(d)));
      }
      for (const d of pyApps) stageUnit(d, path.join('apps', 'python', path.basename(d)));
      for (const d of luaApps) stageUnit(d, path.join('apps', 'lua', path.basename(d)));
    }

    if (staged.length === 0) {
      throw new Error(
        `"${archiveName}" doesn't look like Assetto Corsa content: no car (data.acd or ui\\ui_car.json), ` +
          `track (ui\\ui_track.json), skin (ui_skin.json) or app folder was found.`
      );
    }

    const notes = [];
    if (!fs.existsSync(path.join(targetDir, 'extension')) && staged.some((f) => /^content[\\/]/i.test(f))) {
      notes.push('Many mod cars and tracks need Custom Shaders Patch, which isn\'t installed in this game.');
    }
    const skipped = all.filter((f) => !used.has(f));
    return { skipped, skippedFiles: skipped.length, kind: describe(staged), notes };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

module.exports = {
  id: 'assettocorsa',
  prepare,
  rootLabel: 'Game folder',
  hint: 'Cars go to content\\cars, tracks to content\\tracks, apps to apps\\python or apps\\lua.',
};
