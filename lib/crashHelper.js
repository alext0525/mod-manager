const fs = require('fs');
const path = require('path');

const gameStore = require('./gameStore');
const modStore = require('./modStore');
const gameDetect = require('./gameDetect');

// After a crash: reads the game's newest crash report and its logs, and
// points at the mods most likely involved. It can't be certain — it shows
// what the logs say and why each mod is a suspect.

const READ_LIMIT = 512 * 1024; // only the end of a log matters
const ERROR_LINE = /(fatal|error|exception|crash|critical|failed|unhandled|access violation|assert)/i;

function readTail(file) {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  try {
    const length = Math.min(size, READ_LIMIT);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    // Unreal writes some crash files as UTF-16.
    const text = buffer.includes(0) ? buffer.toString('utf16le') : buffer.toString('utf-8');
    return text.replace(/\0/g, '');
  } finally {
    fs.closeSync(fd);
  }
}

function newestCrash(crashDirs) {
  let newest = null;
  for (const dir of crashDirs) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const time = fs.statSync(full).mtimeMs;
      if (!newest || time > newest.time) newest = { dir: full, time };
    }
  }
  return newest;
}

function sourcesFor(game) {
  const known = gameDetect.knownGameFor(game);
  return known && known.diagnostics ? known.diagnostics(game.modsPath) : null;
}

// Some games write a crash as a folder (Unreal's Saved\Crashes\<crash>),
// others as a single file (Dying Light's crash_<date>.log).
function newestCrashOf(sources) {
  let newest = newestCrash(sources.crashDirs || []);
  for (const file of sources.crashFiles || []) {
    if (!fs.existsSync(file)) continue;
    const time = fs.statSync(file).mtimeMs;
    if (!newest || time > newest.time) newest = { file, time };
  }
  return newest;
}

// When the newest crash report was written, for the "it crashed" banner.
function latestCrashTime(game) {
  const sources = sourcesFor(game);
  const crash = sources && newestCrashOf(sources);
  return crash ? crash.time : null;
}

// Names a mod could show up under in a log: its own name and the names of
// the files it puts in the game.
function tokensFor(mod) {
  const tokens = new Set([mod.name.toLowerCase()]);
  for (const p of mod.placements || []) {
    for (const rel of p.files || []) {
      const base = path.basename(rel, path.extname(rel)).toLowerCase();
      if (base.length >= 5 && !['enabled', 'readme', 'config', 'install'].includes(base)) tokens.add(base);
    }
  }
  return [...tokens];
}

function analyze(gameId) {
  const game = gameDetect.withLiveInfo(gameStore.getGame(gameId));
  const sources = sourcesFor(game);
  if (!sources) {
    return { supported: false, gameName: game.name };
  }

  const read = [];
  const crash = newestCrashOf(sources);
  if (crash && crash.file) {
    read.push({ file: crash.file, time: crash.time, text: readTail(crash.file) });
  } else if (crash) {
    for (const name of fs.readdirSync(crash.dir)) {
      if (/\.(log|txt|xml|runtime-xml)$/i.test(name)) {
        const file = path.join(crash.dir, name);
        read.push({ file, time: fs.statSync(file).mtimeMs, text: readTail(file) });
      }
    }
  }
  for (const file of sources.logs) {
    if (read.some((r) => r.file === file) || !fs.existsSync(file)) continue;
    read.push({ file, time: fs.statSync(file).mtimeMs, text: readTail(file) });
  }

  const lines = read.flatMap((r) => r.text.split(/\r?\n/));
  const lower = lines.map((l) => l.toLowerCase());
  const mods = modStore.loadMods().filter((m) => m.gameId === gameId);

  // Unreal lists every .pak it mounts, so a plain mount line says nothing
  // about a crash. A mention in or just before an error line counts most.
  const ROUTINE = /mounted pak file|mounting pak|found pak file|added pak/i;
  const nearError = new Set();
  lines.forEach((l, i) => {
    if (!ERROR_LINE.test(l)) return;
    for (let j = Math.max(0, i - 5); j <= i; j += 1) nearError.add(j);
  });
  const mentioned = [];
  for (const mod of mods) {
    const tokens = tokensFor(mod);
    let best = -1;
    lower.forEach((l, i) => {
      if (ROUTINE.test(l) || !tokens.some((t) => l.includes(t))) return;
      if (best === -1 || (nearError.has(i) && !nearError.has(best))) best = i;
    });
    if (best !== -1) {
      mentioned.push({ name: mod.name, line: lines[best].trim().slice(0, 300), nearError: nearError.has(best) });
    }
  }
  mentioned.sort((a, b) => Number(b.nearError) - Number(a.nearError));

  const inUse = mods.filter(modStore.isWanted);
  const recent = [...inUse]
    .sort((a, b) => new Date(b.installedAt) - new Date(a.installedAt))
    .slice(0, 3)
    .map((m) => ({ name: m.name, installedAt: m.installedAt }));
  const outdated = inUse
    .filter((m) => game.currentBuildId && m.installedOnBuild && m.installedOnBuild !== game.currentBuildId)
    .map((m) => m.name);

  const errorLines = [...new Set(lines.filter((l) => ERROR_LINE.test(l)).map((l) => l.trim().slice(0, 300)))].slice(-15);

  return {
    supported: true,
    gameName: game.name,
    crash: crash ? { folder: crash.dir || crash.file, time: crash.time } : null,
    filesRead: read.map((r) => ({ file: r.file, time: r.time })),
    mentioned,
    recent,
    outdated,
    errorLines,
  };
}

// Records that the user has looked at the newest crash.
function acknowledgeCrash(gameId) {
  const time = latestCrashTime(gameStore.getGame(gameId));
  if (time) gameStore.updateGame(gameId, { crashSeenAt: time });
}

module.exports = { analyze, latestCrashTime, acknowledgeCrash };
