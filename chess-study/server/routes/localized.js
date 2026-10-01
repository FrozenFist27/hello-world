const fs = require('fs');
const path = require('path');
const router = require('express').Router();

const { WORKSPACE, strings } = require('../workspace');

const PAGES = ['reference/my-learning.html', 'reference/library.html'];

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Filled here rather than in the browser: the pages are authored in English, so
// a Portuguese workspace would otherwise flash English until a fetch landed.
// Only leaf elements carry data-t, which is what keeps these patterns honest.
function localize(html, table) {
  const text = key => table[key] ?? key;
  return html
    .replace(/<html lang="[^"]*"/, `<html lang="${esc(text('html.lang'))}"`)
    .replace(/(<[^>]*\sdata-t="([^"]+)"[^>]*>)[^<]*/g, (_m, open, key) => open + esc(text(key)))
    .replace(/<[^>]*\sdata-t-attr="([^"]+)"[^>]*>/g, (tag, key) =>
      tag.replace(/\s(title|aria-label|placeholder)="[^"]*"/g, (_a, attr) => ` ${attr}="${esc(text(key))}"`))
    .replace('</head>', `<script id="lx-strings" type="application/json">${
      JSON.stringify(table).replace(/</g, '\\u003c')}</script>\n</head>`);
}

router.get('/api/strings', (_req, res) => res.json(strings()));

for (const page of PAGES) {
  router.get('/' + page, (_req, res, next) => {
    fs.readFile(path.join(WORKSPACE, page), 'utf8', (err, html) => {
      if (err) return next();
      res.type('html').send(localize(html, strings()));
    });
  });
}

module.exports = router;
