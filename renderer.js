const gameSelect = document.getElementById('gameSelect');
const addGameBtn = document.getElementById('addGameBtn');
const dropZone = document.getElementById('dropZone');
const browseBtn = document.getElementById('browseBtn');
const modListEl = document.getElementById('modList');
const profilesBtn = document.getElementById('profilesBtn');
const gameUpdateBanner = document.getElementById('gameUpdateBanner');
const modePanel = document.getElementById('modePanel');
const crashBanner = document.getElementById('crashBanner');
const crashBtn = document.getElementById('crashBtn');
const vanillaBtn = document.getElementById('vanillaBtn');
const appUpdateBar = document.getElementById('appUpdateBar');
const modalOverlay = document.getElementById('modalOverlay');
const modalBox = document.getElementById('modalBox');
const toastEl = document.getElementById('toast');

// .kspkg is Assetto Corsa EVO's car package, droppable on its own.
const SUPPORTED_EXTS = ['.zip', '.rar', '.7z', '.kspkg'];

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

// Set while a modal needs to clean up when it's dismissed by clicking outside
// it (the install preview discards its staged mods).
let modalOnDismiss = null;

modalOverlay.addEventListener('click', (e) => {
  if (e.target !== modalOverlay) return;
  if (modalOnDismiss) modalOnDismiss();
  else hideModal();
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
  } else if (g.status === 'elsewhere') {
    detail = g.reason;
    action = '<span class="badge off">Modded elsewhere</span>';
  } else {
    detail = g.reason;
    action = '';
  }
  if (g.added) action = '<span class="badge on">Added</span>';

  return `
    <li class="${g.status === 'unsupported' || g.status === 'elsewhere' ? 'unsupported' : ''}">
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
  const staleHook = outdatedScriptHook(game);
  const missing = currentMods.filter((m) => isWanted(m) && m.missing && m.missing.length);

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
    ${
      staleHook
        ? `<div class="folder-check warn-box"><strong>${esc(game.name)} has updated since ${esc(staleHook.provides)} was added.</strong>
           Script Hook only works with the game version it was made for, so modded mode will probably fail
           to start. Get the newest ${esc(staleHook.provides)} from its author and drop the zip here — it
           replaces the old one.</div>`
        : ''
    }
    ${
      missing.length
        ? `<div class="folder-check warn-box"><strong>Missing for modded mode:</strong>
           <ul class="modal-list">${missing
             .map((m) => `<li>${esc(m.name)} needs ${esc(m.missing.join(', '))}</li>`)
             .join('')}</ul></div>`
        : ''
    }
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

// The Script Hook mod in the modded set, if the game has updated since it was
// added. Script Hook refuses to run on a game version it doesn't know.
function outdatedScriptHook(game) {
  if (!game || !game.currentBuildId) return null;
  const hook = currentMods.find(
    (m) => isWanted(m) && (m.provides || []).some((p) => p === 'Script Hook V' || p === 'Script Hook RDR2')
  );
  if (!hook || !hook.installedOnBuild || hook.installedOnBuild === game.currentBuildId) return null;
  return { name: hook.name, provides: hook.provides.find((p) => p.startsWith('Script Hook')) };
}

async function playGame(game, mode) {
  const staleHook = mode === 'modded' && outdatedScriptHook(game);
  if (staleHook) {
    const ok = await confirmModal(
      `${staleHook.provides} is probably out of date`,
      `${esc(game.name)} has updated since ${esc(staleHook.provides)} was added, and Script Hook only runs ` +
        'on the game version it was made for. The game may close at startup or run without mods. ' +
        `Get the newest ${esc(staleHook.provides)} from its author and drop the zip here to replace it.`,
      'Start anyway'
    );
    if (!ok) return;
  }
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
  const parts = [`${m.kind ? m.kind + ' · ' : ''}Added ${new Date(m.installedAt).toLocaleString()}`];
  for (const p of m.placements || []) {
    // Only extras outside the main mods folder (e.g. a WorldGen save) are named.
    if (p.to && p.label && p.files && p.files.length) parts.push(`${p.label} added`);
  }
  if (m.skippedFiles) {
    parts.push(`${m.skippedFiles} extra file${m.skippedFiles === 1 ? '' : 's'} (readme etc.) left out`);
  }
  return parts.join(' · ');
}

// ---------- Crash helper ----------

function renderCrashBanner() {
  const game = currentGame();
  crashBtn.classList.toggle('hidden', !(game && game.hasDiagnostics));
  if (!game || !game.newCrashAt) {
    crashBanner.classList.add('hidden');
    return;
  }
  crashBanner.innerHTML = `
    <div><strong>${esc(game.name)} crashed</strong> on ${esc(new Date(game.newCrashAt).toLocaleString())}.
    The app can read the crash report and point at the mods most likely involved.</div>
    <div class="mode-actions" style="margin:0">
      <button id="crashBannerOpen">Find the cause</button>
      <button class="secondary" id="crashBannerDismiss">Dismiss</button>
    </div>`;
  crashBanner.classList.remove('hidden');
  document.getElementById('crashBannerOpen').addEventListener('click', openCrashReport);
  document.getElementById('crashBannerDismiss').addEventListener('click', async () => {
    await window.modManager.acknowledgeCrash(game.id);
    await loadGames(game.id);
  });
}

crashBtn.addEventListener('click', openCrashReport);

async function openCrashReport() {
  const game = currentGame();
  if (!game) return;
  const r = await window.modManager.analyzeCrash(game.id);
  await window.modManager.acknowledgeCrash(game.id);
  const when = (t) => new Date(t).toLocaleString();
  const section = (title, body) => `<h4>${title}</h4>${body}`;
  const list = (items) => `<ul class="modal-list">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;

  const suspects = [];
  if (r.mentioned.length) {
    suspects.push(
      section(
        'Named in the crash report or logs',
        list(
          r.mentioned.map(
            (m) =>
              `<strong>${esc(m.name)}</strong>${m.nearError ? ' <span class="badge danger">right at an error</span>' : ''}` +
              `<div class="log-line">${esc(m.line)}</div>`
          )
        )
      )
    );
  }
  if (r.outdated.length) {
    suspects.push(section('Added before the latest game update', list(r.outdated.map(esc))));
  }
  if (r.recent.length) {
    suspects.push(
      section(
        'Added most recently',
        list(r.recent.map((m) => `${esc(m.name)} <span class="hint-text">(${esc(when(m.installedAt))})</span>`))
      )
    );
  }

  showModal(`
    <h3>Why did ${esc(r.gameName)} crash?</h3>
    ${
      r.crash
        ? `<p class="hint-text">Newest crash report: ${esc(when(r.crash.time))}</p>`
        : '<p class="hint-text">No crash report found — this is based on the game\'s logs.</p>'
    }
    ${
      suspects.length
        ? suspects.join('')
        : '<p>No mod stands out. If the game keeps crashing, take mods out half at a time (or use Back to vanilla) to narrow it down.</p>'
    }
    <p class="modal-note">The fastest check: take the top suspect out (Deactivate / Leave out), play again,
    and see if the crash stops.</p>
    ${
      r.errorLines.length
        ? `<details><summary>Error lines from the logs (${r.errorLines.length})</summary>
           <div class="log-lines">${r.errorLines.map((l) => `<div class="log-line">${esc(l)}</div>`).join('')}</div></details>`
        : ''
    }
    ${
      r.filesRead.length
        ? `<details><summary>Files read (${r.filesRead.length})</summary>
           ${list(r.filesRead.map((f) => `${esc(f.file)} <span class="hint-text">(${esc(when(f.time))})</span>`))}</details>`
        : ''
    }
    <div class="modal-actions"><button id="closeCrash">Close</button></div>
  `);
  document.getElementById('closeCrash').addEventListener('click', hideModal);
  renderCrashBanner();
  crashBanner.classList.add('hidden');
}

