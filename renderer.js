const gameSelect = document.getElementById('gameSelect');
const addGameBtn = document.getElementById('addGameBtn');
const dropZone = document.getElementById('dropZone');
const browseBtn = document.getElementById('browseBtn');
const modListEl = document.getElementById('modList');
const modalOverlay = document.getElementById('modalOverlay');
const modalBox = document.getElementById('modalBox');
const toastEl = document.getElementById('toast');

const SUPPORTED_EXTS = ['.zip', '.rar', '.7z'];

let games = [];
let currentGameId = null;

function showToast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.add('hidden'), 3500);
}

function showModal(html) {
  modalBox.innerHTML = html;
  modalOverlay.classList.remove('hidden');
}

function hideModal() {
  modalOverlay.classList.add('hidden');
  modalBox.innerHTML = '';
}

modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) hideModal();
});

// ---------- Games ----------

async function loadGames() {
  games = await window.modManager.getGames();
  gameSelect.innerHTML = games.map((g) => `<option value="${g.id}">${g.name}</option>`).join('');
  if (games.length > 0) {
    const remembered = localStorage.getItem('lastGameId');
    currentGameId = games.some((g) => g.id === remembered) ? remembered : games[0].id;
    gameSelect.value = currentGameId;
  }
  renderGameHint();
  await loadMods();
}

function renderGameHint() {
  const game = games.find((g) => g.id === currentGameId);
  const el = document.getElementById('gameHint');
  el.textContent = game ? game.hint || '' : '';
  el.title = game ? game.modsPath : '';
}

gameSelect.addEventListener('change', async () => {
  currentGameId = gameSelect.value;
  localStorage.setItem('lastGameId', currentGameId);
  renderGameHint();
  await loadMods();
});

addGameBtn.addEventListener('click', () => {
  showModal(`
    <h3>Add a Game</h3>
    <div class="field">
      <label>Game name</label>
      <input type="text" id="newGameName" placeholder="e.g. Squad" />
    </div>
    <div class="field">
      <label>How does this game load mods?</label>
      <select id="newGameStrategy">
        <option value="paks">Loose files — extract into the game folder (Ready or Not style)</option>
        <option value="beamng">Zipped mods — drop the .zip in (BeamNG style)</option>
      </select>
    </div>
    <div class="field">
      <label>Mods folder for this game</label>
      <div class="path-row">
        <input type="text" id="newGamePath" placeholder="Choose a folder..." readonly />
        <button class="secondary" id="newGameBrowse">Browse</button>
      </div>
    </div>
    <div class="modal-actions">
      <button class="secondary" id="cancelAddGame">Cancel</button>
      <button id="confirmAddGame">Add Game</button>
    </div>
  `);

  document.getElementById('newGameBrowse').addEventListener('click', async () => {
    const folder = await window.modManager.chooseFolder();
    if (folder) document.getElementById('newGamePath').value = folder;
  });
  document.getElementById('cancelAddGame').addEventListener('click', hideModal);
  document.getElementById('confirmAddGame').addEventListener('click', async () => {
    const name = document.getElementById('newGameName').value.trim();
    const modsPath = document.getElementById('newGamePath').value.trim();
    const strategy = document.getElementById('newGameStrategy').value;
    if (!name || !modsPath) {
      showToast('Please enter a name and choose a folder.', true);
      return;
    }
    try {
      const game = await window.modManager.addGame({ name, modsPath, strategy });
      hideModal();
      await loadGames();
      currentGameId = game.id;
      gameSelect.value = game.id;
      localStorage.setItem('lastGameId', game.id);
      await loadMods();
      showToast(`Added "${game.name}".`);
    } catch (err) {
      showToast(err.message, true);
    }
  });
});

// ---------- Mods ----------

async function loadMods() {
  const mods = currentGameId ? await window.modManager.getMods(currentGameId) : [];
  if (mods.length === 0) {
    modListEl.innerHTML = '<li class="empty-state">No mods installed yet. Drag a mod file above to get started.</li>';
    return;
  }
  modListEl.innerHTML = mods
    .map((m) => {
      const active = m.active !== false;
      return `
      <li class="${active ? '' : 'inactive'}">
        <div class="mod-info">
          <div class="mod-name">
            ${m.name}
            <span class="badge ${active ? 'on' : 'off'}">${active ? 'In game' : 'Not in game'}</span>
          </div>
          <div class="mod-date">Added ${new Date(m.installedAt).toLocaleString()}</div>
        </div>
        <div class="mod-actions">
          <button class="secondary" data-toggle="${m.id}" data-active="${active}">
            ${active ? 'Deactivate' : 'Activate'}
          </button>
          <button class="danger" data-remove="${m.id}">Remove</button>
        </div>
      </li>`;
    })
    .join('');

  modListEl.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => promptRemove(btn.getAttribute('data-remove'), mods));
  });

  modListEl.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const modId = btn.getAttribute('data-toggle');
      const makeActive = btn.getAttribute('data-active') !== 'true';
      btn.disabled = true;
      try {
        const mod = await window.modManager.setModActive({ modId, active: makeActive });
        await loadMods();
        showToast(
          makeActive
            ? `"${mod.name}" is back in the game folder.`
            : `"${mod.name}" removed from the game, still saved in the app.`
        );
      } catch (err) {
        btn.disabled = false;
        showToast(err.message, true);
      }
    });
  });
}

