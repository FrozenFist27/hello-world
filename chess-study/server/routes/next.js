// NEXT.md is written by a model and may be hand-edited, so parsing degrades
// instead of failing: heading, link, body and the file itself are all optional.

const fs   = require('fs');
const path = require('path');

const router = require('express').Router();
const { WORKSPACE } = require('../workspace');

const FILE = 'NEXT.md';

function parse(raw) {
  const lines = raw.split('\n');

  const titleLine = lines.findIndex(l => /^#\s+/.test(l.trim()));
  const title = titleLine >= 0 ? lines[titleLine].trim().replace(/^#\s+/, '') : null;

  // Only the first link is the action; later ones stay in the body as text.
  let action = null;
  let actionLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/\[([^\]]+)\]\(([^)\s]+)\)/);
    if (m) { action = { label: m[1], href: m[2] }; actionLine = i; break; }
  }

  const body = lines
    .filter((_, i) => i !== titleLine && i !== actionLine)
    .join('\n')
    .trim();

  return { title, action, body };
}

router.get('/', (_req, res) => {
  const file = path.join(WORKSPACE, FILE);

  let raw, stat;
  try {
    raw  = fs.readFileSync(file, 'utf8');
    stat = fs.statSync(file);
  } catch {
    return res.json({ exists: false, file: FILE });
  }

  res.json({ exists: true, file: FILE, updated_at: stat.mtime, ...parse(raw) });
});

module.exports = router;
