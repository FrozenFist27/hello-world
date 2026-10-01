const path = require('path');

const { WORKSPACE, DASHBOARD_PATH } = require('./workspace');

// Must stay above the ./db require, which reads LEARNO_MODE at import time.
require('dotenv').config({ path: path.join(WORKSPACE, '.env') });

const express = require('express');
const cors    = require('cors');

const { SANDBOX, DB_PATH, getStore } = require('./db');
const { graderName, describeGrader } = require('./grader');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, mode: SANDBOX ? 'sandbox' : 'live', grader: SANDBOX ? 'stub' : graderName(), ts: new Date().toISOString() })
);
app.use('/api/validate', require('./routes/validate'));
app.use('/api/progress', require('./routes/progress'));
app.use('/api/catalog', require('./routes/catalog'));
app.use('/api/next', require('./routes/next'));
app.use(require('./routes/localized'));

// Declared before the static handler so it wins over any stray index.html.
app.use('/', require('./routes/home'));

// Mounted from the engine root, not the workspace, so the sandbox (whose
// workspace is sandbox/) still reaches them.
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));

// The static root is the repo itself, and `make start` exposes it publicly.
const NEVER_SERVE = /^\/(node_modules|\.git)(\/|$)/;
app.use((req, res, next) => (NEVER_SERVE.test(req.path) ? res.status(404).json({ error: 'Not found' }) : next()));

// Lessons must load over http://localhost (a secure context), not file://, or
// the mic / Web Speech API fails and its permission is never remembered.
app.use(express.static(WORKSPACE));

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

const PORT = process.env.PORT || 9990;
app.listen(PORT, () => {
  console.log(`learno-server running on :${PORT}${SANDBOX ? '  [MODE=sandbox]' : ''}`);
  if (SANDBOX) {
    console.log('  Store        : SQLite in memory (seeded, resets on restart)');
    console.log('  Validator    : stubbed — !0 / !p / !ok / !m force each score band');
  } else {
    // .env is read once at boot; printing it makes a stale config visible.
    console.log(`  Grader       : ${describeGrader()}`);
    getStore();
    console.log(`  Store        : ${DB_PATH}`);
  }
  console.log(`  Workspace    : ${WORKSPACE}`);
  console.log(`  Open         : http://localhost:${PORT}/   → ${DASHBOARD_PATH}`);
});
