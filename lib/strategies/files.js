const fs = require('fs');
const path = require('path');

const { extractArchive, isSupportedArchive } = require('../extractor');

// Shared file helpers for the install types.

function walkFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, base, out);
    else out.push(path.relative(base, full));
  }
  return out;
}

function walkDirs(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    out.push(path.relative(base, full));
    walkDirs(full, base, out);
  }
  return out;
}

// Moves one extracted file into the staging area. Two files landing on the
// same name means the archive holds alternatives — never silently pick one.
function moveInto(srcFile, destFile, archiveName) {
  if (fs.existsSync(destFile)) {
    throw new Error(
      `"${archiveName}" has more than one file called "${path.basename(destFile)}" in different ` +
        `folders — usually alternative versions of the same mod. Pick one version when installing.`
    );
  }
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.renameSync(srcFile, destFile);
}

// Readmes, screenshots, shortcuts and installers that ride along in archives.
const DOC_EXTS = /\.(txt|md|pdf|url|png|jpe?g|gif|bmp|webp|html?|rtf|docx?|exe|bat|cmd|ps1|vbs)$/i;
function isDoc(relPath) {
  return DOC_EXTS.test(relPath);
}

// Archives inside the archive (e.g. "Version A.zip", "Version B.zip") are
// unpacked into a folder of their own name, so they look like any other
// folder in the mod — including as alternative versions.
async function expandNestedArchives(dir) {
  for (let pass = 0; pass < 2; pass += 1) {
    const inner = walkFiles(dir).filter((f) => isSupportedArchive(f));
    if (inner.length === 0) return;
    for (const rel of inner) {
      const file = path.join(dir, rel);
      const target = path.join(path.dirname(file), path.basename(rel, path.extname(rel)));
      await extractArchive(file, target);
      fs.rmSync(file, { force: true });
    }
  }
}

function isUnder(dir, rel) {
  return dir === '.' || dir === '' || rel.toLowerCase().startsWith(dir.toLowerCase() + path.sep);
}

// Alternative versions and optional extras. When the files that matter sit in
// two or more folders side by side ("Normal\x.pak", "No CCTV\x.pak", or main
// files next to an "Optional\" folder), each folder is a choice for the user.
// `keepFolders` are folder names the game itself uses (e.g. LogicMods), which
// are part of the layout rather than a version. Returns null when there's
// nothing to choose.
function findVariants(files, matters, keepFolders = []) {
  const keep = new Set(keepFolders.map((k) => k.toLowerCase()));
  const dirs = files.filter(matters).map((f) => {
    const parts = path.dirname(f).split(path.sep).filter((p) => p && p !== '.');
    while (parts.length && keep.has(parts[parts.length - 1].toLowerCase())) parts.pop();
    return parts;
  });
  if (dirs.length < 2) return null;

  // The folder all of them share (a wrapper like "MyMod v2\").
  const prefix = [];
  for (let i = 0; ; i += 1) {
    const seg = dirs[0][i];
    if (seg === undefined || !dirs.every((d) => d[i] !== undefined && d[i].toLowerCase() === seg.toLowerCase())) break;
    prefix.push(seg);
  }
  const groups = new Map();
  for (const d of dirs) {
    const name = d[prefix.length] || '';
    groups.set(name, (groups.get(name) || 0) + 1);
  }
  if (groups.size < 2) return null;
  return {
    prefix: prefix.join(path.sep),
    groups: [...groups.entries()]
      .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
      .map(([id, count]) => ({ id, label: id || 'Main files', count })),
  };
}

// By default only the main files (if any) are chosen; versions and extras
// are the user's call.
function defaultSelection(variants) {
  return variants.groups.some((g) => g.id === '') ? [''] : [];
}

// Drops files inside the version folders that weren't chosen.
function filterSelected(files, variants, selection) {
  if (!variants) return files;
  const chosen = new Set(selection);
  const skip = variants.groups
    .filter((g) => g.id !== '' && !chosen.has(g.id))
    .map((g) => (variants.prefix ? path.join(variants.prefix, g.id) : g.id));
  return files.filter((f) => !skip.some((dir) => isUnder(dir, f)));
}

module.exports = {
  walkFiles,
  walkDirs,
  moveInto,
  isDoc,
  expandNestedArchives,
  isUnder,
  findVariants,
  defaultSelection,
  filterSelected,
};
