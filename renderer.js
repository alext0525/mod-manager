const gameSelect = document.getElementById('gameSelect');
const addGameBtn = document.getElementById('addGameBtn');
const dropZone = document.getElementById('dropZone');
const browseBtn = document.getElementById('browseBtn');
const modListEl = document.getElementById('modList');
const profilesBtn = document.getElementById('profilesBtn');
const gameUpdateBanner = document.getElementById('gameUpdateBanner');
const modePanel = document.getElementById('modePanel');
const appUpdateBar = document.getElementById('appUpdateBar');
const modalOverlay = document.getElementById('modalOverlay');
const modalBox = document.getElementById('modalBox');
const toastEl = document.getElementById('toast');

const SUPPORTED_EXTS = ['.zip', '.rar', '.7z'];

const STRATEGY_LABELS = {
  paks: 'Unreal Engine — .pak files into the Paks folder (Ready or Not style)',
  loose: 'Loose files — extract everything into the mods folder',
  beamng: 'Zipped mods — drop the .zip in (BeamNG style)',
};

let games = [];
let currentGameId = null;
let currentMods = [];
let installing = false;

// Mod and game names come from file names, so never put them in HTML raw.
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// Errors from the main process arrive wrapped in Electron's own prefix.
function errorText(err) {
  return String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

// `sticky` keeps the toast up until the next one (used while installing).
function showToast(message, isError = false, sticky = false) {
  toastEl.textContent = message;
  toastEl.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(showToast._t);
  if (!sticky) showToast._t = setTimeout(() => toastEl.classList.add('hidden'), isError ? 7000 : 3500);
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

function currentGame() {
  return games.find((g) => g.id === currentGameId);
}

// Whether the user wants a mod in use (same rule as lib/modStore.js): for
// GTA V / RDR2 that's being in the modded set, not having files in the folder.
function isWanted(mod) {
  return (mod.enabled !== undefined ? mod.enabled : mod.active) !== false;
}

// ---------- Games ----------

async function loadGames(selectId) {
  games = await window.modManager.getGames();
  gameSelect.innerHTML = games.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
  gameSelect.classList.toggle('hidden', games.length === 0);
  if (games.length > 0) {
    const wanted = selectId || localStorage.getItem('lastGameId');
    currentGameId = games.some((g) => g.id === wanted) ? wanted : games[0].id;
    gameSelect.value = currentGameId;
    localStorage.setItem('lastGameId', currentGameId);
  } else {
    currentGameId = null;
  }
  renderGameHint();
  await loadMods();
  if (games.length === 0) openAddGame();
}

function renderGameHint() {
  const game = currentGame();
  const el = document.getElementById('gameHint');
  el.textContent = game ? game.hint || '' : 'Add a game first.';
  el.title = game ? game.modsPath : '';
}

gameSelect.addEventListener('change', async () => {
  currentGameId = gameSelect.value;
  localStorage.setItem('lastGameId', currentGameId);
  renderGameHint();
  await loadMods();
});

addGameBtn.addEventListener('click', openAddGame);

function scanRow(g) {
  let detail;
  let action;
  if (g.status === 'known') {
    detail = g.modsPath || 'Mods folder not created yet';
    action = g.modsPath
      ? `<button data-add="${esc(g.catalogId)}">Add</button>`
      : '<span class="hint-text">Launch the game once first</span>';
  } else if (g.status === 'guessed') {
    detail = `Guess (${g.reason}): ${g.modsPath}`;
    action = `<button class="secondary" data-setup="${esc(g.steamAppId)}">Check &amp; add</button>`;
  } else if (g.status === 'unknown') {
    detail = 'No mods folder found — you can set it up yourself';
    action = `<button class="secondary" data-setup="${esc(g.steamAppId)}">Set up</button>`;
  } else {
    detail = g.reason;
    action = '';
  }
  if (g.added) action = '<span class="badge on">Added</span>';

  return `
    <li class="${g.status === 'unsupported' ? 'unsupported' : ''}">
      <div class="mod-info">
        <div class="mod-name">${esc(g.name)}</div>
        <div class="mod-date" title="${esc(detail)}">${esc(detail)}</div>
      </div>
      ${action}
    </li>`;
}

async function openAddGame() {
  showModal('<h3>Add a Game</h3><p class="hint-text">Looking through your Steam libraries…</p>');
  let scanned = [];
  try {
    scanned = await window.modManager.detectGames();
  } catch (err) {
    window.modManager.log('detect-games: ' + errorText(err));
  }
  const known = scanned.filter((g) => g.status === 'known');
  const others = scanned.filter((g) => g.status !== 'known');
  // Steam app id of the game being set up by hand, so its updates can be tracked.
  let setupAppId = null;

  showModal(`
    <h3>Add a Game</h3>
    ${
      known.length
        ? `<p class="hint-text">The app knows exactly where these games' mods go:</p>
           <ul class="detected-list">${known.map(scanRow).join('')}</ul>`
        : ''
    }
    ${
      others.length
        ? `<p class="hint-text">Your other Steam games. Where the app found a likely mods folder it shows
           its guess — every game mods differently, so check the guess against the game's or the mod's
           instructions.</p>
           <ul class="detected-list">${others.map(scanRow).join('')}</ul>`
        : ''
    }
    ${scanned.length ? '' : '<p class="hint-text">No Steam games were found on this PC.</p>'}
    <details id="otherGame" ${scanned.length ? '' : 'open'}>
      <summary>A game not on Steam…</summary>
      <div class="field">
        <label>The game's install folder</label>
        <div class="path-row">
          <input type="text" id="gameFolder" placeholder="e.g. C:\\Games\\Squad" readonly />
          <button class="secondary" id="gameFolderBrowse">Browse</button>
        </div>
        <p class="hint-text" id="guessResult"></p>
      </div>
    </details>
    <div id="setupForm" class="setup-form hidden">
      <h4 id="setupTitle"></h4>
      <p class="modal-note hidden" id="setupNote"></p>
      <div class="field">
        <label>Game name</label>
        <input type="text" id="newGameName" />
      </div>
      <div class="field">
        <label>How it loads mods</label>
        <select id="newGameStrategy">
          ${Object.entries(STRATEGY_LABELS).map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Mods folder</label>
        <div class="path-row">
          <input type="text" id="newGamePath" readonly />
          <button class="secondary" id="newGameBrowse">Browse</button>
        </div>
      </div>
      <div class="modal-actions">
        <button id="confirmAddGame">Add Game</button>
      </div>
    </div>
    <div class="modal-actions">
      <button class="secondary" id="cancelAddGame">Close</button>
    </div>
  `);

  // Fills the shared setup form. `guess` may be null (nothing recognised).
  function openSetup({ name, steamAppId, guess }) {
    setupAppId = steamAppId || null;
    document.getElementById('setupTitle').textContent = `Set up ${name}`;
    document.getElementById('newGameName').value = name;
    document.getElementById('newGameStrategy').value = guess ? guess.strategy : 'loose';
    document.getElementById('newGamePath').value = guess ? guess.modsPath : '';
    const note = document.getElementById('setupNote');
    note.textContent = guess
      ? `This is a guess from the folder layout (${guess.reason}). Check the game's modding ` +
        'instructions or a mod\'s readme to make sure this is where its mods go.'
      : 'The app couldn\'t find a mods folder. Check the game\'s modding instructions, then choose ' +
        'the folder its mods go in.';
    note.classList.remove('hidden');
    const form = document.getElementById('setupForm');
    form.classList.remove('hidden');
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  document.getElementById('cancelAddGame').addEventListener('click', hideModal);

  modalBox.querySelectorAll('[data-add]').forEach((btn) => {
    btn.addEventListener('click', () => addDetected(btn.getAttribute('data-add')));
  });

  modalBox.querySelectorAll('[data-setup]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const g = scanned.find((s) => s.steamAppId === btn.getAttribute('data-setup'));
      openSetup({ name: g.name, steamAppId: g.steamAppId, guess: g.status === 'guessed' ? g : null });
    });
  });

  document.getElementById('gameFolderBrowse').addEventListener('click', async () => {
    const folder = await window.modManager.chooseFolder();
    if (!folder) return;
    document.getElementById('gameFolder').value = folder;
    const guess = await window.modManager.guessGameFolder(folder);
    const result = document.getElementById('guessResult');
    document.getElementById('setupForm').classList.add('hidden');

    if (guess && guess.catalogId) {
      result.textContent = `That's ${guess.name} — adding it…`;
      await addDetected(guess.catalogId);
      return;
    }
    if (guess && guess.unsupported) {
      result.textContent = `${guess.name}: ${guess.unsupported}`;
      return;
    }
    result.textContent = '';
    openSetup({
      name: guess ? guess.name : folder.split(/[\\/]/).pop(),
      steamAppId: guess && guess.steamAppId,
      guess,
    });
  });

  document.getElementById('newGameBrowse').addEventListener('click', async () => {
    const folder = await window.modManager.chooseFolder();
    if (folder) document.getElementById('newGamePath').value = folder;
  });

  document.getElementById('confirmAddGame').addEventListener('click', async () => {
    const name = document.getElementById('newGameName').value.trim();
    const modsPath = document.getElementById('newGamePath').value.trim();
    const strategy = document.getElementById('newGameStrategy').value;
    if (!name || !modsPath) {
      showToast('Please enter a name and choose the mods folder.', true);
      return;
    }
    try {
      const game = await window.modManager.addGame({ name, modsPath, strategy, steamAppId: setupAppId });
      hideModal();
      await loadGames(game.id);
      showToast(`Added "${game.name}".`);
    } catch (err) {
      showToast(errorText(err), true);
    }
  });
}

