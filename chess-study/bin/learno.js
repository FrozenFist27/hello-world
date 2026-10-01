#!/usr/bin/env node
const fs = require('fs');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`learno needs Node 22.13 or newer; this is ${process.version}.`);
  process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);

// Bare `npx …/learno` outside a workspace is someone starting out, not a status check.
if (command === 'new' || (!command && !fs.existsSync('learno.json'))) {
  require('./new').create(command ? rest : []).catch(err => { console.error(err.message); process.exit(1); });
} else {
  main();
}

function main() {
  const { openStore } = require('../server/store');
  const { DB_PATH } = require('../server/db');
  const { groupMisconceptions } = require('../server/misconceptions');

  const USAGE = `usage: learno <command> [--json]

    new <folder>        create a new study workspace (run it with npx)
    status              mastered concepts, reviews due, recent lessons
    due                 concepts due for review by the end of today
    misconceptions [N]  misconceptions seen in N or more sections (default 2)
    lesson <id>         per-section answers, scores, feedback and misconceptions
    concepts            every concept with its schedule and score history
    sql "<select>"      run a read-only query against ${DB_PATH}
    export              every table as JSON`;

  const json = rest.includes('--json');
  const args = rest.filter(a => a !== '--json');

  function print(rows) {
    if (json) return console.log(JSON.stringify(rows, null, 2));
    if (Array.isArray(rows) && !rows.length) return console.log('(no records)');
    Array.isArray(rows) ? console.table(rows) : console.log(rows);
  }

  const day = s => (s ? s.slice(0, 10) : '');
  const lastScore = c => c.history.at(-1)?.score ?? null;

  // Due means due on today's local calendar day, not before this instant: a review
  // scheduled for tonight is due this morning. The dashboard counts the same way.
  function endOfToday() {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1).toISOString();
  }

  const commands = {
    status(store) {
      const concepts = store.concepts();
      const due = concepts.filter(c => c.next_review && c.next_review < endOfToday());
      const lessons = store.lessons(5);
      if (json) return print({ concepts: concepts.length, mastered: concepts.filter(c => c.mastered).length, due: due.length, recent_lessons: lessons.map(({ sections, ...l }) => l) });
      console.log(`concepts: ${concepts.length}  mastered: ${concepts.filter(c => c.mastered).length}  due today: ${due.length}`);
      print(lessons.map(l => ({ lesson: l.lesson_id, kind: l.kind, score: l.final_score, completed: day(l.completed_at) })));
    },

    due(store) {
      print(store.concepts()
        .filter(c => c.next_review && c.next_review < endOfToday())
        .sort((a, b) => a.next_review.localeCompare(b.next_review))
        .map(c => ({ concept: c.concept_id, due: day(c.next_review), interval_days: c.interval_days, last_score: lastScore(c), mastered: c.mastered })));
    },

    misconceptions(store) {
      const min = Number(args[0] ?? 2);
      print(groupMisconceptions(store.sections())
        .filter(m => m.count >= min)
        .map(m => ({ count: m.count, misconception: m.text, concepts: m.concepts.join(', '), lessons: m.lessons.join(', '), last_seen: day(m.last_seen?.toISOString()) })));
    },

    lesson(store) {
      if (!args[0]) throw new Error('usage: learno lesson <lesson-id>');
      const ids = store.db.prepare('SELECT DISTINCT lesson_id FROM section_results WHERE lesson_id LIKE ?').all(`%${args[0]}%`);
      const rows = ids.flatMap(({ lesson_id }) => store.sections(lesson_id));
      if (json) return print(rows);
      print(rows.map(s => ({ lesson: s.lesson_id, concept: s.concept_id, teachback: s.is_teachback, score: s.score, misconceptions: s.misconceptions.join(' | '), at: day(s.recorded_at) })));
      for (const s of rows) {
        console.log(`\n[${s.concept_id}${s.is_teachback ? ' · teach-back' : ''}] ${s.score}`);
        console.log(`answer:   ${s.user_answer ?? '(not recorded — answered before answers were stored)'}`);
        console.log(`feedback: ${s.feedback}`);
      }
    },

    concepts(store) {
      const rows = store.concepts();
      if (json) return print(rows);
      print(rows.map(c => ({ concept: c.concept_id, mastered: c.mastered, source: c.mastery_source, next_review: day(c.next_review), interval_days: c.interval_days, scores: c.history.map(h => h.score).join(' → ') })));
    },

    sql(store) {
      if (!args[0]) throw new Error('usage: learno sql "<select statement>"');
      print(store.db.prepare(args[0]).all());
    },

    export(store) {
      console.log(JSON.stringify({
        concepts: store.concepts(),
        lessons: store.lessons(-1),
        section_results: store.sections(),
        conversations: store.conversations()
      }, null, 2));
    }
  };

  if (!commands[command]) {
    console.log(USAGE);
    process.exit(command && command !== 'help' ? 1 : 0);
  }

  if (!fs.existsSync(DB_PATH)) {
    console.log(`No progress recorded yet — ${DB_PATH} does not exist. It is created when the server first starts.`);
    process.exit(0);
  }

  try {
    commands[command](openStore(DB_PATH, { readOnly: true }));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
