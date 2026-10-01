const fs   = require('fs');
const path = require('path');

const { openStore } = require('./store');
const { WORKSPACE } = require('./workspace');

const SANDBOX = process.env.LEARNO_MODE === 'sandbox';
const DB_PATH = process.env.LEARNO_DB || path.join(WORKSPACE, 'learno.db');

let _store;

// Fixture dates are relative ({ "$daysFromNow": -3 }) so seeded reviews stay due
// whenever the sandbox runs; fixed timestamps would silently empty that section.
function resolveDates(value) {
  if (Array.isArray(value)) return value.map(resolveDates);
  if (value && typeof value === 'object') {
    if (typeof value.$daysFromNow === 'number') {
      const d = new Date();
      d.setDate(d.getDate() + value.$daysFromNow);
      return d;
    }
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolveDates(v)])
    );
  }
  return value;
}

function loadSeed() {
  const seedPath = process.env.LEARNO_SEED
    || path.join(__dirname, '..', 'sandbox', 'fixtures', 'seed.json');

  if (!fs.existsSync(seedPath)) {
    console.warn(`sandbox: no seed file at ${seedPath} — starting empty`);
    return {};
  }

  try {
    return resolveDates(JSON.parse(fs.readFileSync(seedPath, 'utf8')));
  } catch (err) {
    console.error(`sandbox: could not parse ${seedPath} — starting empty\n  ${err.message}`);
    return {};
  }
}

function getStore() {
  if (_store) return _store;

  if (SANDBOX) {
    _store = openStore(':memory:');
    _store.seed(loadSeed());
  } else {
    _store = openStore(DB_PATH);
  }
  return _store;
}

module.exports = { getStore, SANDBOX, DB_PATH };