async function addDetected(catalogId) {
  try {
    const game = await window.modManager.addDetectedGame(catalogId);
    hideModal();
    await loadGames(game.id);
    showToast(`Added "${game.name}". Mods go to ${game.modsPath}`);
  } catch (err) {
    showToast(errorText(err), true);
  }
}

// ---------- Game updates ----------

function isOlderThanGame(mod, game) {
  return Boolean(
    game && game.currentBuildId && mod.installedOnBuild && mod.installedOnBuild !== game.currentBuildId
  );
}

function renderGameUpdateBanner() {
  const game = currentGame();
  const activeMods = currentMods.filter(isWanted);
  if (!game || !game.updatedSinceLastCheck || activeMods.length === 0) {
    gameUpdateBanner.classList.add('hidden');
    return;
  }
  gameUpdateBanner.innerHTML = `
    <div>
      <strong>${esc(game.name)} has updated since your mods were added.</strong>
      Mods made for the old version can crash the game or quietly stop working. If something's
      wrong, ${game.switchable ? 'leave out' : 'deactivate'} the mods marked <em>Older than game update</em>.
      ${
        game.switchable
          ? 'Script Hook in particular stops working after each game update until its author ' +
            'releases a matching version, so modded mode may fail to start until you add that.'
          : ''
      }
    </div>
    <button class="secondary" id="ackGameUpdate">My mods work</button>
  `;
  gameUpdateBanner.classList.remove('hidden');
  document.getElementById('ackGameUpdate').addEventListener('click', async () => {
    await window.modManager.acknowledgeGameUpdate(game.id);
    await loadGames(game.id);
  });
}

