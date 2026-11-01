const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./paths');
const modStore = require('./modStore');

// A profile is a named set of mods for one game, e.g. "Co-op night" or
// "Vanilla". Applying one puts exactly those mods in the game.
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');

function loadAll() {
  if (!fs.existsSync(PROFILES_FILE)) return [];
  return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf-8'));
}

function saveAll(profiles) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2));
}

// Mods removed since a profile was saved are simply left out.
function listProfiles(gameId) {
  const modIds = new Set(modStore.loadMods().map((m) => m.id));
  return loadAll()
    .filter((p) => p.gameId === gameId)
    .map((p) => ({ ...p, modIds: p.modIds.filter((id) => modIds.has(id)) }));
}

// Saves the mods currently in the game under `name`, replacing a profile
// of the same name.
function saveCurrentAs({ gameId, name }) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Give the profile a name.');
  const modIds = modStore
    .loadMods()
    .filter((m) => m.gameId === gameId && modStore.isWanted(m))
    .map((m) => m.id);

  const profiles = loadAll();
  const existing = profiles.find(
    (p) => p.gameId === gameId && p.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (existing) {
    existing.modIds = modIds;
  } else {
    profiles.push({ id: crypto.randomUUID(), gameId, name: trimmed, modIds });
  }
  saveAll(profiles);
  return existing || profiles[profiles.length - 1];
}

function getProfile(profileId) {
  const profile = loadAll().find((p) => p.id === profileId);
  if (!profile) throw new Error('That profile no longer exists.');
  return profile;
}

function deleteProfile(profileId) {
  saveAll(loadAll().filter((p) => p.id !== profileId));
}

module.exports = { listProfiles, saveCurrentAs, getProfile, deleteProfile };
