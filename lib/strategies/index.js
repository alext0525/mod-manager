const paks = require('./paks');
const beamng = require('./beamng');
const loose = require('./loose');
const rockstar = require('./rockstar');
const assettocorsa = require('./assettocorsa');
const kspkg = require('./kspkg');
const chromepaks = require('./chromepaks');
const witcher3 = require('./witcher3');

const STRATEGIES = { paks, beamng, loose, rockstar, assettocorsa, kspkg, chromepaks, witcher3 };

function getStrategy(id) {
  const strategy = STRATEGIES[id || 'paks'];
  if (!strategy) throw new Error(`Unknown install type: ${id}`);
  return strategy;
}

module.exports = { getStrategy, STRATEGIES };