// ---------- Modded / clean (GTA V, RDR2) ----------

function unexpectedFilesHtml(check) {
  const unknown = check.unexpected.filter((u) => !u.isMod);
  return `
    <div class="folder-check bad">
      <strong>Not safe for online:</strong> the game folder has files that aren't part of the clean game.
      <ul class="modal-list">
        ${check.unexpected
          .map((u) => `<li>${esc(u.name)} — ${u.isMod ? 'a mod file' : 'unknown (maybe from a game update)'}</li>`)
          .join('')}
      </ul>
      <p class="hint-text">The app didn't put ${check.unexpected.length === 1 ? 'this' : 'these'} there, so it
      won't delete ${check.unexpected.length === 1 ? 'it' : 'them'}. Remove mod files from the game folder
      yourself${unknown.length ? ', and mark files from a game update as game files' : ''}.</p>
      <div class="mode-actions">
        <button class="secondary" id="openGameFolder">Open game folder</button>
        ${unknown.length ? '<button class="secondary" id="trustFiles">The unknown ones are game files</button>' : ''}
        <button class="secondary" id="recheckFolder">Check again</button>
      </div>
    </div>`;
}

async function renderModePanel() {
  const game = currentGame();
  dropZone.classList.toggle('compact', Boolean(game && game.switchable));
  if (!game || !game.switchable) {
    modePanel.classList.add('hidden');
    return;
  }

  const modded = game.mode === 'modded';
  let check = { clean: true, unexpected: [] };
  if (!modded) {
    try {
      check = await window.modManager.checkGameFolder(game.id);
    } catch (err) {
      window.modManager.log('check-game-folder: ' + errorText(err));
    }
  }
  const inSet = currentMods.filter(isWanted).length;

  modePanel.innerHTML = `
    <div class="mode-head">
      <div>
        <div class="mode-title">
          ${
            modded
              ? '<span class="badge warn">Modded</span> Mods are in the game folder — story mode only'
              : check.clean
                ? '<span class="badge on">Clean</span> No mods in the game folder — safe for online'
                : '<span class="badge danger">Not clean</span> The app\'s mods are out, but other files are in the game folder'
          }
        </div>
        <p class="hint-text">${esc(game.moddedNote)}</p>
      </div>
    </div>
    <div class="mode-actions">
      <button id="playModded" ${inSet ? '' : 'disabled title="Add a mod first"'}>Play modded (story)</button>
      <button class="secondary" id="playOnline">Play online (clean)</button>
      ${modded ? '<button class="secondary" id="makeClean">Take mods out now</button>' : ''}
    </div>
    ${!modded && !check.clean ? unexpectedFilesHtml(check) : ''}
  `;
  modePanel.classList.remove('hidden');

  document.getElementById('playModded').addEventListener('click', () => playGame(game, 'modded'));
  document.getElementById('playOnline').addEventListener('click', () => playGame(game, 'online'));
  const makeClean = document.getElementById('makeClean');
  if (makeClean) {
    makeClean.addEventListener('click', async () => {
      try {
        const result = await window.modManager.setGameMode({ gameId: game.id, mode: 'clean' });
        await loadGames(game.id);
        if (result.errors.length) showResults("Some mods couldn't be taken out", result.errors);
        else showToast(result.clean ? 'Mods taken out. The game folder is clean.' : 'Mods taken out, but other files need a look.');
      } catch (err) {
        showToast(errorText(err), true);
      }
    });
  }
  const openFolder = document.getElementById('openGameFolder');
  if (openFolder) openFolder.addEventListener('click', () => window.modManager.openGameFolder(game.id));
  const recheck = document.getElementById('recheckFolder');
  if (recheck) recheck.addEventListener('click', () => loadMods());
  const trust = document.getElementById('trustFiles');
  if (trust) {
    trust.addEventListener('click', async () => {
      const names = check.unexpected.filter((u) => !u.isMod).map((u) => u.name);
      await window.modManager.trustGameFiles({ gameId: game.id, names });
      showToast(`Marked ${names.length} file${names.length === 1 ? '' : 's'} as part of the game.`);
      loadMods();
    });
  }
}

