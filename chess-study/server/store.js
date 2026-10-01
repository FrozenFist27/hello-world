let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  console.error(`learno needs Node 22.13 or newer (it uses the built-in node:sqlite). This is Node ${process.version}.`);
  process.exit(1);
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS concepts (
    concept_id     TEXT PRIMARY KEY,
    lesson_id      TEXT,
    first_seen     TEXT,
    last_reviewed  TEXT,
    next_review    TEXT,
    interval_days  INTEGER,
    ease_factor    REAL,
    mastered       INTEGER NOT NULL DEFAULT 0,
    mastery_source TEXT
  );
  CREATE TABLE IF NOT EXISTS concept_history (
    id         INTEGER PRIMARY KEY,
    concept_id TEXT NOT NULL REFERENCES concepts(concept_id),
    date       TEXT NOT NULL,
    score      REAL,
    source     TEXT
  );
  CREATE TABLE IF NOT EXISTS lessons (
    lesson_id    TEXT PRIMARY KEY,
    kind         TEXT NOT NULL DEFAULT 'lesson',
    completed_at TEXT,
    final_score  REAL
  );
  CREATE TABLE IF NOT EXISTS section_results (
    id                    INTEGER PRIMARY KEY,
    lesson_id             TEXT,
    concept_id            TEXT,
    is_teachback          INTEGER NOT NULL DEFAULT 0,
    score                 REAL,
    user_answer           TEXT,
    feedback              TEXT,
    concepts_demonstrated TEXT NOT NULL DEFAULT '[]',
    misconceptions        TEXT NOT NULL DEFAULT '[]',
    recorded_at           TEXT
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id          INTEGER PRIMARY KEY,
    concept_id  TEXT,
    source      TEXT,
    score       REAL,
    note        TEXT,
    recorded_at TEXT
  );
  CREATE INDEX IF NOT EXISTS section_results_lesson ON section_results(lesson_id, recorded_at);
  CREATE INDEX IF NOT EXISTS concept_history_concept ON concept_history(concept_id, date);
`;

const iso = d => (d == null ? null : new Date(d).toISOString());

const toConcept = row => row && ({ ...row, mastered: !!row.mastered });

const toSection = row => ({
  ...row,
  is_teachback:          !!row.is_teachback,
  concepts_demonstrated: JSON.parse(row.concepts_demonstrated),
  misconceptions:        JSON.parse(row.misconceptions)
});

function openStore(file, { readOnly = false } = {}) {
  const db = new DatabaseSync(file, { readOnly });
  db.exec('PRAGMA busy_timeout = 3000');
  if (!readOnly) {
    db.exec(SCHEMA);
    // CREATE TABLE IF NOT EXISTS leaves a table from an older version as it was.
    const has = db.prepare("SELECT 1 FROM pragma_table_info('section_results') WHERE name = 'user_answer'").get();
    if (!has) db.exec('ALTER TABLE section_results ADD COLUMN user_answer TEXT');
  }

  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);

  const historyOf = concept_id =>
    all('SELECT date, score, source FROM concept_history WHERE concept_id = ? ORDER BY date, id', concept_id);

  const withHistory = row => row && { ...toConcept(row), history: historyOf(row.concept_id) };

  const store = {
    db,

    transaction(fn) {
      db.exec('BEGIN');
      try {
        const out = fn();
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    insertSection(s) {
      run(`INSERT INTO section_results
             (lesson_id, concept_id, is_teachback, score, user_answer, feedback, concepts_demonstrated, misconceptions, recorded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          s.lesson_id ?? null, s.concept_id ?? null, s.is_teachback ? 1 : 0, s.score ?? null,
          s.user_answer ?? null, s.feedback ?? null, JSON.stringify(s.concepts_demonstrated || []),
          JSON.stringify(s.misconceptions || []), iso(s.recorded_at ?? new Date()));
    },

    sections(lesson_id) {
      const rows = lesson_id
        ? all('SELECT * FROM section_results WHERE lesson_id = ? ORDER BY recorded_at, id', lesson_id)
        : all('SELECT * FROM section_results ORDER BY recorded_at, id');
      return rows.map(toSection);
    },

    saveLesson({ lesson_id, kind = 'lesson', final_score, completed_at = new Date() }) {
      run(`INSERT INTO lessons (lesson_id, kind, completed_at, final_score) VALUES (?, ?, ?, ?)
           ON CONFLICT(lesson_id) DO UPDATE SET
             kind = excluded.kind, completed_at = excluded.completed_at, final_score = excluded.final_score`,
          lesson_id, kind, iso(completed_at), final_score);
    },

    lessons(limit = 20) {
      return all('SELECT * FROM lessons ORDER BY completed_at DESC LIMIT ?', limit)
        .map(l => ({ ...l, sections: store.sections(l.lesson_id) }));
    },

    concept: concept_id => withHistory(one('SELECT * FROM concepts WHERE concept_id = ?', concept_id)),

    concepts: () => all('SELECT * FROM concepts ORDER BY concept_id').map(withHistory),

    saveConcept(c) {
      run(`INSERT INTO concepts
             (concept_id, lesson_id, first_seen, last_reviewed, next_review, interval_days, ease_factor, mastered, mastery_source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(concept_id) DO UPDATE SET
             lesson_id = excluded.lesson_id, last_reviewed = excluded.last_reviewed,
             next_review = excluded.next_review, interval_days = excluded.interval_days,
             ease_factor = excluded.ease_factor, mastered = excluded.mastered,
             mastery_source = excluded.mastery_source`,
          c.concept_id, c.lesson_id ?? null, iso(c.first_seen ?? new Date()), iso(c.last_reviewed),
          iso(c.next_review), c.interval_days ?? null, c.ease_factor ?? null,
          c.mastered ? 1 : 0, c.mastery_source ?? null);
    },

    addHistory(concept_id, { date = new Date(), score, source }) {
      run('INSERT INTO concept_history (concept_id, date, score, source) VALUES (?, ?, ?, ?)',
          concept_id, iso(date), score ?? null, source ?? null);
    },

    insertConversation(c) {
      run('INSERT INTO conversations (concept_id, source, score, note, recorded_at) VALUES (?, ?, ?, ?, ?)',
          c.concept_id ?? null, c.source ?? 'conversation', c.score ?? null, c.note ?? null,
          iso(c.recorded_at ?? new Date()));
    },

    conversations: () => all('SELECT * FROM conversations ORDER BY recorded_at DESC, id DESC'),

    seed(data) {
      store.transaction(() => {
        for (const c of data.concepts || []) {
          store.saveConcept(c);
          for (const h of c.history || []) store.addHistory(c.concept_id, h);
        }
        for (const l of data.lessons || []) store.saveLesson(l);
        for (const s of data.section_results || []) store.insertSection(s);
        for (const c of data.conversations || []) store.insertConversation(c);
      });
    }
  };

  return store;
}

module.exports = { openStore };
