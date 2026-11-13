const { execFileSync } = require('child_process');

// Names of every running process, lower-cased. CSV output is used because
// tasklist's default table cuts image names at 25 characters, which hid long
// ones like DyingLightGame_TheBeast_x64_rwdi.exe.
function runningProcesses() {
  if (process.platform !== 'win32') return new Set();
  try {
    const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], {
      encoding: 'utf-8',
      windowsHide: true,
    });
    return new Set(
      out
        .split(/\r?\n/)
        .map((line) => (line.match(/^"([^"]+)"/) || [])[1])
        .filter(Boolean)
        .map((name) => name.toLowerCase())
    );
  } catch {
    return new Set(); // never block an install just because the check failed
  }
}

// Games rewrite or lock their mod files while running (BeamNG its mod
// database, Unreal its .pak files), so mod files are only touched when closed.
function isAnyRunning(exeNames) {
  if (!exeNames.length) return false;
  const running = runningProcesses();
  return exeNames.some((name) => running.has(name.toLowerCase()));
}

function isProcessRunning(exeName) {
  return isAnyRunning([exeName]);
}

module.exports = { isProcessRunning, isAnyRunning };