async function playGame(game, mode) {
  if (mode === 'modded' && game.id === 'rdr2') {
    const ok = await confirmModal(
      'Play RDR2 with mods?',
      'RDR2 has no offline-only switch. When the game opens, choose <strong>Story Mode</strong> — never ' +
        'Red Dead Online while mods are in. Use <strong>Play online</strong> here to take them out first.',
      'Start story mode'
    );
    if (!ok) return;
  }
  showToast(mode === 'modded' ? 'Putting mods in and starting the game…' : 'Taking mods out and checking the folder…', false, true);
  try {
    const result = await window.modManager.launchGame({ gameId: game.id, mode });
    await loadGames(game.id);
    if (result.launched) {
      showToast(
        mode === 'modded'
          ? `Starting ${game.name} with mods through Steam. Steam may ask you to allow the launch options.`
          : `Game folder is clean. Starting ${game.name} through Steam.`
      );
    } else if (result.errors && result.errors.length) {
      toastEl.classList.add('hidden');
      showResults(`Didn't start ${game.name}`, result.errors);
    } else {
      toastEl.classList.add('hidden');
      showResults(`Didn't start ${game.name} online`, [
        'The game folder still has files that aren\'t part of the clean game — see the list under the mode buttons.',
      ]);
    }
  } catch (err) {
    showToast(errorText(err), true);
  }
}