// ---------- Back to vanilla ----------

vanillaBtn.addEventListener('click', async () => {
  const game = currentGame();
  if (!game) return;
  const ok = await confirmModal(
    `Take every mod out of ${game.name}?`,
    game.switchable
      ? 'All the app\'s mods come out of the game folder, the same as clean mode. They stay saved in the app.'
      : 'All the app\'s mods come out of the game folder and stay saved in the app. Your current set is saved ' +
          'as the profile <strong>Before vanilla</strong>, so Profiles → Use puts them all back in one click. ' +
          'Files the app didn\'t install (for example mods copied in by hand) aren\'t touched.',
    'Back to vanilla'
  );
  if (!ok) return;
  try {
    const result = await window.modManager.goVanilla(game.id);
    await loadGames(game.id);
    if (result.errors.length) showResults("Some mods couldn't be taken out", result.errors);
    else showToast(`${game.name} is vanilla.${result.profileName ? ` Your mods are saved as "${result.profileName}".` : ''}`);
  } catch (err) {
    showToast(errorText(err), true);
  }
});

async function loadMods() {
  currentMods = currentGameId ? await window.modManager.getMods(currentGameId) : [];
  const game = currentGame();
  renderGameUpdateBanner();
  renderCrashBanner();
  await renderModePanel();
  profilesBtn.disabled = !currentGameId;
  vanillaBtn.disabled = !currentMods.some((m) => m.active !== false);
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
            ${
              active && m.missing && m.missing.length
                ? `<span class="badge danger" title="Add a mod that provides this">Needs ${esc(m.missing.join(', '))}</span>`
                : ''
            }
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

function fileListHtml(files, max = 8) {
  const shown = files.slice(0, max).map((f) => `<li>${esc(f)}</li>`).join('');
  const more = files.length > max ? `<li class="hint-text">…and ${files.length - max} more</li>` : '';
  return `<ul class="file-list">${shown}${more}</ul>`;
}

// The version picker for archives that hold alternatives or optional extras.
function variantPickerHtml(s, index) {
  if (!s.variants) return '';
  return `
    <div class="folder-check warn-box variant-picker">
      <strong>${
        s.variants.groups.some((g) => g.id === '')
          ? 'This archive has optional parts.'
          : 'This archive holds more than one version.'
      }</strong>
      Each folder below is a separate version or an optional extra — pick what you want installed.
      ${s.variants.groups
        .map(
          (g) => `
        <label class="variant-option">
          <input type="checkbox" data-variant-index="${index}" value="${esc(g.id)}" ${g.selected ? 'checked' : ''} />
          ${esc(g.label)} <span class="hint-text">(${g.count} .pak file${g.count === 1 ? '' : 's'})</span>
        </label>`
        )
        .join('')}
      ${s.pickError ? `<p class="pick-error">That combination didn't work, so the previous choice is kept: ${esc(s.pickError)}</p>` : ''}
    </div>`;
}

function previewCardHtml(s, index) {
  return `
    <div class="preview-mod">
      <div class="mod-name">${esc(s.name)} ${s.kind ? `<span class="badge on">${esc(s.kind)}</span>` : ''}</div>
      ${variantPickerHtml(s, index)}
      ${
        s.replaces && s.replaces.length
          ? `<p class="modal-note">Replaces the older <strong>${esc(s.replaces.join(', '))}</strong> — it's removed
             (to the Recycle Bin) when this is installed.</p>`
          : ''
      }
      ${
        s.missing && s.missing.length
          ? `<div class="folder-check warn-box"><strong>Needs ${esc(s.missing.join(', '))}</strong>, which isn't
             installed. It can be installed now, but won't work until you add ${s.missing.length === 1 ? 'it' : 'them'}.</div>`
          : ''
      }
      ${s.notes.map((n) => `<p class="modal-note">${esc(n)}</p>`).join('')}
      ${s.destinations
        .map(
          (d) => `
        <div class="dest">
          <div><strong>${esc(d.label)}</strong>${d.optional ? ' <span class="hint-text">(only if not already there)</span>' : ''}</div>
          <div class="dest-path">${esc(d.dir)}</div>
          ${fileListHtml(d.files)}
        </div>`
        )
        .join('')}
      ${
        s.skippedCount
          ? `<details><summary>${s.skippedCount} file${s.skippedCount === 1 ? '' : 's'} left out — not used by the game</summary>
             ${fileListHtml(s.skipped, 20)}</details>`
          : ''
      }
    </div>`;
}

// Shows where every file of the staged mods will go, and resolves true when
// the user confirms. Closing the window any other way cancels. Picking a
// different version re-sorts that mod at once (replacing its entry in
// `summaries`), so the file list always shows exactly what will go in.
// `zipPaths[i]` is the file behind `summaries[i]`.
function confirmInstall(summaries, failures, zipPaths) {
  return new Promise((resolve) => {
    const finish = (ok) => {
      modalOnDismiss = null;
      hideModal();
      resolve(ok);
    };
    modalOnDismiss = () => finish(false);
    let resorting = false;

    const render = () => {
      const waiting = summaries.filter((s) => s.needsChoice).length;
      const scroll = modalBox.scrollTop;
      showModal(`
        <h3>${summaries.length === 1 ? 'Install this mod?' : `Install ${summaries.length} mods?`}</h3>
        <p class="hint-text">Here's what the app found in ${summaries.length === 1 ? 'it' : 'each one'} and
        exactly where every file will go. Nothing has been put in the game yet.</p>
        ${
          failures.length
            ? `<div class="folder-check bad"><strong>Can't be installed:</strong>
               <ul class="modal-list">${failures.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>`
            : ''
        }
        ${summaries.map(previewCardHtml).join('')}
        <div class="modal-actions">
          <button class="secondary" id="cancelInstall">Cancel</button>
          <button id="confirmInstall" ${waiting ? 'disabled title="Pick a version first"' : ''}>
            ${summaries.length === 1 ? 'Install' : `Install ${summaries.length} mods`}
          </button>
        </div>
      `);
      modalBox.scrollTop = scroll;
      document.getElementById('cancelInstall').addEventListener('click', () => finish(false));
      document.getElementById('confirmInstall').addEventListener('click', () => finish(true));

      modalBox.querySelectorAll('[data-variant-index]').forEach((box) => {
        box.addEventListener('change', async () => {
          // One re-sort at a time; ticks made meanwhile are ignored.
          if (resorting) return;
          resorting = true;
          const i = Number(box.getAttribute('data-variant-index'));
          const old = summaries[i];
          const picked = [...modalBox.querySelectorAll(`[data-variant-index="${i}"]`)]
            .filter((b) => b.checked)
            .map((b) => b.value);
          modalBox.querySelectorAll('input, button').forEach((el) => (el.disabled = true));
          try {
            // The new choice is sorted before the old one is thrown away, so a
            // choice that doesn't work leaves the previous one in place.
            summaries[i] = await window.modManager.stageMod({
              gameId: currentGameId,
              zipPath: zipPaths[i],
              variants: picked,
              replacingStageId: old.stageId,
            });
            await window.modManager.discardStaged(old.stageId);
          } catch (err) {
            summaries[i] = { ...old, pickError: errorText(err) };
          } finally {
            resorting = false;
          }
          render();
        });
      });
    };
    render();
  });
}

// Two passes: first every archive is unpacked and sorted (nothing touches the
// game), then — once the user has seen where everything goes — each is put
// in, one after another, so each install sees the files of the one before.
async function installAll(paths) {
  if (installing) {
    showToast('Still installing — drop the next ones when it finishes.', true);
    return;
  }
  installing = true;
  const failures = [];
  const summaries = [];
  const stagedPaths = [];
  let installed = 0;
  try {
    for (const [i, zipPath] of paths.entries()) {
      const fileName = String(zipPath).split(/[\\/]/).pop();
      const counter = paths.length > 1 ? ` (${i + 1} of ${paths.length})` : '';
      showToast(`Checking "${fileName}"${counter}…`, false, true);
      try {
        summaries.push(await window.modManager.stageMod({ gameId: currentGameId, zipPath }));
        stagedPaths.push(zipPath);
      } catch (err) {
        failures.push(`${fileName}: ${errorText(err)}`);
      }
    }
    toastEl.classList.add('hidden');

    if (summaries.length === 0) {
      showResults(paths.length === 1 ? "Couldn't install that mod" : "Couldn't install any of those mods", failures);
      return;
    }
    if (!(await confirmInstall(summaries, failures, stagedPaths))) {
      for (const s of summaries) await window.modManager.discardStaged(s.stageId);
      showToast('Cancelled — nothing was installed.');
      return;
    }

    const problems = [];
    for (const s of summaries) {
      showToast(`Installing "${s.name}"…`, false, true);
      try {
        const mod = await window.modManager.commitStaged(s.stageId);
        installed += 1;
        if (mod.originalRemoveError) {
          problems.push(`${s.name}: installed, but couldn't move the original to the Recycle Bin (${mod.originalRemoveError})`);
        }
      } catch (err) {
        problems.push(`${s.name}: ${errorText(err)}`);
      }
    }
    await loadMods();
    if (problems.length) {
      toastEl.classList.add('hidden');
      showResults(`Installed ${installed} of ${summaries.length}`, problems);
    } else {
      showToast(
        installed === 1
          ? 'Installed. The original file was moved to the Recycle Bin.'
          : `Installed ${installed} mods. The original files were moved to the Recycle Bin.`
      );
    }
  } finally {
    installing = false;
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
