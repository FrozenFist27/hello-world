#!/usr/bin/env node
// Claude Code UserPromptSubmit hook: runs before every message, so it must be fast
// and must never get in the way. It prints nothing unless a review is due, speaks
// once per session for the same list, and swallows every error.
const fs = require('fs');
const os = require('os');
const path = require('path');

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const file = process.env.LEARNO_DB || path.join(root, 'learno.db');
  if (!fs.existsSync(file)) process.exit(0);

  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });

  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  const due = db.prepare(
    'SELECT concept_id, next_review FROM concepts WHERE next_review < ? ORDER BY next_review'
  ).all(endOfToday);
  if (!due.length) process.exit(0);

  const seen = path.join(os.tmpdir(), `learno-due-${input.session_id || 'none'}`);
  const key = due.map(d => d.concept_id).join(',');
  if (fs.existsSync(seen) && fs.readFileSync(seen, 'utf8') === key) process.exit(0);
  fs.writeFileSync(seen, key);

  const days = iso => Math.floor((now - new Date(iso)) / 86400000);
  const list = due.slice(0, 5).map(d => {
    const late = days(d.next_review);
    return late > 0 ? `${d.concept_id} (${late} day${late > 1 ? 's' : ''} late)` : `${d.concept_id} (today)`;
  }).join(', ') + (due.length > 5 ? `, and ${due.length - 5} more` : '');

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext:
        `learno: ${due.length} review${due.length > 1 ? 's' : ''} due: ${list}. ` +
        'Tell the user briefly, in their language, and offer to do it now. If they are in the ' +
        'middle of something else, mention it once and carry on with what they asked.'
    }
  }));
} catch {}
process.exit(0);