function confirmModal(title, bodyHtml, confirmLabel) {
  return new Promise((resolve) => {
    showModal(`
      <h3>${esc(title)}</h3>
      <p>${bodyHtml}</p>
      <div class="modal-actions">
        <button class="secondary" id="confirmNo">Cancel</button>
        <button id="confirmYes">${esc(confirmLabel)}</button>
      </div>
    `);
    document.getElementById('confirmNo').addEventListener('click', () => {
      hideModal();
      resolve(false);
    });
    document.getElementById('confirmYes').addEventListener('click', () => {
      hideModal();
      resolve(true);
    });
  });
}

// ---------- Mods ----------

function modDetails(m) {
  const parts = [`Added ${new Date(m.installedAt).toLocaleString()}`];
  for (const p of m.placements || []) {
    if (p.label && p.files && p.files.length) parts.push(`${p.label} added`);
  }
  if (m.skippedFiles) {
    parts.push(`${m.skippedFiles} extra file${m.skippedFiles === 1 ? '' : 's'} (readme etc.) left out`);
  }
  return parts.join(' · ');
}

async function loadMods() {
  currentMods = currentGameId ? await window.modManager.getMods(currentGameId) : [];
  const game = currentGame();
  renderGameUpdateBanner();
  await renderModePanel();
  profilesBtn.disabled = !currentGameId;
  const switchable = Boolean(game && game.switchable);

  if (currentMods.length === 0) {
    modListEl.innerHTML = switchable
      ? `<li class="empty-state">No mods yet. Most ${esc(game.name)} mods need
         ${game.id === 'rdr2' ? 'Script Hook RDR2' : 'Script Hook V'} first: download it from its
         author's site and drop the zip here.</li>`
      : '<li class="empty-state">No mods installed yet. Drag mod files above to get started.</li>';
    return;
  }
  modListEl.innerHTML = currentMods
    .map((m) => {
      const active = isWanted(m);
      const older = active && isOlderThanGame(m, game);
      const badge = switchable
        ? active ? 'In modded set' : 'Left out'
        : active ? 'In game' : 'Not in game';
      const toggle = switchable ? (active ? 'Leave out' : 'Include') : active ? 'Deactivate' : 'Activate';
      return `
      <li class="${active ? '' : 'inactive'}">
        <div class="mod-info">
          <div class="mod-name">
            ${esc(m.name)}
            <span class="badge ${active ? 'on' : 'off'}">${badge}</span>
            ${older ? '<span class="badge warn" title="Added before the game\'s latest update">Older than game update</span>' : ''}
          </div>
          <div class="mod-date">${esc(modDetails(m))}</div>
        </div>
        <div class="mod-actions">
          <button class="secondary" data-toggle="${esc(m.id)}" data-active="${active}">
            ${toggle}
          </button>
          <button class="danger" data-remove="${esc(m.id)}">Remove</button>
        </div>
      </li>`;
    })
    .join('');

  modListEl.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => promptRemove(btn.getAttribute('data-remove')));
  });

  modListEl.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const modId = btn.getAttribute('data-toggle');
      const makeActive = btn.getAttribute('data-active') !== 'true';
      btn.disabled = true;
      try {
        const mod = await window.modManager.setModActive({ modId, active: makeActive });
        await loadMods();
        if (switchable) {
          showToast(
            makeActive
              ? `"${mod.name}" is in the modded set${game.mode === 'modded' ? ' and the game folder' : ''}.`
              : `"${mod.name}" left out of modded mode, still saved in the app.`
          );
        } else {
          showToast(
            makeActive
              ? `"${mod.name}" is back in the game folder.`
              : `"${mod.name}" removed from the game, still saved in the app.`
          );
        }
      } catch (err) {
        btn.disabled = false;
        showToast(errorText(err), true);
      }
    });
  });
}

