const paks = require('./paks');
const beamng = require('./beamng');
const loose = require('./loose');

const STRATEGIES = { paks, beamng, loose };

function getStrategy(id) {
  const strategy = STRATEGIES[id || 'paks'];
  if (!strategy) throw new Error(`Unknown install type: ${id}`);
  return strategy;
}

module.exports = { getStrategy, STRATEGIES };
