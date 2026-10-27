const { execFileSync } = require('child_process');

// BeamNG rewrites its own mod database while running, so touching mod files
// mid-session can leave the game and the folder out of sync.
function isProcessRunning(exeName) {
  if (process.platform !== 'win32') return false;
  try {
    const out = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${exeName}`, '/NH'], {
      encoding: 'utf-8',
      windowsHide: true,
    });
    return out.toLowerCase().includes(exeName.toLowerCase());
  } catch {
    return false; // never block an install just because the check failed
  }
}

module.exports = { isProcessRunning };