function promptRemove(modId) {
  const mod = currentMods.find((m) => m.id === modId);
  showModal(`
    <h3>Remove "${esc(mod.name)}" completely?</h3>
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
      showToast(errorText(err), true);
    }
  });
}

// ---------- Profiles ----------

profilesBtn.addEventListener('click', openProfiles);

async function openProfiles() {
  const game = currentGame();
  if (!game) return;
  const profiles = await window.modManager.getProfiles(game.id);
  const activeCount = currentMods.filter(isWanted).length;
  const modName = (id) => (currentMods.find((m) => m.id === id) || {}).name;

  const rows = profiles
    .map(
      (p) => `
      <li>
        <div class="mod-info">
          <div class="mod-name">${esc(p.name)}</div>
          <div class="mod-date" title="${esc(p.modIds.map(modName).join('\n'))}">
            ${p.modIds.length ? `${p.modIds.length} mod${p.modIds.length === 1 ? '' : 's'}` : 'No mods (vanilla)'}
          </div>
        </div>
        <div class="mod-actions">
          <button data-apply="${esc(p.id)}">Use</button>
          <button class="danger" data-delete="${esc(p.id)}">Delete</button>
        </div>
      </li>`
    )
    .join('');

  showModal(`
    <h3>${esc(game.name)} profiles</h3>
    <p class="hint-text">A profile remembers which mods are ${game.switchable ? 'in the modded set' : 'in the game'}.
    Using one puts exactly those mods in and takes the rest out (they stay saved in the app).</p>
    ${profiles.length ? `<ul class="detected-list">${rows}</ul>` : ''}
    <div class="field">
      <label>Save the ${activeCount} mod${activeCount === 1 ? '' : 's'} ${game.switchable ? 'in the modded set' : 'in the game'} now as</label>
      <div class="path-row">
        <input type="text" id="profileName" placeholder="e.g. Co-op night, Vanilla" />
        <button id="saveProfile">Save</button>
      </div>
    </div>
    <div class="modal-actions">
      <button class="secondary" id="closeProfiles">Close</button>
    </div>
  `);

  document.getElementById('closeProfiles').addEventListener('click', hideModal);
  document.getElementById('saveProfile').addEventListener('click', async () => {
    try {
      const profile = await window.modManager.saveProfile({
        gameId: game.id,
        name: document.getElementById('profileName').value,
      });
      showToast(`Saved profile "${profile.name}".`);
      openProfiles();
    } catch (err) {
      showToast(errorText(err), true);
    }
  });

  modalBox.querySelectorAll('[data-apply]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const profile = profiles.find((p) => p.id === btn.getAttribute('data-apply'));
      btn.disabled = true;
      showToast(`Switching to "${profile.name}"…`, false, true);
      try {
        const { errors } = await window.modManager.applyProfile(profile.id);
        hideModal();
        await loadMods();
        if (errors.length) showResults(`Switched to "${profile.name}", with problems`, errors);
        else showToast(`Now using "${profile.name}".`);
      } catch (err) {
        btn.disabled = false;
        showToast(errorText(err), true);
      }
    });
  });

  modalBox.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await window.modManager.deleteProfile(btn.getAttribute('data-delete'));
      openProfiles();
    });
  });
}

// ---------- Installing ----------

function showResults(title, lines) {
  showModal(`
    <h3>${esc(title)}</h3>
    <ul class="modal-list">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
    <div class="modal-actions"><button id="closeResults">OK</button></div>
  `);
  document.getElementById('closeResults').addEventListener('click', hideModal);
}

// Installs one after another — archives can be several GB, and each install
// has to see the files the previous one put down to catch conflicts.
async function installAll(paths) {
  if (installing) {
    showToast('Still installing — drop the next ones when it finishes.', true);
    return;
  }
  installing = true;
  const failures = [];
  let installed = 0;
  try {
    for (const [i, zipPath] of paths.entries()) {
      const fileName = String(zipPath).split(/[\\/]/).pop();
      const counter = paths.length > 1 ? ` (${i + 1} of ${paths.length})` : '';
      showToast(`Installing "${fileName}"${counter}…`, false, true);
      try {
        const mod = await window.modManager.installMod({ gameId: currentGameId, zipPath });
        installed += 1;
        await loadMods();
        if (mod.originalRemoveError) {
          failures.push(`${fileName}: installed, but couldn't move the original to the Recycle Bin (${mod.originalRemoveError})`);
        }
      } catch (err) {
        failures.push(`${fileName}: ${errorText(err)}`);
      }
    }
  } finally {
    installing = false;
  }

  if (failures.length === 0) {
    showToast(
      installed === 1
        ? 'Installed. The original file was moved to the Recycle Bin.'
        : `Installed ${installed} mods. The original files were moved to the Recycle Bin.`
    );
  } else if (paths.length === 1 && installed === 0) {
    toastEl.classList.add('hidden');
    showResults("Couldn't install that mod", failures);
  } else {
    toastEl.classList.add('hidden');
    showResults(`Installed ${installed} of ${paths.length}`, failures);
  }
}