function promptRemove(modId, mods) {
  const mod = mods.find((m) => m.id === modId);
  showModal(`
    <h3>Remove "${mod.name}" completely?</h3>
    <p>This deletes it from everywhere:</p>
    <ul class="modal-list">
      <li>the game folder</li>
      <li>the app's saved archive</li>
      <li>the app's extracted copy</li>
    </ul>
    <p class="modal-note">The app's copies go to the Recycle Bin, so this is recoverable.
    To keep the mod but take it out of the game, use <strong>Deactivate</strong> instead.</p>
    <div class="modal-actions">
      <button class="secondary" id="cancelRemove">Cancel</button>
      <button class="danger" id="confirmRemove">Remove Everywhere</button>
    </div>
  `);
  document.getElementById('cancelRemove').addEventListener('click', hideModal);
  document.getElementById('confirmRemove').addEventListener('click', async () => {
    hideModal();
    try {
      await window.modManager.removeMod({ modId });
      await loadMods();
      showToast(`Removed "${mod.name}" from everywhere.`);
    } catch (err) {
      showToast(err.message, true);
    }
  });
}

// ---------- Installing ----------

function promptInstall(zipPath) {
  const fileName = String(zipPath).split(/[\\/]/).pop();
  const game = games.find((g) => g.id === currentGameId);
  showModal(`
    <h3>Install "${fileName}"</h3>
    <p>Where should this mod go?</p>
    <div class="modal-path"><strong>Default:</strong> ${game ? game.modsPath : ''}</div>
    <div class="modal-actions">
      <button class="secondary" id="cancelInstall">Cancel</button>
      <button class="secondary" id="customFolderBtn">Choose folder...</button>
      <button id="defaultFolderBtn">Use Default</button>
    </div>
  `);
  document.getElementById('cancelInstall').addEventListener('click', hideModal);
  document.getElementById('defaultFolderBtn').addEventListener('click', () => {
    hideModal();
    doInstall(zipPath, null);
  });
  document.getElementById('customFolderBtn').addEventListener('click', async () => {
    const folder = await window.modManager.chooseFolder();
    if (folder) {
      hideModal();
      doInstall(zipPath, folder);
    }
  });
}

async function doInstall(zipPath, customTargetDir) {
  try {
    const mod = await window.modManager.installMod({ gameId: currentGameId, zipPath, customTargetDir });
    await loadMods();
    let msg = `Installed "${mod.name}".`;
    if (mod.originalRemoved) {
      msg += ' Original moved to the Recycle Bin.';
    } else if (mod.originalRemoveError) {
      msg += ` (Couldn't remove the original: ${mod.originalRemoveError})`;
    }
    showToast(msg);
  } catch (err) {
    showToast(err.message, true);
  }
}

function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  window.modManager.log(`drop: ${files.length} item(s): ` + files.map((f) => `${f.name} (type=${f.type || 'none'})`).join(', '));

  if (!currentGameId) {
    showToast('Add a game first.', true);
    return;
  }
  if (files.length === 0) {
    showToast('Nothing was dropped. Try the Browse button instead.', true);
    return;
  }

  const zipFiles = files.filter((f) => SUPPORTED_EXTS.some((ext) => f.name.toLowerCase().endsWith(ext)));
  if (zipFiles.length === 0) {
    const names = files.map((f) => f.name).join(', ');
    showToast(`Unsupported file: ${names}. This app accepts .zip, .rar and .7z mod files.`, true);
    return;
  }

  for (const f of zipFiles) {
    const resolved = window.modManager.getFilePath(f);
    window.modManager.log(`resolved path for ${f.name}: ${resolved}`);
    if (!resolved) {
      showToast(`Couldn't read the location of "${f.name}". Use the Browse button instead.`, true);
      continue;
    }
    promptInstall(resolved);
  }
}

// ---------- Drag & drop / browse wiring ----------
// Drops are accepted anywhere in the window, not just inside the dashed box,
// because dropping slightly outside it is an easy mistake to make.

['dragenter', 'dragover'].forEach((evt) => {
  window.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
});

window.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) dropZone.classList.remove('dragover');
});

window.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  try {
    handleFiles(e.dataTransfer && e.dataTransfer.files);
  } catch (err) {
    window.modManager.log('drop handler error: ' + (err && err.stack));
    showToast('Something went wrong reading that file: ' + err.message, true);
  }
});

browseBtn.addEventListener('click', async () => {
  const zipPath = await window.modManager.chooseZip();
  if (zipPath) promptInstall(zipPath);
});

window.addEventListener('error', (e) => {
  window.modManager.log('uncaught error: ' + (e.error && e.error.stack ? e.error.stack : e.message));
  showToast('Error: ' + e.message, true);
});

loadGames();
