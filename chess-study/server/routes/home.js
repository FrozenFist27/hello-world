const router = require('express').Router();
const { listWorkspace, DASHBOARD_PATH, hasDashboard, strings } = require('../workspace');

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderGroup(title, items, empty) {
  if (!items.length) return `<h2>${esc(title)}</h2><p class="empty">${esc(empty)}</p>`;
  return `<h2>${esc(title)} <span class="count">${items.length}</span></h2><ul>` +
    items.map(i => `<li><a href="${esc(i.path)}">${esc(i.title)}</a><code>${esc(i.file)}</code></li>`).join('') +
    '</ul>';
}

function renderIndex({ lessons, reviews, projects }) {
  const S = strings();
  return `<!DOCTYPE html>
<html lang="${esc(S['html.lang'])}"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>learno — workspace</title>
<style>
  :root { color-scheme: light dark; --ink:#1a1d23; --muted:#6b7280; --bg:#fbfbfd; --card:#fff; --rule:#e5e7eb; --accent:#2563eb; }
  @media (prefers-color-scheme: dark) {
    :root { --ink:#e6e6e6; --muted:#9aa1ab; --bg:#0f1115; --card:#161922; --rule:#2a2e37; --accent:#6ea8ff; }
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:var(--bg); color:var(--ink);
         max-width:52rem; margin:0 auto; padding:3rem 1.25rem 5rem; line-height:1.6; }
  h1 { font-size:1.5rem; letter-spacing:-.02em; }
  .sub { color:var(--muted); font-size:.9rem; margin:.35rem 0 2.5rem; }
  h2 { font-size:.8rem; text-transform:uppercase; letter-spacing:.08em; color:var(--muted);
       margin:2rem 0 .75rem; display:flex; align-items:center; gap:.5rem; }
  .count { background:var(--rule); color:var(--muted); border-radius:99px; padding:.05rem .5rem; font-size:.75rem; letter-spacing:0; }
  ul { list-style:none; border:1px solid var(--rule); border-radius:.6rem; overflow:hidden; background:var(--card); }
  li { border-bottom:1px solid var(--rule); }
  li:last-child { border-bottom:0; }
  li a { display:flex; justify-content:space-between; align-items:center; gap:1rem;
         padding:.8rem 1rem; color:var(--ink); text-decoration:none; }
  li a:hover { background:var(--rule); }
  li code { color:var(--muted); font-size:.75rem; white-space:nowrap; }
  .empty { color:var(--muted); font-size:.9rem; font-style:italic; }
  .note { margin-top:2.5rem; padding:.9rem 1rem; border-left:3px solid var(--accent);
          background:var(--card); color:var(--muted); font-size:.85rem; border-radius:0 .4rem .4rem 0; }
  .note code { color:var(--ink); }
</style></head>
<body>
  <h1>learno</h1>
  <p class="sub">${esc(S['home.subtitle'])}</p>
  ${renderGroup(S['lib.lessons'], lessons, S['home.noLessons'])}
  ${renderGroup(S['lib.reviews'], reviews, S['home.noReviews'])}
  ${renderGroup(S['lib.projects'], projects, S['home.noProjects'])}
  <p class="note">${S['home.noDashboard'].replace('{path}', esc(DASHBOARD_PATH))}</p>
</body></html>`;
}

router.get('/', (_req, res) => {
  // A redirect, not the file served at `/`: the dashboard links to its siblings
  // relatively (`glossary.html`), which would 404 from the root.
  if (hasDashboard()) return res.redirect(302, '/' + DASHBOARD_PATH);
  res.type('html').send(renderIndex(listWorkspace()));
});

module.exports = router;