function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  window.modManager.log(`drop: ${files.length} item(s): ` + files.map((f) => f.name).join(', '));

  if (!currentGameId) {
    showToast('Add a game first.', true);
    return;
  }
  if (files.length === 0) {
    showToast('Nothing was dropped. Try the Browse button instead.', true);
    return;
  }

  const zipFiles = files.filter((f) => SUPPORTED_EXTS.some((ext) => f.name.toLowerCase().endsWith(ext)));
  const rejected = files.filter((f) => !zipFiles.includes(f));
  if (rejected.length) {
    showToast(
      `Skipped ${rejected.map((f) => f.name).join(', ')} — this app accepts .zip, .rar and .7z mod files.`,
      true
    );
  }

  const paths = [];
  for (const f of zipFiles) {
    const resolved = window.modManager.getFilePath(f);
    if (resolved) paths.push(resolved);
    else showToast(`Couldn't read the location of "${f.name}". Use the Browse button instead.`, true);
  }
  if (paths.length) installAll(paths);
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
  if (!currentGameId) {
    showToast('Add a game first.', true);
    return;
  }
  const paths = await window.modManager.chooseZips();
  if (paths.length) installAll(paths);
});

window.addEventListener('error', (e) => {
  window.modManager.log('uncaught error: ' + (e.error && e.error.stack ? e.error.stack : e.message));
  showToast('Error: ' + e.message, true);
});

// ---------- App updates ----------

window.modManager.onUpdateReady((version) => {
  appUpdateBar.innerHTML = `
    <span>Mod Manager ${esc(version)} is ready.</span>
    <button id="restartToUpdate">Restart to update</button>
  `;
  appUpdateBar.classList.remove('hidden');
  document.getElementById('restartToUpdate').addEventListener('click', () => window.modManager.installAppUpdate());
});

loadGames();
